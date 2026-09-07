import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { InvoiceService } from '../../billing/invoices/services/invoice.service';
import { resolveQueryRunner } from '../../common/context/request-context';
import { Transactional } from '../../common/decorators/transactional.decorator';
import { Person, PersonStatus, TypeIdentityCard } from '../../persons/entities/person.entity';
import { PersonsService } from '../../persons/services/persons.service';
import { Plan } from '../../plans/entities/plan.entity';
import { PlansService } from '../../plans/services/plans.service';
import {
  ContractBeneficiaryItem,
  ContractVerificationResult,
  PersonVerificationResult,
  UnifiedVerificationResult,
} from '../interfaces/person-verification.interface';
import { BulkUpdateBeneficiariesDto } from '../dto/bulk-update-beneficiaries.dto';
import { CreateBeneficiaryDto } from '../dto/create-beneficiary.dto';
import { SetBillingOwnerDto } from '../dto/set-billing-owner.dto';
import { SetContractTitularDto } from '../dto/set-contract-titular.dto';
import { UpdateBeneficiaryDto } from '../dto/update-beneficiary.dto';
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
          contract: { status: In([ContractStatus.ACTIVE, ContractStatus.SUSPENDED]) },
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

  /**
   * Updates an existing beneficiary in a contract.
   * Modifies person attributes (via PersonsService), plan, relationship, and health declarations.
   * If plan changes, updates active invoice line and recalculates monthly amount.
   */
  @Transactional()
  async updateBeneficiary(
    contractId: string,
    contractPersonId: string,
    dto: UpdateBeneficiaryDto,
    existingManager?: EntityManager,
  ): Promise<ContractPerson> {
    const manager = existingManager ?? resolveQueryRunner(undefined, this.dataSource).manager;
    const cpRepo = manager.getRepository(ContractPerson);
    const hdRepo = manager.getRepository(HealthDeclaration);

    // 1. Lock junction row (support searching by contractPersonId OR personId within contract)
    let lockedCp = await cpRepo.findOne({
      where: { id: contractPersonId, contract: { id: contractId } },
      lock: { mode: 'pessimistic_write' },
    });

    if (!lockedCp) {
      lockedCp = await cpRepo.findOne({
        where: { person: { id: contractPersonId }, contract: { id: contractId } },
        lock: { mode: 'pessimistic_write' },
      });
    }

    if (!lockedCp) {
      throw new NotFoundException(
        `Beneficiario con ID "${contractPersonId}" no encontrado en este contrato.`,
      );
    }

    // 2. Load with full relations
    const contractPerson = (await cpRepo.findOne({
      where: { id: lockedCp.id },
      relations: ['contract', 'person', 'person.plan', 'plan'],
    })) as ContractPerson;

    // 3. Update Person fields if provided
    const personDto: Record<string, unknown> = {};
    const personFieldKeys = [
      'name',
      'typeIdentityCard',
      'identityCard',
      'birthDate',
      'gender',
      'phone',
      'alternatePhone',
      'email',
      'address',
      'city',
      'state',
      'postalCode',
      'weight',
      'height',
      'occupation',
      'legalRepresentative',
    ] as const;

    for (const key of personFieldKeys) {
      if (dto[key] !== undefined) {
        personDto[key] = dto[key];
      }
    }

    if (Object.keys(personDto).length > 0) {
      await this.personsService.update(contractPerson.person.id, personDto, manager);
    }

    // 4. Update relationship if provided
    if (dto.relationship !== undefined) {
      contractPerson.relationship = dto.relationship;
    }

    // 5. Update plan if provided
    let planChanged = false;
    if (dto.planId !== undefined) {
      if (contractPerson.role === PersonRole.TITULAR) {
        throw new BadRequestException('El titular no puede tener un plan asignado.');
      }

      if (!dto.planId) {
        throw new BadRequestException('El afiliado debe tener un plan asignado.');
      }

      const newPlan = await this.plansService.findOne(dto.planId);
      if (!newPlan) {
        throw new NotFoundException(`Plan with ID "${dto.planId}" not found`);
      }

      const currentPlanId = contractPerson.plan?.id ?? contractPerson.person?.plan?.id;
      if (currentPlanId !== newPlan.id) {
        contractPerson.plan = newPlan;
        contractPerson.person.plan = newPlan;
        await manager.getRepository(Person).update(contractPerson.person.id, { plan: newPlan });

        await this.invoiceService.updatePlanLineOnActiveInvoice(
          contractId,
          contractPerson.person.id,
          newPlan.id,
          Number(newPlan.amount ?? 0),
          newPlan.name,
        );
        planChanged = true;
      }
    }

    // 6. Update health declarations if provided
    if (dto.healthDeclarations !== undefined) {
      await hdRepo.delete({ contractPerson: { id: lockedCp.id } });
      if (dto.healthDeclarations.length > 0) {
        const newHds = dto.healthDeclarations.map((hd) =>
          hdRepo.create({
            ...hd,
            contractPerson: lockedCp,
          }),
        );
        await hdRepo.save(newHds);
      }
    }

    await cpRepo.save(contractPerson);

    // 7. Recalculate monthly amount if plan changed
    if (planChanged) {
      await this.recalculateMonthlyAmount(contractId, manager);
    }

    return (await cpRepo.findOne({
      where: { id: lockedCp.id },
      relations: ['contract', 'person', 'person.plan', 'plan', 'healthDeclarations'],
    })) as ContractPerson;
  }

  /**
   * Bulk updates multiple beneficiaries in a contract in a single transaction.
   * Recalculates the monthly amount once after all beneficiaries are updated.
   */
  @Transactional()
  async bulkUpdateBeneficiaries(
    contractId: string,
    dto: BulkUpdateBeneficiariesDto,
  ): Promise<ContractPerson[]> {
    const qr = resolveQueryRunner(undefined, this.dataSource);
    const manager = qr.manager;

    const contract = await manager.getRepository(Contract).findOne({
      where: { id: contractId },
    });
    if (!contract) {
      throw new NotFoundException(`Contract with ID "${contractId}" not found`);
    }

    const updatedBeneficiaries: ContractPerson[] = [];

    for (const item of dto.beneficiaries) {
      const contractPersonId = item.contractPersonId || item.id;
      if (!contractPersonId) {
        throw new BadRequestException('Cada elemento debe contener contractPersonId o id.');
      }
      const updated = await this.updateBeneficiary(contractId, contractPersonId, item, manager);
      updatedBeneficiaries.push(updated);
    }

    await this.recalculateMonthlyAmount(contractId, manager);

    return updatedBeneficiaries;
  }

  /**
   * Verifies a person's affiliation status across all contracts where they are a beneficiary (AFILIADO).
   * Returns person data and all contracts where they are registered as a beneficiary,
   * sorted with priority: ACTIVE (1), SUSPENDED (2), INACTIVE (3), and newest affiliationDate first.
   */
  async verifyPersonAffiliation(
    typeIdentityCard: TypeIdentityCard,
    identityCard: string,
  ): Promise<PersonVerificationResult> {
    const cleanNumber = identityCard.trim();
    const person = await this.personsService.findByIdentityCard(cleanNumber, typeIdentityCard);

    if (!person) {
      throw new NotFoundException(
        `No se encontró ninguna persona registrada con la cédula ${typeIdentityCard}-${cleanNumber}.`,
      );
    }

    let affiliations = await this.contractPersonsRepository.find({
      where: {
        person: { id: person.id },
        role: PersonRole.AFILIADO,
      },
      relations: ['contract', 'plan', 'person', 'person.plan'],
      order: {
        createdAt: 'DESC',
      },
    });

    if (affiliations.length === 0) {
      affiliations = await this.contractPersonsRepository.find({
        where: {
          person: { id: person.id },
          role: PersonRole.TITULAR,
        },
        relations: ['contract', 'plan', 'person', 'person.plan'],
        order: {
          createdAt: 'DESC',
        },
      });
    }

    const statusPriority: Record<ContractStatus, number> = {
      [ContractStatus.ACTIVE]: 1,
      [ContractStatus.SUSPENDED]: 2,
      [ContractStatus.INACTIVE]: 3,
    };

    const seenContracts = new Set<string>();
    const contracts = affiliations
      .filter((cp) => {
        if (!cp.contract || seenContracts.has(cp.contract.id)) return false;
        seenContracts.add(cp.contract.id);
        return true;
      })
      .map((cp) => ({
        id: cp.contract.id,
        code: cp.contract.code,
        status: cp.contract.status,
        affiliationDate: cp.contract.affiliationDate,
        role: cp.role,
        planName: cp.plan?.name ?? cp.person?.plan?.name ?? null,
        isSuspended: cp.contract.status === ContractStatus.SUSPENDED,
      }))
      .sort((a, b) => {
        const pA = statusPriority[a.status] ?? 99;
        const pB = statusPriority[b.status] ?? 99;
        if (pA !== pB) return pA - pB;
        const dA = a.affiliationDate ? new Date(a.affiliationDate).getTime() : 0;
        const dB = b.affiliationDate ? new Date(b.affiliationDate).getTime() : 0;
        return dB - dA;
      });

    const hasActiveContract = contracts.some((c) => c.status === ContractStatus.ACTIVE);
    const hasSuspendedContract = contracts.some((c) => c.status === ContractStatus.SUSPENDED);

    return {
      mode: 'BY_BENEFICIARY',
      person: {
        id: person.id,
        name: person.name,
        typeIdentityCard: person.typeIdentityCard,
        identityCard: person.identityCard,
        phone: person.phone,
        birthDate: person.birthDate,
        status: person.status,
      },
      contracts,
      hasActiveContract,
      hasSuspendedContract,
    };
  }

  /**
   * Verifies a contract by its code or legacyCode.
   * Returns contract data, titular information, and all its beneficiaries (role === AFILIADO).
   */
  async verifyContractByCode(code: string): Promise<ContractVerificationResult> {
    const trimmed = code.trim();
    const contract = await this.contractsRepository.findOne({
      where: [{ code: trimmed }, { legacyCode: trimmed }],
      relations: [
        'contractPersons',
        'contractPersons.person',
        'contractPersons.plan',
        'contractPersons.person.plan',
      ],
    });

    if (!contract) {
      throw new NotFoundException(`No se encontró ningún contrato con el código "${trimmed}".`);
    }

    const titularCp = contract.contractPersons?.find(
      (cp) => cp.role === PersonRole.TITULAR || cp.isBillingOwner === true,
    );

    const titularPerson = titularCp?.person ?? null;

    const beneficiaryCps =
      contract.contractPersons?.filter((cp) => cp.role === PersonRole.AFILIADO) ?? [];

    const beneficiaries: ContractBeneficiaryItem[] = beneficiaryCps.map((cp) => {
      const plan = cp.plan ?? cp.person?.plan ?? null;
      const person = cp.person;
      const isEligible =
        contract.status === ContractStatus.ACTIVE && person?.status === PersonStatus.ACTIVE;

      return {
        contractPersonId: cp.id,
        personId: person?.id,
        name: person?.name,
        typeIdentityCard: person?.typeIdentityCard,
        identityCard: person?.identityCard,
        birthDate: person?.birthDate,
        phone: person?.phone,
        relationship: cp.relationship,
        planName: plan?.name ?? null,
        personStatus: person?.status,
        isEligible,
      };
    });

    return {
      mode: 'BY_CONTRACT',
      contract: {
        id: contract.id,
        code: contract.code,
        status: contract.status,
        isSuspended: contract.status === ContractStatus.SUSPENDED,
        affiliationDate: contract.affiliationDate,
        cutoffDay: contract.cutoffDay ?? 5,
        titular: titularPerson
          ? {
              id: titularPerson.id,
              name: titularPerson.name,
              typeIdentityCard: titularPerson.typeIdentityCard,
              identityCard: titularPerson.identityCard,
              phone: titularPerson.phone,
            }
          : null,
      },
      beneficiaries,
      totalBeneficiaries: beneficiaries.length,
    };
  }

  /**
   * Unified verification: Auto-detects whether rawQuery represents a contract code
   * or a personal identity document (including Partida de Nacimiento "PN").
   */
  async verifyUnified(rawQuery: string): Promise<UnifiedVerificationResult> {
    if (!rawQuery || !rawQuery.trim()) {
      throw new BadRequestException(
        'Debe proporcionar un valor de búsqueda (código de contrato o documento de identidad).',
      );
    }

    const query = rawQuery.trim();

    // 1. Intentar buscar primero como código de contrato (ej. SIR-001-00001 o legacyCode)
    const contract = await this.contractsRepository.findOne({
      where: [{ code: query }, { legacyCode: query }],
      select: ['id', 'code'],
    });

    if (contract) {
      return this.verifyContractByCode(contract.code);
    }

    // 2. Si no es contrato directo, intentar interpretar como documento de identidad
    // Formatos soportados:
    // - Documentos tradicionales: "V-12345678", "V12345678", "E-84123456", "12345678"
    // - Partidas de Nacimiento (PN): "PN-12345678-1", "PN12345678-1", "12345678-1", "V-12345678-1", "PN-12345678"
    const docRegex = /^([a-zA-Z]{1,2})[-_\s]?(\d+(?:[-/]\d+)?)$/;
    const match = query.match(docRegex);

    let type: TypeIdentityCard | null = null;
    let number: string = query;

    if (match) {
      const candidateType = match[1].toUpperCase() as TypeIdentityCard;
      if (Object.values(TypeIdentityCard).includes(candidateType)) {
        type = candidateType;
        number = match[2].replace('/', '-');
      }
    }

    const cleanNumber = number.replace('/', '-');

    // 2a. Si se detectó tipo explícito (ej: V-12345678 o PN-12345678-1), intentar verificación directa
    if (type) {
      try {
        return await this.verifyPersonAffiliation(type, cleanNumber);
      } catch (err) {
        if (!(err instanceof NotFoundException)) {
          throw err;
        }
      }
    }

    // 2b. Si el usuario buscó con prefijo PN explícito pero omitió el correlativo (ej. "PN-12345678")
    if (type === TypeIdentityCard.PN && !cleanNumber.includes('-')) {
      const pnPersons = await this.personsService.findPNsByTitularIdentityCard(cleanNumber);
      if (pnPersons.length === 1) {
        return this.verifyPersonAffiliation(TypeIdentityCard.PN, pnPersons[0].identityCard);
      } else if (pnPersons.length > 1) {
        const cp = await this.contractPersonsRepository.findOne({
          where: { person: { id: In(pnPersons.map((p) => p.id)) } },
          relations: ['contract'],
        });
        if (cp?.contract) {
          return this.verifyContractByCode(cp.contract.code);
        }
      }
    }

    // 2c. Fallback por identityCard exacto sin importar el tipo
    // Cubre "12345678-1" (sin prefijo PN), "V-12345678-1" (prefijo V erróneo), o "12345678" (cédula pura sin prefijo)
    const personByDoc =
      (await this.personsService.findByIdentityCardOnly(cleanNumber)) ??
      (cleanNumber !== query ? await this.personsService.findByIdentityCardOnly(query) : null);

    if (personByDoc) {
      return this.verifyPersonAffiliation(personByDoc.typeIdentityCard, personByDoc.identityCard);
    }

    // 2d. Fallback para cédulas sin guión que pudieran tener un PN asociado único
    if (!cleanNumber.includes('-')) {
      const pnPersons = await this.personsService.findPNsByTitularIdentityCard(cleanNumber);
      if (pnPersons.length === 1) {
        return this.verifyPersonAffiliation(TypeIdentityCard.PN, pnPersons[0].identityCard);
      }
    }

    // 2e. Último intento con tipo asumido (o TypeIdentityCard.V)
    const fallbackType = type ?? TypeIdentityCard.V;
    try {
      return await this.verifyPersonAffiliation(fallbackType, cleanNumber);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new NotFoundException(
          `No se encontró ningún contrato ni beneficiario para la búsqueda "${query}".`,
        );
      }
      throw err;
    }
  }
}
