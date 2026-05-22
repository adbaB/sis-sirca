import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';

import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import { paginateRepository } from '../../common/utils/pagination.util';
import { Person, PersonStatus } from '../../persons/entities/person.entity';
import { PersonsService } from '../../persons/services/persons.service';
import { CreateBeneficiaryDto } from '../dto/create-beneficiary.dto';
import { CreateContractDto } from '../dto/create-contract.dto';
import { FindContractDto } from '../dto/find-contract.dto';
import { SetBillingOwnerDto } from '../dto/set-billing-owner.dto';
import { SetContractTitularDto } from '../dto/set-contract-titular.dto';
import { UpdateContractDto } from '../dto/update-contract.dto';
import { ContractPerson, PersonRole } from '../entities/contract-person.entity';
import { Contract } from '../entities/contract.entity';

@Injectable()
export class ContractsService {
  constructor(
    @InjectRepository(Contract)
    private contractsRepository: Repository<Contract>,
    @InjectRepository(ContractPerson)
    private contractPersonsRepository: Repository<ContractPerson>,
    @Inject(forwardRef(() => PersonsService))
    private personsService: PersonsService,
  ) {}

  async create(createContractDto: CreateContractDto): Promise<Contract> {
    const { advisorId, ...rest } = createContractDto;
    const contract = this.contractsRepository.create({
      ...rest,
      ...(advisorId ? { advisor: { id: advisorId } } : {}),
    });
    return this.contractsRepository.save(contract);
  }

  async findAll(query: FindContractDto): Promise<PaginatedResult<Contract>> {
    return paginateRepository(
      this.contractsRepository,
      {
        where: {
          code: query.search ? ILike(`%${query.search}%`) : undefined,
        },
        order: { code: 'ASC' },
        relations: ['contractPersons', 'contractPersons.person', 'contractPersons.person.plan'],
      },
      query,
    );
  }

  async findByCode(code: string): Promise<Contract> {
    return this.contractsRepository.findOne({
      where: { code },
      relations: ['contractPersons', 'contractPersons.person', 'contractPersons.person.plan'],
    });
  }
  async findOne(id: string): Promise<Contract> {
    const contract = await this.contractsRepository.findOne({
      where: { id },
      relations: [
        'contractPersons',
        'contractPersons.person',
        'contractPersons.person.plan',
        'invoices',
        'invoices.payments',
      ],
    });
    if (!contract) {
      throw new NotFoundException(`Contract with ID "${id}" not found`);
    }
    return contract;
  }

  async update(id: string, updateContractDto: UpdateContractDto): Promise<Contract> {
    const contract = await this.findOne(id);
    const updatedContract = Object.assign(contract, updateContractDto);
    return this.contractsRepository.save(updatedContract);
  }

  async remove(id: string): Promise<void> {
    const contract = await this.findOne(id);
    await this.contractsRepository.softRemove(contract);
  }

  /**
   * Assigns (or replaces) the advisor of an existing contract.
   * Pass null as advisorId to detach the current advisor.
   */
  async setAdvisor(contractId: string, advisorId: string | null): Promise<void> {
    await this.contractsRepository.save({
      id: contractId,
      advisor: advisorId ? { id: advisorId } : null,
    });
  }

  async removeAffiliate(contractPersonId: string): Promise<void> {
    const contractPerson = await this.contractPersonsRepository.findOne({
      where: { id: contractPersonId },
      relations: ['contract'],
    });
    const contract = await this.findOne(contractPerson.contract.id);

    if (!contract) {
      throw new NotFoundException(`Contract with ID "${contractPerson.contract.id}" not found`);
    }

    if (!contractPerson) {
      throw new NotFoundException(`Contract person with ID "${contractPersonId}" not found`);
    }

    if (contractPerson.role === 'TITULAR') {
      throw new BadRequestException('El TITULAR no puede ser eliminado');
    }

    if (contractPerson.isBillingOwner) {
      throw new BadRequestException('Debe existir un responsable de facturación');
    }

    await this.contractPersonsRepository.remove(contractPerson);
    // Re-calculate the monthly amount
    await this.recalculateMonthlyAmount(contract.id);
  }

  /**
   * Recalculates the monthly amount for a given contract ID
   * by summing the amount of all plans associated to its persons (only AFILIADOS have plans).
   */
  async recalculateMonthlyAmount(contractId: string): Promise<void> {
    const affiliates = await this.contractPersonsRepository.find({
      where: {
        contract: { id: contractId },
        person: { status: PersonStatus.ACTIVE },
      },
      relations: ['person', 'person.plan'],
    });

    const totalAmount = affiliates.reduce((sum, cp) => {
      // Sum the plan amount if the person is an AFILIADO and has a plan
      if (cp.role === 'AFILIADO' && cp.person && cp.person.plan) {
        return sum + Number(cp.person.plan.amount);
      }
      return sum;
    }, 0);

    await this.contractsRepository.update(contractId, { monthlyAmount: totalAmount });
  }

  async addBeneficiary(contractId: string, dto: CreateBeneficiaryDto): Promise<Person> {
    return this.personsService.create({
      ...dto,
      contractId,
    });
  }

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

      // Revertir a todos los demás titulares actuales a afiliados (AFILIADO)
      await entityManager.update(
        ContractPerson,
        { contract: { id: contractId } },
        { role: PersonRole.AFILIADO },
      );

      // Si antes era titular, al hacer click de nuevo se desmarca (se vuelve AFILIADO).
      // Si no lo era, pasa a ser el nuevo titular (TITULAR).
      target.role = isAlreadyTitular ? PersonRole.AFILIADO : PersonRole.TITULAR;
      await entityManager.save(ContractPerson, target);
    });

    // Recalcular la facturación mensual del contrato (el titular no aporta al costo mensual, los afiliados sí)
    await this.recalculateMonthlyAmount(contractId);
  }

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
        { contract: { id: contractId } },
        { isBillingOwner: false },
      );

      // Marcar al nuevo responsable
      target.isBillingOwner = true;
      await entityManager.save(ContractPerson, target);
    });
  }
}
