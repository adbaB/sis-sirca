import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreatePersonDto } from '../dto/create-person.dto';
import { UpdatePersonDto } from '../dto/update-person.dto';
import { Person } from '../entities/person.entity';

import { ContractsService } from '../../contracts/services/contracts.service';
import { PlansService } from '../../plans/services/plans.service';

@Injectable()
export class PersonsService {
  constructor(
    @InjectRepository(Person)
    private personsRepository: Repository<Person>,
    private plansService: PlansService,
    private contractsService: ContractsService,
  ) {}

  async create(createPersonDto: CreatePersonDto): Promise<Person> {
    const { planId, contractId, ...personData } = createPersonDto;

    const plan = await this.plansService.findOne(planId);
    if (!plan) {
      throw new NotFoundException(`Plan with ID "${planId}" not found`);
    }

    let contract = null;
    if (contractId) {
      contract = await this.contractsService.findOne(contractId);
      if (!contract) {
        throw new NotFoundException(`Contract with ID "${contractId}" not found`);
      }
    }

    const person = this.personsRepository.create({
      ...personData,
      plan,
      contract,
    });

    const savedPerson = await this.personsRepository.save(person);

    if (contractId) {
      await this.contractsService.recalculateMonthlyAmount(contractId);
    }

    return savedPerson;
  }

  async findAll(): Promise<Person[]> {
    return this.personsRepository.find({ relations: ['plan', 'contract'] });
  }

  async findOne(id: string): Promise<Person> {
    const person = await this.personsRepository.findOne({
      where: { id },
      relations: ['plan', 'contract'],
    });
    if (!person) {
      throw new NotFoundException(`Person with ID "${id}" not found`);
    }
    return person;
  }

  async update(id: string, updatePersonDto: UpdatePersonDto): Promise<Person> {
    const person = await this.findOne(id);
    const oldContractId = person.contract ? person.contract.id : null;
    const { planId, contractId, ...updateData } = updatePersonDto;

    let plan = person.plan;
    if (planId) {
      const newPlan = await this.plansService.findOne(planId);
      if (!newPlan) {
        throw new NotFoundException(`Plan with ID "${planId}" not found`);
      }
      plan = newPlan;
    }

    let contract = person.contract;
    if (contractId !== undefined) {
      if (contractId === null) {
        contract = null;
      } else {
        const newContract = await this.contractsService.findOne(contractId);
        if (!newContract) {
          throw new NotFoundException(`Contract with ID "${contractId}" not found`);
        }
        contract = newContract;
      }
    }

    const updatedPerson = Object.assign(person, { ...updateData, plan, contract });
    const savedPerson = await this.personsRepository.save(updatedPerson);

    // Recalculate for the new contract
    if (contract && contract.id) {
      await this.contractsService.recalculateMonthlyAmount(contract.id);
    }

    // Recalculate for the old contract if it changed
    if (oldContractId && oldContractId !== (contract ? contract.id : null)) {
      await this.contractsService.recalculateMonthlyAmount(oldContractId);
    }

    // Also recalculate if only the plan changed but the contract remained the same
    if (planId && oldContractId && oldContractId === (contract ? contract.id : null)) {
      await this.contractsService.recalculateMonthlyAmount(oldContractId);
    }

    return savedPerson;
  }

  async remove(id: string): Promise<void> {
    const person = await this.findOne(id);
    const contractId = person.contract ? person.contract.id : null;
    await this.personsRepository.softRemove(person);

    if (contractId) {
      await this.contractsService.recalculateMonthlyAmount(contractId);
    }
  }
}
