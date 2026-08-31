import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { InvoiceService } from '../../billing/invoices/services/invoice.service';
import { Person, PersonStatus } from '../../persons/entities/person.entity';
import { PersonsService } from '../../persons/services/persons.service';
import { CreateBeneficiaryDto } from '../dto/create-beneficiary.dto';
import { SetBillingOwnerDto } from '../dto/set-billing-owner.dto';
import { SetContractTitularDto } from '../dto/set-contract-titular.dto';
import { AffiliationHistory } from '../entities/affiliation-history.entity';
import { ContractPerson, PersonRole } from '../entities/contract-person.entity';
import { Contract } from '../entities/contract.entity';
import { AffiliationAction } from '../enums/affiliation-action.enum';

@Injectable()
export class ContractAffiliationService {
  constructor(
    @InjectRepository(Contract)
    private readonly contractsRepository: Repository<Contract>,
    @InjectRepository(ContractPerson)
    private readonly contractPersonsRepository: Repository<ContractPerson>,
    @Inject(forwardRef(() => PersonsService))
    private readonly personsService: PersonsService,
    @Inject(forwardRef(() => InvoiceService))
    private readonly invoiceService: InvoiceService,
  ) {}

  /**
   * Adds a new beneficiary to an existing contract via PersonsService.
   */
  async addBeneficiary(contractId: string, dto: CreateBeneficiaryDto): Promise<Person> {
    return this.personsService.create({
      ...dto,
      contractId,
    });
  }

  /**
   * Disaffiliates a beneficiary, records the history action, removes the active invoice line,
   * soft deletes the junction record and triggers monthly amount recalculation.
   */
  async removeAffiliate(contractPersonId: string): Promise<void> {
    const contractPerson = await this.contractPersonsRepository.findOne({
      where: { id: contractPersonId },
      relations: ['contract', 'person', 'person.plan', 'plan'],
    });

    if (!contractPerson) {
      throw new NotFoundException(`Contract person with ID "${contractPersonId}" not found`);
    }

    if (contractPerson.role === PersonRole.TITULAR) {
      throw new BadRequestException('El TITULAR no puede ser eliminado');
    }

    if (contractPerson.isBillingOwner) {
      throw new BadRequestException('Debe existir un responsable de facturación');
    }

    await this.contractsRepository.manager.transaction(async (manager) => {
      const historyRepo = manager.getRepository(AffiliationHistory);
      const cpRepo = manager.getRepository(ContractPerson);

      const effectivePlan = contractPerson.plan ?? contractPerson.person?.plan ?? null;

      // 1. Registrar en historial ANTES de eliminar
      await historyRepo.save(
        historyRepo.create({
          contract: contractPerson.contract,
          person: contractPerson.person,
          plan: effectivePlan,
          action: AffiliationAction.DESAFILIACION,
          amount: Number(effectivePlan?.amount ?? 0),
          reason: null,
        }),
      );

      // 2. Soft delete (mantiene trazabilidad)
      await cpRepo.softRemove(contractPerson);

      // 3. Billing es responsable de limpiar la línea MENSUALIDAD de la factura activa
      await this.invoiceService.removeAffiliateLineFromActiveInvoice(
        contractPerson.contract.id,
        contractPerson.person.id,
        manager,
      );

      // 4. Recalcular el monto mensual
      await this.recalculateMonthlyAmount(contractPerson.contract.id, manager);
    });
  }

  /**
   * Toggles or assigns the titular of a contract. If the target person is already titular,
   * switches back to AFILIADO. Restores/nullifies plan assignments accordingly.
   */
  async setContractTitular(contractId: string, dto: SetContractTitularDto): Promise<void> {
    const { contractPersonId } = dto;

    const target = await this.contractPersonsRepository.findOne({
      where: { id: contractPersonId, contract: { id: contractId } },
    });

    if (!target) {
      throw new NotFoundException('Afiliado no encontrado en este contrato.');
    }

    await this.contractPersonsRepository.manager.transaction(async (entityManager) => {
      const isAlreadyTitular = target.role === PersonRole.TITULAR;

      // Revertir a todos los titulares actuales a afiliados (AFILIADO)
      const currentTitulars = await entityManager.find(ContractPerson, {
        where: { contract: { id: contractId }, role: PersonRole.TITULAR, deletedAt: IsNull() },
        relations: ['person', 'person.plan'],
      });

      for (const titular of currentTitulars) {
        titular.role = PersonRole.AFILIADO;
        if (!titular.plan) {
          titular.plan = titular.person?.plan ?? null;
        }
        await entityManager.save(ContractPerson, titular);
      }

      // Toggle titular
      target.role = isAlreadyTitular ? PersonRole.AFILIADO : PersonRole.TITULAR;
      if (target.role === PersonRole.TITULAR) {
        target.plan = null;
      } else if (!target.plan) {
        target.plan = target.person?.plan ?? null;
      }
      await entityManager.save(ContractPerson, target);
    });

    // Recalcular la facturación mensual del contrato
    await this.recalculateMonthlyAmount(contractId);
  }

  /**
   * Designates a single person as the billing owner of the contract.
   */
  async setBillingOwner(contractId: string, dto: SetBillingOwnerDto): Promise<void> {
    const { contractPersonId } = dto;

    const target = await this.contractPersonsRepository.findOne({
      where: { id: contractPersonId, contract: { id: contractId } },
    });

    if (!target) {
      throw new NotFoundException('Afiliado no encontrado en este contrato.');
    }

    await this.contractPersonsRepository.manager.transaction(async (entityManager) => {
      // Desmarcar a todos los demás responsables de cobro en este contrato
      await entityManager.update(
        ContractPerson,
        { contract: { id: contractId }, deletedAt: IsNull() },
        { isBillingOwner: false },
      );

      // Marcar al nuevo responsable
      target.isBillingOwner = true;
      await entityManager.save(ContractPerson, target);
    });
  }

  /**
   * Recalculates the monthly amount for a given contract ID
   * by summing the amount of all plans associated to its active AFILIADOS.
   */
  async recalculateMonthlyAmount(contractId: string, manager?: EntityManager): Promise<void> {
    const cpRepo = manager ? manager.getRepository(ContractPerson) : this.contractPersonsRepository;
    const contractRepo = manager ? manager.getRepository(Contract) : this.contractsRepository;

    const affiliates = await cpRepo.find({
      where: {
        contract: { id: contractId },
        person: { status: PersonStatus.ACTIVE },
      },
      relations: ['plan', 'person', 'person.plan'],
    });

    const totalAmount = affiliates.reduce((sum, cp) => {
      const plan = cp.plan || cp.person?.plan;
      if (cp.role === PersonRole.AFILIADO && plan) {
        return sum + Number(plan.amount);
      }
      return sum;
    }, 0);

    await contractRepo.update(contractId, { monthlyAmount: totalAmount });
  }
}
