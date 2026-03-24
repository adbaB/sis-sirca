import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreatePersonDto } from '../dto/create-person.dto';
import { UpdatePersonDto } from '../dto/update-person.dto';
import { Person, TypeIdentityCard } from '../entities/person.entity';

import { ContractsService } from '../../contracts/services/contracts.service';
import { PlansService } from '../../plans/services/plans.service';
import { ContractPerson, PersonRole } from '../../contracts/entities/contract-person.entity';

@Injectable()
export class PersonsService {
  constructor(
    @InjectRepository(Person)
    private personsRepository: Repository<Person>,
    @InjectRepository(ContractPerson)
    private contractPersonRepository: Repository<ContractPerson>,
    private plansService: PlansService,
    private contractsService: ContractsService,
  ) {}

  async create(createPersonDto: CreatePersonDto): Promise<Person> {
    const { planId, contractId, role, ...personData } = createPersonDto;
    const resolvedRole = role || PersonRole.AFILIADO;

    // Titulars don't have a plan
    let plan = null;
    if (resolvedRole === PersonRole.AFILIADO && planId) {
      plan = await this.plansService.findOne(planId);
      if (!plan) {
        throw new NotFoundException(`Plan with ID "${planId}" not found`);
      }
    }

    if (resolvedRole === PersonRole.TITULAR && planId) {
      throw new BadRequestException('A TITULAR person cannot have a plan.');
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
    });

    const savedPerson = await this.personsRepository.save(person);

    if (contract) {
      // Create junction table entry
      const contractPerson = this.contractPersonRepository.create({
        contract,
        person: savedPerson,
        role: resolvedRole,
      });
      await this.contractPersonRepository.save(contractPerson);

      await this.contractsService.recalculateMonthlyAmount(contractId);
    }

    return savedPerson;
  }

  async findAll(): Promise<Person[]> {
    return this.personsRepository.find({
      relations: ['plan', 'contractPersons', 'contractPersons.contract'],
    });
  }

  async findByIdentityCard(
    identityCard: string,
    typeIdentityCard: TypeIdentityCard,
  ): Promise<Person> {
    return this.personsRepository.findOne({
      where: { identityCard, typeIdentityCard },
      relations: ['plan', 'contractPersons', 'contractPersons.contract'],
    });
  }

  async findOne(id: string): Promise<Person> {
    const person = await this.personsRepository.findOne({
      where: { id },
      relations: ['plan', 'contractPersons', 'contractPersons.contract'],
    });
    if (!person) {
      throw new NotFoundException(`Person with ID "${id}" not found`);
    }
    return person;
  }

  async update(id: string, updatePersonDto: UpdatePersonDto): Promise<Person> {
    const person = await this.findOne(id);
    const { planId, contractId, role, ...updateData } = updatePersonDto;

    // Fast-fail: Validate contract existence before touching the database
    let contract = null;
    if (contractId) {
      contract = await this.contractsService.findOne(contractId);
      if (!contract) {
        throw new NotFoundException(`Contract with ID "${contractId}" not found`);
      }
    }

    // Determine the role. If omitted in the DTO, default to their existing role in the target contract,
    // or fallback to AFILIADO if this is a brand new junction.
    let resolvedRole = role;
    let existingJunction = null;

    if (contractId) {
      existingJunction = await this.contractPersonRepository.findOne({
        where: { contract: { id: contractId }, person: { id: person.id } },
      });
      if (!resolvedRole) {
        resolvedRole = existingJunction ? existingJunction.role : PersonRole.AFILIADO;
      }
    } else {
      resolvedRole = role || PersonRole.AFILIADO;
    }

    let plan = person.plan;
    // Update global plan if specified and we are dealing with an AFILIADO context.
    if (planId) {
      const newPlan = await this.plansService.findOne(planId);
      if (!newPlan) {
        throw new NotFoundException(`Plan with ID "${planId}" not found`);
      }
      plan = newPlan;
    }

    // Never force `plan = null` just because they are being added as a TITULAR to *this* contract,
    // as they might still be an AFILIADO in another contract that depends on that global plan.

    const updatedPerson = Object.assign(person, { ...updateData, plan });
    const savedPerson = await this.personsRepository.save(updatedPerson);

    const contractsToRecalculate = new Set<string>();

    if (contractId !== undefined) {
      if (contractId === null) {
        // Remove from all contracts if explicitly null
        if (person.contractPersons && person.contractPersons.length > 0) {
          for (const cp of person.contractPersons) {
            await this.contractPersonRepository.remove(cp);
            contractsToRecalculate.add(cp.contract.id);
          }
        }
      } else if (contract) {
        if (resolvedRole === PersonRole.AFILIADO) {
          // Validation: an AFILIADO can only be in one contract. If they are in others, remove them.
          const existingAfiliadoJunctions = await this.contractPersonRepository.find({
            where: { person: { id: savedPerson.id }, role: PersonRole.AFILIADO },
            relations: ['contract'],
          });

          for (const cp of existingAfiliadoJunctions) {
            if (cp.contract.id !== contractId) {
              await this.contractPersonRepository.remove(cp);
              contractsToRecalculate.add(cp.contract.id);
            }
          }
        }

        if (existingJunction) {
          // Update the existing role if a new one was provided
          if (role) {
            existingJunction.role = role;
            await this.contractPersonRepository.save(existingJunction);
          }
        } else {
          const contractPerson = this.contractPersonRepository.create({
            contract,
            person: savedPerson,
            role: resolvedRole,
          });
          await this.contractPersonRepository.save(contractPerson);
        }

        contractsToRecalculate.add(contractId);
      }
    }

    // Attempting to recalculate affected contracts (e.g. if their plan changed)
    if (person.contractPersons && person.contractPersons.length > 0) {
      for (const cp of person.contractPersons) {
        contractsToRecalculate.add(cp.contract.id);
      }
    }

    for (const idToRecalculate of contractsToRecalculate) {
      await this.contractsService.recalculateMonthlyAmount(idToRecalculate);
    }

    return savedPerson;
  }

  async remove(id: string): Promise<void> {
    const person = await this.findOne(id);
    const contractIds = person.contractPersons?.map((cp) => cp.contract.id) || [];

    // Clean up junction tables to prevent orphaned records.
    if (person.contractPersons && person.contractPersons.length > 0) {
      await this.contractPersonRepository.remove(person.contractPersons);
    }

    await this.personsRepository.softRemove(person);

    for (const contractId of contractIds) {
      await this.contractsService.recalculateMonthlyAmount(contractId);
    }
  }
}
