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
    const contract = this.contractsRepository.create(createContractDto);
    return this.contractsRepository.save(contract);
  }

  async findAll(): Promise<Contract[]> {
    return this.contractsRepository.find({ relations: ['persons', 'persons.plan'] });
  }

  async findOne(id: string): Promise<Contract> {
    const contract = await this.contractsRepository.findOne({
      where: { id },
      relations: ['persons', 'persons.plan'],
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
   * Recalculates the monthly amount for a given contract ID
   * by summing the amount of all plans associated to its persons.
   */
  async recalculateMonthlyAmount(contractId: string): Promise<void> {
    const contract = await this.contractsRepository.findOne({
      where: { id: contractId, persons: { status: PersonStatus.ACTIVE } },
      relations: ['persons', 'persons.plan'],
    });

    if (!contract) return;

    const totalAmount = contract.persons.reduce((sum, person) => {
      // Sum the plan amount if the person has a plan
      const amount = person.plan ? Number(person.plan.amount) : 0;
      return sum + amount;
    }, 0);

    contract.monthlyAmount = totalAmount;
    await this.contractsRepository.save(contract);
  }
}
