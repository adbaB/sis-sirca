import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { InvoiceService } from '../../billing/invoices/services/invoice.service';
import { resolveQueryRunner } from '../../common/context/request-context';
import { Transactional } from '../../common/decorators/transactional.decorator';
import { Person, PersonStatus } from '../../persons/entities/person.entity';
import { PersonsService } from '../../persons/services/persons.service';
import { Plan } from '../../plans/entities/plan.entity';
import { PlansService } from '../../plans/services/plans.service';
import { CreateBeneficiaryDto } from '../dto/create-beneficiary.dto';
import { SetBillingOwnerDto } from '../dto/set-billing-owner.dto';
import { SetContractTitularDto } from '../dto/set-contract-titular.dto';
import { AffiliationHistory } from '../entities/affiliation-history.entity';
import { ContractPerson, PersonRole } from '../entities/contract-person.entity';
import { Contract, ContractStatus } from '../entities/contract.entity';
import { HealthDeclaration } from '../entities/health-declaration.entity';
import { AffiliationAction } from '../enums/affiliation-action.enum';
import { migrateFromInactiveContracts } from '../helpers/contract-migration.helper';

@Injectable()
export class ContractAffiliationService {
  constructor(
    @InjectRepository(Contract)
    private readonly contractsRepository: Repository<Contract>,
    @InjectRepository(ContractPerson)
    private readonly contractPersonsRepository: Repository<ContractPerson>,
    private readonly dataSource: DataSource,
    private readonly personsService: PersonsService,
    private readonly invoiceService: InvoiceService,
    private readonly plansService: PlansService,
  ) {}

  /**
   * Adds a new beneficiary to an existing contract.
   * Handles person creation/lookup via PersonsService, validation of affiliate rules,
   * contract person association, health declarations, history logging,
   * active invoice inclusion line generation, and monthly amount recalculation.
   */
  @Transactional()
  async addBeneficiary(contractId: string, dto: CreateBeneficiaryDto): Promise<Person> {
    const qr = resolveQueryRunner(undefined, this.dataSource);
    const manager = qr.manager;

    const contractRepo = manager.getRepository(Contract);
    const cpRepo = manager.getRepository(ContractPerson);
    const historyRepo = manager.getRepository(AffiliationHistory);
    const hdRepo = manager.getRepository(HealthDeclaration);

    // 1. Validar existencia del contrato
    const contract = await contractRepo.findOne({
      where: { id: contractId },
    });
    if (!contract) {
      throw new NotFoundException(`Contract with ID "${contractId}" not found`);
    }

    const { planId, role, isBillingOwner, relationship, healthDeclarations } = dto;
    const personFields = {
      name: dto.name,
      typeIdentityCard: dto.typeIdentityCard,
      identityCard: dto.identityCard,
      phone: dto.phone,
      alternatePhone: dto.alternatePhone,
      email: dto.email,
      address: dto.address,
      city: dto.city,
      state: dto.state,
      postalCode: dto.postalCode,
      weight: dto.weight,
      height: dto.height,
      occupation: dto.occupation,
      legalRepresentative: dto.legalRepresentative,
    };

    const resolvedRole = role || PersonRole.AFILIADO;

    // 2. Resolver y validar plan para AFILIADO
    let plan: Plan | null = null;
    if (resolvedRole === PersonRole.AFILIADO) {
      if (!planId) {
        throw new BadRequestException(
          'Se requiere un plan para afiliar a una persona a este contrato.',
        );
      }
      plan = await this.plansService.findOne(planId);
      if (!plan) {
        throw new NotFoundException(`Plan with ID "${planId}" not found`);
      }
    }

    // 3. Buscar o crear la persona (PersonsService gestiona la entidad pura Person)
    let person = await this.personsService.findByIdentityCard(
      personFields.identityCard,
      personFields.typeIdentityCard,
    );

    if (!person) {
      person = await this.personsService.create(personFields);
    }

    // 4. Validar que la persona no esté ya en este contrato
    const existingJunction = await cpRepo.findOne({
      where: { contract: { id: contractId }, person: { id: person.id } },
    });
    if (existingJunction) {
      throw new BadRequestException('La persona ya está afiliada a este contrato.');
    }

    // 5. Validar regla de unicidad de AFILIADO (no puede ser AFILIADO activo en otro contrato)
    if (resolvedRole === PersonRole.AFILIADO) {
      const activeAffiliations = await cpRepo.find({
        where: {
          person: { id: person.id },
          role: PersonRole.AFILIADO,
          contract: { status: ContractStatus.ACTIVE },
        },
        relations: ['contract'],
      });

      const otherContractAffiliations = activeAffiliations.filter(
        (cp) => cp.contract.id !== contractId,
      );

      if (otherContractAffiliations.length > 0) {
        const contractCodes = otherContractAffiliations.map((cp) => cp.contract.code).join(', ');
        throw new BadRequestException(
          `El afiliado ${person.name} (${person.typeIdentityCard}-${person.identityCard}) ya pertenece al contrato: ${contractCodes}. Debe ser desafiliado primero antes de asignarlo a otro contrato.`,
        );
      }
    }

    // 6. Verificar si proviene de un contrato INACTIVO -> registrar CAMBIO_CONTRATO y softRemove
    const { affiliationReason } = await migrateFromInactiveContracts(
      manager,
      person,
      contract.code,
    );

    // 7. Crear y guardar ContractPerson
    const contractPerson = cpRepo.create({
      contract,
      person,
      role: resolvedRole,
      isBillingOwner: isBillingOwner ?? false,
      relationship,
      plan: resolvedRole === PersonRole.AFILIADO ? plan : null,
    });
    const savedCp = await cpRepo.save(contractPerson);

    // 8. Guardar declaraciones de salud si existen
    if (healthDeclarations && healthDeclarations.length > 0) {
      const hdEntities = healthDeclarations.map((hd) =>
        hdRepo.create({
          ...hd,
          contractPerson: savedCp,
        }),
      );
      await hdRepo.save(hdEntities);
    }

    // 9. Registrar en historial y auto-agregar cargo INCLUSION si corresponde
    if (resolvedRole === PersonRole.AFILIADO && plan) {
      await historyRepo.save(
        historyRepo.create({
          contract: { id: contractId },
          person,
          plan,
          action: AffiliationAction.AFILIACION,
          amount: Number(plan.amount ?? 0),
          reason: affiliationReason ?? undefined,
        }),
      );

      await this.invoiceService.addAffiliateInclusionLineToActiveInvoice(
        contractId,
        person,
        plan,
        manager,
      );
    }

    // 10. Recalcular el monto mensual del contrato
    await this.recalculateMonthlyAmount(contractId, manager);

    return person;
  }

  /**
   * Disaffiliates a beneficiary, records the history action, removes the active invoice line,
   * soft deletes the junction record and triggers monthly amount recalculation.
   */
  @Transactional()
  async removeAffiliate(contractPersonId: string, contractId?: string): Promise<void> {
    const qr = resolveQueryRunner(undefined, this.dataSource);
    const manager = qr.manager;

    // 1. Bloquear la fila en la tabla junction sin relaciones para evitar:
    // "ERROR: FOR UPDATE cannot be applied to the nullable side of an outer join" en PostgreSQL
    const lockedCp = await manager.getRepository(ContractPerson).findOne({
      where: { id: contractPersonId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!lockedCp) {
      throw new NotFoundException(`Contract person with ID "${contractPersonId}" not found`);
    }

    // 2. Cargar con relaciones completas con la fila ya bloqueada
    const contractPerson = (await manager.getRepository(ContractPerson).findOne({
      where: { id: contractPersonId },
      relations: ['contract', 'person', 'person.plan', 'plan'],
    })) as ContractPerson;

    if (contractId && contractPerson.contract.id !== contractId) {
      throw new BadRequestException('El afiliado no pertenece al contrato especificado.');
    }

    if (contractPerson.role === PersonRole.TITULAR) {
      throw new BadRequestException('El TITULAR no puede ser eliminado');
    }

    if (contractPerson.isBillingOwner) {
      throw new BadRequestException('Debe existir un responsable de facturación');
    }

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

    // 2. Billing es responsable de limpiar la línea MENSUALIDAD de la factura activa
    await this.invoiceService.removeAffiliateLineFromActiveInvoice(
      contractPerson.contract.id,
      contractPerson.person.id,
      manager,
    );

    // 3. Soft delete (mantiene trazabilidad)
    await cpRepo.softRemove(contractPerson);

    // 4. Recalcular el monto mensual
    await this.recalculateMonthlyAmount(contractPerson.contract.id, manager);
  }

  /**
   * Toggles or assigns the titular of a contract. If the target person is already titular,
   * switches back to AFILIADO. Restores/nullifies plan assignments accordingly.
   */
  @Transactional()
  async setContractTitular(contractId: string, dto: SetContractTitularDto): Promise<void> {
    const { contractPersonId } = dto;

    const qr = resolveQueryRunner(undefined, this.dataSource);
    const manager = qr.manager;
    const cpRepo = manager.getRepository(ContractPerson);

    const target = await cpRepo.findOne({
      where: { id: contractPersonId, contract: { id: contractId } },
      lock: { mode: 'pessimistic_write' },
    });

    if (!target) {
      throw new NotFoundException('Afiliado no encontrado en este contrato.');
    }

    const isAlreadyTitular = target.role === PersonRole.TITULAR;

    // Revertir a todos los titulares actuales a afiliados (AFILIADO)
    const currentTitulars = await manager.find(ContractPerson, {
      where: { contract: { id: contractId }, role: PersonRole.TITULAR, deletedAt: IsNull() },
      relations: ['person', 'person.plan'],
    });

    for (const titular of currentTitulars) {
      titular.role = PersonRole.AFILIADO;
      if (!titular.plan) {
        titular.plan = titular.person?.plan ?? null;
      }
      await manager.save(ContractPerson, titular);
    }

    // Toggle titular
    target.role = isAlreadyTitular ? PersonRole.AFILIADO : PersonRole.TITULAR;
    if (target.role === PersonRole.TITULAR) {
      target.plan = null;
    } else if (!target.plan) {
      target.plan = target.person?.plan ?? null;
    }
    await manager.save(ContractPerson, target);

    // Recalcular la facturación mensual del contrato
    await this.recalculateMonthlyAmount(contractId, manager);
  }

  /**
   * Designates a single person as the billing owner of the contract.
   */
  @Transactional()
  async setBillingOwner(contractId: string, dto: SetBillingOwnerDto): Promise<void> {
    const { contractPersonId } = dto;

    const qr = resolveQueryRunner(undefined, this.dataSource);
    const manager = qr.manager;

    const target = await manager.getRepository(ContractPerson).findOne({
      where: { id: contractPersonId, contract: { id: contractId } },
      lock: { mode: 'pessimistic_write' },
    });

    if (!target) {
      throw new NotFoundException('Afiliado no encontrado en este contrato.');
    }

    // Desmarcar a todos los demás responsables de cobro en este contrato
    await manager.update(
      ContractPerson,
      { contract: { id: contractId }, deletedAt: IsNull() },
      { isBillingOwner: false },
    );

    // Marcar al nuevo responsable
    target.isBillingOwner = true;
    await manager.save(ContractPerson, target);
  }

  /**
   * Recalculates the monthly amount for a given contract ID
   * by summing the amount of all plans associated to its active AFILIADOS.
   */
  async recalculateMonthlyAmount(contractId: string, manager?: EntityManager): Promise<void> {
    const cpRepo = manager ? manager.getRepository(ContractPerson) : this.contractPersonsRepository;

    const affiliates = await cpRepo.find({
      where: {
        contract: { id: contractId },
        person: { status: PersonStatus.ACTIVE },
      },
      relations: ['plan', 'person', 'person.plan'],
    });

    const monthlyAmount = affiliates
      .filter((cp) => cp.role === PersonRole.AFILIADO)
      .reduce((sum, cp) => {
        const planAmount = cp.plan?.amount ?? cp.person?.plan?.amount ?? 0;
        return sum + Number(planAmount);
      }, 0);

    if (manager) {
      await manager.getRepository(Contract).update(contractId, { monthlyAmount });
    } else {
      await this.contractsRepository.update(contractId, { monthlyAmount });
    }
  }
}
