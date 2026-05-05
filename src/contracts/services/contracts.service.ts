import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreateContractDto } from '../dto/create-contract.dto';
import { UpdateContractDto } from '../dto/update-contract.dto';
import { Contract } from '../entities/contract.entity';
import { PersonStatus } from '../../persons/entities/person.entity';

@Injectable()
export class ContractsService {
  constructor(
    @InjectRepository(Contract)
    private contractsRepository: Repository<Contract>,
  ) {}

  async create(createContractDto: CreateContractDto): Promise<Contract> {
    const { advisorId, ...rest } = createContractDto;
    const contract = this.contractsRepository.create({
      ...rest,
      ...(advisorId ? { advisor: { id: advisorId } } : {}),
    });
    return this.contractsRepository.save(contract);
  }

  async findAll(): Promise<Contract[]> {
    return this.contractsRepository.find({
      relations: ['contractPersons', 'contractPersons.person', 'contractPersons.person.plan'],
    });
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
      relations: ['contractPersons', 'contractPersons.person', 'contractPersons.person.plan'],
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

  /**
   * Recalculates the monthly amount for a given contract ID
   * by summing the amount of all plans associated to its persons (only AFILIADOS have plans).
   */
  async recalculateMonthlyAmount(contractId: string): Promise<void> {
    const contract = await this.contractsRepository.findOne({
      where: { id: contractId, contractPersons: { person: { status: PersonStatus.ACTIVE } } },
      relations: ['contractPersons', 'contractPersons.person', 'contractPersons.person.plan'],
    });

    if (!contract || !contract.contractPersons) return;

    const totalAmount = contract.contractPersons.reduce((sum, cp) => {
      // Sum the plan amount if the person is an AFILIADO and has a plan
      if (cp.role === 'AFILIADO' && cp.person && cp.person.plan) {
        return sum + Number(cp.person.plan.amount);
      }
      return sum;
    }, 0);

    contract.monthlyAmount = totalAmount;
    await this.contractsRepository.save(contract);
  }
}
