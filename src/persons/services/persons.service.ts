import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreatePersonDto } from '../dto/create-person.dto';
import { UpdatePersonDto } from '../dto/update-person.dto';
import { Person, TypeIdentityCard } from '../entities/person.entity';

import { ContractPerson, PersonRole } from '../../contracts/entities/contract-person.entity';
import { ContractsService } from '../../contracts/services/contracts.service';
import { PlansService } from '../../plans/services/plans.service';

@Injectable()
export class PersonsService {
  constructor(
    @InjectRepository(Person)
    private personsRepository: Repository<Person>,
    @InjectRepository(ContractPerson)
    private contractPersonRepository: Repository<ContractPerson>,
    private plansService: PlansService,
    @Inject(forwardRef(() => ContractsService))
    private contractsService: ContractsService,
  ) {}

  async create(createPersonDto: CreatePersonDto): Promise<Person> {
    const { planId, contractId, role, isBillingOwner, ...personData } = createPersonDto;
    const resolvedRole = role || PersonRole.AFILIADO;

    // Check if a person with this identityCard already exists
    const person = await this.findByIdentityCard(
      personData.identityCard,
      personData.typeIdentityCard,
    );

    if (person) {
      // If contractId is provided, associate the existing person to this contract
      if (contractId) {
        const contract = await this.contractsService.findOne(contractId);
        if (!contract) {
          throw new NotFoundException(`Contract with ID "${contractId}" not found`);
        }

        // Check if the person is already associated with this contract
        const existingJunction = await this.contractPersonRepository.findOne({
          where: { contract: { id: contractId }, person: { id: person.id } },
        });

        if (!existingJunction) {
          // Wrap in transaction: delete old junctions + create new one atomically
          await this.contractPersonRepository.manager.transaction(async (em) => {
            // Un AFILIADO solo puede pertenecer a un contrato; eliminar los demás vínculos.
            if (resolvedRole === PersonRole.AFILIADO) {
              const affiliateJunctions = await em.find(ContractPerson, {
                where: { person: { id: person.id }, role: PersonRole.AFILIADO },
                relations: ['contract'],
              });

              const contractsToRecalc: string[] = [];
              for (const cp of affiliateJunctions) {
                if (cp.contract.id !== contractId) {
                  await em.remove(cp);
                  contractsToRecalc.push(cp.contract.id);
                }
              }

              // Recalculate old contracts after removal
              for (const cid of contractsToRecalc) {
                await this.contractsService.recalculateMonthlyAmount(cid);
              }
            }

            // Create junction table entry
            const contractPerson = em.create(ContractPerson, {
              contract,
              person,
              role: resolvedRole,
              isBillingOwner: isBillingOwner ?? false,
            });
            await em.save(contractPerson);

            await this.contractsService.recalculateMonthlyAmount(contractId);
          });
        } else {
          throw new BadRequestException('La persona ya está afiliada a este contrato.');
        }
      }
      return person;
    }

    // Normal flow when person does NOT exist:
    // Titulars don't have a plan
    let plan = null;
    if (resolvedRole === PersonRole.AFILIADO && planId) {
      plan = await this.plansService.findOne(planId);
      if (!plan) {
        throw new NotFoundException(`Plan with ID "${planId}" not found`);
      }
    }

    let contract = null;
    if (contractId) {
      contract = await this.contractsService.findOne(contractId);
      if (!contract) {
        throw new NotFoundException(`Contract with ID "${contractId}" not found`);
      }
    }

    const newPerson = this.personsRepository.create({
      ...personData,
      plan,
    });

    const savedPerson = await this.personsRepository.save(newPerson);

    if (contract) {
      // Create junction table entry
      const contractPerson = this.contractPersonRepository.create({
        contract,
        person: savedPerson,
        role: resolvedRole,
        isBillingOwner: isBillingOwner ?? false,
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
  ): Promise<Person | null> {
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
    // ── 1. Destructuring & fast-fail ─────────────────────────────────────────
    const { planId, contractId, role, isBillingOwner, ...updateData } = updatePersonDto;

    if (!contractId) {
      throw new BadRequestException('Contract ID is required.');
    }

    // ── 2. Cargar persona y contrato ─────────────────────────────────────────
    const person = await this.findOne(id);

    const contract = await this.contractsService.findOne(contractId);
    if (!contract) {
      throw new NotFoundException(`Contract with ID "${contractId}" not found`);
    }

    // ── 3. Resolver junction existente y rol ─────────────────────────────────

    const existingJunction = await this.contractPersonRepository.findOne({
      where: { contract: { id: contractId }, person: { id: person.id } },
    });

    // Si no viene role en el DTO, heredar el rol actual de la junction,
    // o usar AFILIADO como valor por defecto si es una unión nueva.
    const resolvedRole = role ?? existingJunction?.role ?? PersonRole.AFILIADO;

    // ── 4. Resolver plan ─────────────────────────────────────────────────────
    // Los TITULARs no tienen plan propio; nunca forzamos plan = null porque
    // la persona puede ser AFILIADO en otro contrato que sí depende de ese plan.
    let plan = person.plan;
    if (planId && resolvedRole === PersonRole.AFILIADO) {
      const newPlan = await this.plansService.findOne(planId);
      if (!newPlan) {
        throw new NotFoundException(`Plan with ID "${planId}" not found`);
      }
      plan = newPlan;
    }

    // ── 5. Guardar persona ───────────────────────────────────────────────────
    const updatedPerson = Object.assign(person, { ...updateData, plan });
    const savedPerson = await this.personsRepository.save(updatedPerson);

    // ── 6. Gestionar junction (crear / actualizar) ───────────────────────────
    const contractsToRecalculate = new Set<string>();

    if (resolvedRole === PersonRole.AFILIADO) {
      // Un AFILIADO solo puede pertenecer a un contrato; eliminar los demás vínculos.
      await this.contractPersonRepository.manager.transaction(async (em) => {
        const afiliadoJunctions = await em.find(ContractPerson, {
          where: { person: { id: savedPerson.id }, role: PersonRole.AFILIADO },
          relations: ['contract'],
        });

        for (const cp of afiliadoJunctions) {
          if (cp.contract.id !== contractId) {
            await em.remove(cp);
            contractsToRecalculate.add(cp.contract.id);
          }
        }
      });
    }

    if (existingJunction) {
      // Actualizar role e isBillingOwner solo si alguno cambió.
      const junctionNeedsUpdate =
        (role !== undefined && existingJunction.role !== role) ||
        (isBillingOwner !== undefined && existingJunction.isBillingOwner !== isBillingOwner);

      if (junctionNeedsUpdate) {
        if (role !== undefined) {
          if (role === PersonRole.TITULAR && existingJunction.role !== PersonRole.TITULAR) {
            await this.contractPersonRepository.update(
              { contract: { id: contractId } },
              { role: PersonRole.AFILIADO },
            );
          }
          existingJunction.role = role;
        }
        if (isBillingOwner !== undefined) existingJunction.isBillingOwner = isBillingOwner;
        await this.contractPersonRepository.save(existingJunction);
      }
    } else {
      // Crear nueva junction con role e isBillingOwner.
      const contractPerson = this.contractPersonRepository.create({
        contract,
        person: savedPerson,
        role: resolvedRole,
        isBillingOwner: isBillingOwner ?? false,
      });
      await this.contractPersonRepository.save(contractPerson);
    }

    contractsToRecalculate.add(contractId);

    // ── 7. Recalcular contratos afectados ────────────────────────────────────
    // Incluir los contratos previos de la persona (por si cambió el plan global).
    for (const cp of person.contractPersons ?? []) {
      contractsToRecalculate.add(cp.contract.id);
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
