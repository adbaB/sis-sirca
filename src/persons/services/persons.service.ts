import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { AffiliationHistory } from '../../contracts/entities/affiliation-history.entity';

import { CreatePersonDto } from '../dto/create-person.dto';
import { UpdatePersonDto } from '../dto/update-person.dto';
import { Person, TypeIdentityCard } from '../entities/person.entity';

import { ContractPerson, PersonRole } from '../../contracts/entities/contract-person.entity';
import { ContractsService } from '../../contracts/services/contracts.service';
import { AffiliationAction } from '../../contracts/enums/affiliation-action.enum';
import { Invoice, InvoiceStatus } from '../../billing/entities/invoice.entity';
import { InvoiceLine } from '../../billing/entities/invoice-line.entity';
import { InvoiceLineCategory } from '../../billing/enums/invoice-line-category.enum';
import { BillingService } from '../../billing/services/billing.service';
import { getBillingMonth } from '../../billing/utils/billing-month.util';
import { PlansService } from '../../plans/services/plans.service';

@Injectable()
export class PersonsService {
  constructor(
    @InjectRepository(Person)
    private personsRepository: Repository<Person>,
    @InjectRepository(ContractPerson)
    private contractPersonRepository: Repository<ContractPerson>,
    @InjectRepository(AffiliationHistory)
    private affiliationHistoryRepository: Repository<AffiliationHistory>,
    @InjectRepository(Invoice)
    private invoiceRepository: Repository<Invoice>,
    @InjectRepository(InvoiceLine)
    private invoiceLineRepository: Repository<InvoiceLine>,
    private plansService: PlansService,
    @Inject(forwardRef(() => ContractsService))
    private contractsService: ContractsService,
    @Inject(forwardRef(() => BillingService))
    private billingService: BillingService,
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
          // BLOQUEAR si el afiliado ya está en otro contrato
          if (resolvedRole === PersonRole.AFILIADO) {
            const existingAffiliations = await this.contractPersonRepository.find({
              where: { person: { id: person.id }, role: PersonRole.AFILIADO },
              relations: ['contract'],
            });

            const otherContractAffiliations = existingAffiliations.filter(
              (cp) => cp.contract.id !== contractId,
            );

            if (otherContractAffiliations.length > 0) {
              const contractCodes = otherContractAffiliations
                .map((cp) => cp.contract.code)
                .join(', ');
              throw new BadRequestException(
                `El afiliado ${person.name} (${person.typeIdentityCard}-${person.identityCard}) ya pertenece al contrato: ${contractCodes}. Debe ser desafiliado primero antes de asignarlo a otro contrato.`,
              );
            }
          }

          // Create junction table entry
          const contractPerson = this.contractPersonRepository.create({
            contract,
            person,
            role: resolvedRole,
            isBillingOwner: isBillingOwner ?? false,
          });
          await this.contractPersonRepository.save(contractPerson);

          // Registrar en historial
          await this.affiliationHistoryRepository.save(
            this.affiliationHistoryRepository.create({
              contract: { id: contractId },
              person,
              plan: person.plan ?? null,
              action: AffiliationAction.AFILIACION,
              amount: Number(person.plan?.amount ?? 0),
            }),
          );

          await this.contractsService.recalculateMonthlyAmount(contractId);

          // Auto-generar cargo INCLUSION en la factura activa del mes
          if (resolvedRole === PersonRole.AFILIADO) {
            await this.autoAddInclusionCharge(contractId, person);
          }
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

      // Registrar en historial
      if (resolvedRole === PersonRole.AFILIADO) {
        await this.affiliationHistoryRepository.save(
          this.affiliationHistoryRepository.create({
            contract: { id: contractId },
            person: savedPerson,
            plan: plan ?? null,
            action: AffiliationAction.AFILIACION,
            amount: Number(plan?.amount ?? 0),
          }),
        );

        // Auto-generar cargo INCLUSION en la factura activa del mes
        await this.autoAddInclusionCharge(contractId, savedPerson);
      }
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

    // ── 2.1. Validar unicidad de la cédula/RIF ──────────────────────────────
    const targetIdentityCard = updateData.identityCard ?? person.identityCard;
    const targetTypeIdentityCard = updateData.typeIdentityCard ?? person.typeIdentityCard;

    if (
      targetIdentityCard !== person.identityCard ||
      targetTypeIdentityCard !== person.typeIdentityCard
    ) {
      const existingPerson = await this.personsRepository.findOne({
        where: { identityCard: targetIdentityCard, typeIdentityCard: targetTypeIdentityCard },
        withDeleted: true,
      });

      if (existingPerson && existingPerson.id !== id) {
        throw new BadRequestException(
          `La cédula o RIF ${targetTypeIdentityCard}-${targetIdentityCard} ya está registrada.`,
        );
      }
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
    const oldPlanId = person.plan?.id;
    const updatedPerson = Object.assign(person, { ...updateData, plan });
    const savedPerson = await this.personsRepository.save(updatedPerson);

    // ── 5.1. Si el plan cambió, actualizar la línea en la factura activa ────
    if (planId && plan && plan.id !== oldPlanId) {
      await this.billingService.updatePlanLineOnActiveInvoice(
        contractId,
        savedPerson.id,
        plan.id,
        Number(plan.amount),
        plan.name,
      );
    }

    // ── 6. Gestionar junction (crear / actualizar) ───────────────────────────
    const contractsToRecalculate = new Set<string>();

    if (resolvedRole === PersonRole.AFILIADO) {
      // BLOQUEAR si el afiliado ya está en otro contrato
      const afiliadoJunctions = await this.contractPersonRepository.find({
        where: { person: { id: savedPerson.id }, role: PersonRole.AFILIADO },
        relations: ['contract'],
      });

      const otherContracts = afiliadoJunctions.filter((cp) => cp.contract.id !== contractId);
      if (otherContracts.length > 0) {
        const contractCodes = otherContracts.map((cp) => cp.contract.code).join(', ');
        throw new BadRequestException(
          `El afiliado ${savedPerson.name} ya pertenece al contrato: ${contractCodes}. Debe ser desafiliado primero.`,
        );
      }
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
              { contract: { id: contractId }, deletedAt: IsNull() },
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
      await this.contractPersonRepository.softRemove(person.contractPersons);
    }

    await this.personsRepository.softRemove(person);

    for (const contractId of contractIds) {
      await this.contractsService.recalculateMonthlyAmount(contractId);
    }
  }

  /**
   * Si ya existe una factura PENDING o PARTIAL para el mes en curso,
   * agrega automáticamente una línea INCLUSION para el afiliado recién agregado,
   * siempre que este no tenga ya una línea MENSUALIDAD en esa factura.
   *
   * Esto cubre el caso donde la factura ya fue generada por el cron (día 25)
   * y el afiliado se incorpora después de esa fecha.
   */
  private async autoAddInclusionCharge(contractId: string, person: Person): Promise<void> {
    const billingMonth = getBillingMonth();

    // Buscar factura activa del mes actual para este contrato
    const invoice = await this.invoiceRepository.findOne({
      where: {
        contract: { id: contractId },
        billingMonth,
        status: In([InvoiceStatus.PENDING, InvoiceStatus.PARTIAL, InvoiceStatus.PAID]),
      },
    });

    // Si no hay factura aún, el cron la creará con el afiliado incluido
    if (!invoice) return;

    // Verificar si ya tiene línea MENSUALIDAD para esta persona
    const existingMensualidad = await this.invoiceLineRepository.findOne({
      where: {
        invoice: { id: invoice.id },
        person: { id: person.id },
        category: InvoiceLineCategory.MENSUALIDAD,
        deletedAt: IsNull(),
      },
    });

    // Ya tiene mensualidad — la factura estaba actualizada, no hace falta INCLUSION
    if (existingMensualidad) return;

    const planAmount = Number(person.plan?.amount ?? 0);
    if (planAmount <= 0) return;

    // Crear línea INCLUSION (no proyectable — cargo puntual por incorporación)
    const line = this.invoiceLineRepository.create({
      invoice,
      category: InvoiceLineCategory.INCLUSION,
      description: `Inclusión: ${person.name} - ${person.plan?.name ?? 'Plan'}`,
      amount: planAmount,
      quantity: 1,
      person,
      plan: person.plan ?? null,
      isProjectable: false,
    });

    await this.invoiceLineRepository.save(line);

    // Recalcular totalAmount = baseAmount + SUM(líneas no proyectables activas)
    const result = await this.invoiceLineRepository
      .createQueryBuilder('line')
      .select('COALESCE(SUM(line.amount * line.quantity), 0)', 'total')
      .where('line.invoice_id = :invoiceId', { invoiceId: invoice.id })
      .andWhere('line.is_projectable = false')
      .andWhere('line.deleted_at IS NULL')
      .getRawOne<{ total: string }>();

    const additionalAmount = Number(result?.total ?? 0);
    invoice.totalAmount = Number(invoice.baseAmount) + additionalAmount;

    // Ajustar status si corresponde
    if (invoice.paidAmount < invoice.totalAmount && invoice.status === InvoiceStatus.PAID) {
      invoice.status = InvoiceStatus.PARTIAL;
    }

    await this.invoiceRepository.save(invoice);
  }
}
