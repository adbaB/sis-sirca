import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { AffiliationHistory } from '../entities/affiliation-history.entity';
import { SystemCounter } from '../../common/entities/system-counter.entity';

import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import { paginateQueryBuilder } from '../../common/utils/pagination.util';
import { Person, PersonStatus } from '../../persons/entities/person.entity';
import { PersonsService } from '../../persons/services/persons.service';
import { CreateBeneficiaryDto } from '../dto/create-beneficiary.dto';
import { InactivateContractDto } from '../dto/inactivate-contract.dto';
import { CreateContractDto } from '../dto/create-contract.dto';
import { CreateContractFullDto } from '../dto/create-contract-full.dto';
import { FindContractDto } from '../dto/find-contract.dto';
import { SetBillingOwnerDto } from '../dto/set-billing-owner.dto';
import { SetContractTitularDto } from '../dto/set-contract-titular.dto';
import { UpdateContractDto } from '../dto/update-contract.dto';
import { ContractPerson, PersonRole } from '../entities/contract-person.entity';
import { Contract, ContractStatus } from '../entities/contract.entity';
import { AffiliationAction } from '../enums/affiliation-action.enum';
import { Advisor } from '../../advisors/entities/advisor.entity';
import { Portfolio } from '../../portfolios/entities/portfolio.entity';
import { BillingService } from '../../billing/services/billing.service';
import { PlansService } from '../../plans/services/plans.service';
import { DateTime } from 'luxon';
import {
  parseBirthDate,
  CARACAS_ZONE,
  getCaracasTodayJSDate,
  getCaracasDateTime,
} from '../../common/utils/date.util';
import { Plan } from '../../plans/entities/plan.entity';
import { HealthDeclaration, HealthCategory } from '../entities/health-declaration.entity';
import { PdfService } from '../../pdf/services/pdf.service';
import { AwsService } from '../../aws/aws.service';
import { loadLogoBase64 } from '../../reports/report-utils';

export interface PipelineTotals {
  totalPipeline: number;
  totalCollected: number;
  totalPending: number;
}

export interface PipelineCounts {
  pending: number;
  rejected: number;
  partial: number;
  paid: number;
}

const SPANISH_MONTHS = [
  'ENERO',
  'FEBRERO',
  'MARZO',
  'ABRIL',
  'MAYO',
  'JUNIO',
  'JULIO',
  'AGOSTO',
  'SEPTIEMBRE',
  'OCTUBRE',
  'NOVIEMBRE',
  'DICIEMBRE',
];

const SPANISH_DAYS: Record<number, string> = {
  1: 'UN',
  2: 'DOS',
  3: 'TRES',
  4: 'CUATRO',
  5: 'CINCO',
  6: 'SEIS',
  7: 'SIETE',
  8: 'OCHO',
  9: 'NUEVE',
  10: 'DIEZ',
  11: 'ONCE',
  12: 'DOCE',
  13: 'TRECE',
  14: 'CATORCE',
  15: 'QUINCE',
  16: 'DIECISEIS',
  17: 'DIECISIETE',
  18: 'DIECIOCHO',
  19: 'DIECINUEVE',
  20: 'VEINTE',
  21: 'VEINTIUNO',
  22: 'VEINTIDOS',
  23: 'VEINTITRES',
  24: 'VEINTICUATRO',
  25: 'VEINTICINCO',
  26: 'VEINTISEIS',
  27: 'VEINTISIETE',
  28: 'VEINTIOCHO',
  29: 'VEINTINUEVE',
  30: 'TREINTA',
  31: 'TREINTA Y UNO',
};

function getCalendarDateComponents(dateInput: Date | string): {
  day: number;
  monthIndex: number;
  year: number;
} {
  if (typeof dateInput === 'string') {
    const match = dateInput.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return {
        day: Number(match[3]),
        monthIndex: Number(match[2]) - 1,
        year: Number(match[1]),
      };
    }
    const d = getCaracasDateTime(dateInput).toJSDate();
    if (isNaN(d.getTime())) {
      const today = getCaracasTodayJSDate();
      return { day: today.getDate(), monthIndex: today.getMonth(), year: today.getFullYear() };
    }
    return {
      day: d.getUTCDate(),
      monthIndex: d.getUTCMonth(),
      year: d.getUTCFullYear(),
    };
  }

  if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    if (dateInput.getUTCHours() === 0 && dateInput.getUTCMinutes() === 0) {
      return {
        day: dateInput.getUTCDate(),
        monthIndex: dateInput.getUTCMonth(),
        year: dateInput.getUTCFullYear(),
      };
    }
    return {
      day: dateInput.getDate(),
      monthIndex: dateInput.getMonth(),
      year: dateInput.getFullYear(),
    };
  }

  const today = getCaracasTodayJSDate();
  return {
    day: today.getDate(),
    monthIndex: today.getMonth(),
    year: today.getFullYear(),
  };
}

function getAge(birthDate?: Date | string): number {
  if (!birthDate) return 0;
  const { day, monthIndex, year } = getCalendarDateComponents(birthDate);
  const today = getCaracasTodayJSDate();
  let age = today.getFullYear() - year;
  const m = today.getMonth() - monthIndex;
  if (m < 0 || (m === 0 && today.getDate() < day)) {
    age--;
  }
  return age;
}

function formatDate(date?: Date | string): string {
  if (!date) return '-';
  const { day, monthIndex, year } = getCalendarDateComponents(date);
  const dayStr = String(day).padStart(2, '0');
  const monthStr = String(monthIndex + 1).padStart(2, '0');
  return `${dayStr}-${monthStr}-${year}`;
}

const HEALTH_CATEGORIES_METADATA = [
  {
    id: 1,
    category: HealthCategory.CARDIOVASCULAR,
    title: 'ENFERMEDADES CARDIOVASCULARES',
    description:
      'Hipertensión Arterial, infarto al Miocardio, Arritmia Cardiaca, Aneurisma, Palitaciones, Angina de Pecho, Fiebre Reumática, Arteriosclerosis, Trastornos Valvulares, Tromboflebitis, Varices.',
  },
  {
    id: 2,
    category: HealthCategory.RESPIRATORIA,
    title: 'ENFERMEDADES DE LAS VÍAS RESPIRATORIAS',
    description:
      'Ronquera, tos Persistente, bronquitis, asma, enfisema, tuberculosis, pleuresía, neumonía, bronconeumonía.',
  },
  {
    id: 3,
    category: HealthCategory.DIGESTIVA,
    title: 'ENFERMEDADES DE LAS VÍAS DIGESTIVAS',
    description:
      'Gastritis, Ulceras, Hepatitis, Cirrosis, Hemorroides o similares, Apendicitis, colitis, Litiasis Vesicular, hernias hiatales, fisura anal.',
  },
  {
    id: 4,
    category: HealthCategory.ENDOCRINA,
    title: 'ENFERMEDADES DEL SISTEMA ENDOCRINO',
    description: 'Diabetes, Obesidad, Tiroides, Paratiroides.',
  },
  {
    id: 5,
    category: HealthCategory.OSTEOMUSCULAR,
    title: 'ENFERMEDADES OSTEOMUSCULARES',
    description:
      'Neuritis, Ciática, Reumatismo, Hernias Discales, Artritis, Osteoporosis, Desviación de la Columna Vertebral, Problemas en las Articulaciones.',
  },
  {
    id: 6,
    category: HealthCategory.GENITOURINARIA,
    title: 'ENFERMEDADES GENITO-URINARIAS',
    description:
      'Cálculos u otra alteración en los riñones, vejiga o próstata, prostatitis, varicocele.',
  },
  {
    id: 7,
    category: HealthCategory.PIEL_OJOS_OIDOS,
    title: 'ENFERMEDADES DE LA PIEL, OJOS, OIDOS, NARIZ, GARGANTA',
    description:
      'Desviación del Tabique Nasal, Sinusitis, Amigdalitis, Rinitis, Otitis, Cataratas, Hipertrofia de Cornetes.',
  },
  {
    id: 8,
    category: HealthCategory.CRONICA_TRANSITORIA,
    title: 'ENFERMEDADES TRANSITORIAS CRÓNICAS O ALGÚN DEFECTOS NO MENCIONADOS ANTERIORMENTE',
    description: 'Cualquier otra condición o defecto crónico o transitorio.',
  },
  {
    id: 9,
    category: HealthCategory.GINECOLOGICA,
    title: 'ENFERMEDADES PROPIAS DE LA MUJER',
    description:
      'Fibroma Uterino, Prolapso, Obstrucción en las Trompas, Ovarios Poliquísticos, Patologías Mamarias, Endometriosis.',
  },
  {
    id: 10,
    category: HealthCategory.QUIRURGICA,
    title:
      'LE HA SIDO INDICADA O PRACTICADA ALGUNA INTERVENCIÓN QUIRÚRGICA O SE HA SOMETIDO A TRATAMIENTO MÉDICO POR ALGUNA ENFERMEDAD O LESIÓN ADICIONAL A LAS ANTERIORES',
    description: 'Cualquier cirugía, hospitalización o tratamiento médico adicional.',
  },
  {
    id: 11,
    category: HealthCategory.OTROS,
    title: 'OTROS',
    description: 'Cualquier otra enfermedad o síntoma no especificado (Alergias, asma, etc.).',
  },
];

function isSamePerson(cp1?: ContractPerson | null, cp2?: ContractPerson | null): boolean {
  if (!cp1 || !cp2) return false;
  return (
    cp1.person?.typeIdentityCard === cp2.person?.typeIdentityCard &&
    cp1.person?.identityCard === cp2.person?.identityCard
  );
}

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    @InjectRepository(Contract)
    private contractsRepository: Repository<Contract>,
    @InjectRepository(ContractPerson)
    private contractPersonsRepository: Repository<ContractPerson>,
    @InjectRepository(AffiliationHistory)
    private affiliationHistoryRepository: Repository<AffiliationHistory>,
    @Inject(forwardRef(() => PersonsService))
    private personsService: PersonsService,
    @Inject(forwardRef(() => BillingService))
    private billingService: BillingService,
    private plansService: PlansService,
    private readonly pdfService: PdfService,
    private readonly awsService: AwsService,
  ) {}

  async create(createContractDto: CreateContractDto): Promise<Contract> {
    const { advisorId, portfolioId, ...rest } = createContractDto;

    return this.contractsRepository.manager.transaction(async (manager) => {
      const advisor = await manager.getRepository(Advisor).findOne({ where: { id: advisorId } });
      if (!advisor) {
        throw new NotFoundException(`El asesor proporcionado no existe.`);
      }

      let counter = await manager.getRepository(SystemCounter).findOne({
        where: { key: 'contract_code' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!counter) {
        counter = manager.getRepository(SystemCounter).create({ key: 'contract_code', value: 1 });
      }
      const serial = counter.value;
      counter.value += 1;
      await manager.getRepository(SystemCounter).save(counter);

      const serialNumber = String(serial).padStart(5, '0');
      let advisorCodeStr = '000';
      if (advisor?.code) {
        advisorCodeStr = String(advisor.code).padStart(3, '0');
      }
      const generatedCode = `SIR-${advisorCodeStr}-${serialNumber}`;

      const contract = manager.getRepository(Contract).create({
        ...rest,
        code: generatedCode,
        legacyCode: createContractDto.legacyCode ?? undefined,
        advisor,
        ...(portfolioId ? { portfolio: { id: portfolioId } } : {}),
      });
      return manager.getRepository(Contract).save(contract);
    });
  }

  /**
   * Creates a contract with all its affiliated persons in a single transactional operation.
   *
   * Validations:
   * - Contract code must not be duplicated
   * - At most one TITULAR (optional — a contract can have only AFILIADOs)
   * - At most one isBillingOwner (defaults to TITULAR if present and none specified)
   * - AFILIADOs must have a planId
   * - If a person's document already exists as AFILIADO in another active contract → rejected
   */
  async createFull(dto: CreateContractFullDto): Promise<Contract> {
    const { advisorId, portfolioId, affiliates, ...contractData } = dto;

    // ── 1. Validate TITULAR count (optional, but at most one) ──────────────
    const titulars = affiliates.filter((a) => a.role === PersonRole.TITULAR);
    if (titulars.length > 1) {
      throw new BadRequestException('Solo puede haber un TITULAR por contrato.');
    }

    // ── 2. Validate billing owner count ────────────────────────────────────
    const billingOwners = affiliates.filter((a) => a.isBillingOwner === true);
    if (billingOwners.length > 1) {
      throw new BadRequestException('Solo puede haber un responsable de facturación por contrato.');
    }

    // If no billing owner specified, default to TITULAR (if present)
    const hasBillingOwner = billingOwners.length === 1;

    // ── 3. Validate AFILIADO planId ────────────────────────────────────────
    for (const affiliate of affiliates) {
      if (affiliate.role === PersonRole.AFILIADO && !affiliate.planId) {
        throw new BadRequestException(
          `El afiliado ${affiliate.name} (${affiliate.typeIdentityCard}-${affiliate.identityCard}) debe tener un plan asignado.`,
        );
      }
    }

    const savedContract = await this.contractsRepository.manager.transaction(async (manager) => {
      const personRepo = manager.getRepository(Person);
      const contractRepo = manager.getRepository(Contract);
      const cpRepo = manager.getRepository(ContractPerson);
      const historyRepo = manager.getRepository(AffiliationHistory);

      // ── 4.1. Get advisor and generate code ────────────────────────────
      const advisorRepo = manager.getRepository(Advisor);
      const advisor = await advisorRepo.findOne({ where: { id: advisorId } });
      if (!advisor) {
        throw new NotFoundException(`El asesor proporcionado no existe.`);
      }

      let counter = await manager.getRepository(SystemCounter).findOne({
        where: { key: 'contract_code' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!counter) {
        counter = manager.getRepository(SystemCounter).create({ key: 'contract_code', value: 1 });
      }
      const serial = counter.value;
      counter.value += 1;
      await manager.getRepository(SystemCounter).save(counter);

      const serialNumber = String(serial).padStart(5, '0');
      let advisorCodeStr = '000';
      if (advisor?.code) {
        advisorCodeStr = String(advisor.code).padStart(3, '0');
      }
      const generatedCode = `SIR-${advisorCodeStr}-${serialNumber}`;

      // ── 4.2. Create the contract ──────────────────────────────────────
      const contract = contractRepo.create({
        ...contractData,
        code: generatedCode,
        advisor,
        ...(portfolioId ? { portfolio: { id: portfolioId } } : {}),
      });
      const savedContract = await contractRepo.save(contract);

      // ── 4.2. Process each affiliate ───────────────────────────────────
      for (const affiliate of affiliates) {
        const {
          typeIdentityCard,
          identityCard,
          name,
          birthDate,
          gender,
          planId,
          role,
          isBillingOwner,
          relationship,
          phone,
          alternatePhone,
          email,
          address,
          city,
          state,
          postalCode,
          weight,
          height,
          occupation,
          legalRepresentative,
          healthDeclarations,
        } = affiliate;

        // Check if person already exists by document (lock row for updates to avoid race conditions)
        // NOTE: We must NOT load relations alongside pessimistic_write because
        // PostgreSQL forbids FOR UPDATE on the nullable side of a LEFT JOIN.
        let person = await personRepo.findOne({
          where: { identityCard, typeIdentityCard },
          lock: { mode: 'pessimistic_write' },
        });

        // Now load the full person with relations (the row is already locked)
        if (person) {
          person = await personRepo.findOne({
            where: { id: person.id },
            relations: ['plan', 'contractPersons', 'contractPersons.contract'],
          });
        }

        // Resolve plan for AFILIADO
        let plan: Plan | null = null;
        if (role === PersonRole.AFILIADO && planId) {
          plan = await this.plansService.findOne(planId);
        }

        let affiliationReason: string | null = null;

        if (person) {
          // Person exists → validate single-contract rule (cannot be an AFILIADO in another ACTIVE contract)
          if (role === PersonRole.AFILIADO) {
            const activeAffiliations = await cpRepo.find({
              where: {
                person: { id: person.id },
                role: PersonRole.AFILIADO,
                contract: { status: ContractStatus.ACTIVE },
              },
              relations: ['contract'],
            });

            if (activeAffiliations.length > 0) {
              const contractCodes = activeAffiliations.map((cp) => cp.contract.code).join(', ');
              throw new BadRequestException(
                `El afiliado ${person.name} (${person.typeIdentityCard}-${person.identityCard}) ya es beneficiario activo en el contrato: ${contractCodes}. Debe ser desafiliado primero antes de asignarlo a otro contrato.`,
              );
            }
          }

          // Check if person belongs to an INACTIVE contract → CAMBIO_CONTRATO & softRemove from it
          const inactiveAffiliations = await cpRepo.find({
            where: {
              person: { id: person.id },
              contract: { status: ContractStatus.INACTIVE },
            },
            relations: ['contract', 'person', 'person.plan'],
          });

          for (const oldCp of inactiveAffiliations) {
            // Record CAMBIO_CONTRATO in old contract history
            await historyRepo.save(
              historyRepo.create({
                contract: oldCp.contract,
                person,
                plan: oldCp.person?.plan ?? null,
                action: AffiliationAction.CAMBIO_CONTRATO,
                amount: Number(oldCp.person?.plan?.amount ?? 0),
                reason: `Migrado al contrato ${savedContract.code}`,
              }),
            );

            // Soft-delete old ContractPerson so the person is no longer in the old contract
            await cpRepo.softRemove(oldCp);
          }

          if (inactiveAffiliations.length > 0) {
            const oldCodes = inactiveAffiliations.map((cp) => cp.contract.code).join(', ');
            affiliationReason = `Proveniente del contrato ${oldCodes}`;
          }

          // Update person details
          person.name = name;
          if (birthDate) {
            person.birthDate = parseBirthDate(birthDate);
          }
          if (gender !== undefined) {
            person.gender = gender;
          }
          if (phone !== undefined) person.phone = phone;
          if (alternatePhone !== undefined) person.alternatePhone = alternatePhone;
          if (email !== undefined) person.email = email;
          if (address !== undefined) person.address = address;
          if (city !== undefined) person.city = city;
          if (state !== undefined) person.state = state;
          if (postalCode !== undefined) person.postalCode = postalCode;
          if (weight !== undefined) person.weight = weight;
          if (height !== undefined) person.height = height;
          if (occupation !== undefined) person.occupation = occupation;
          if (legalRepresentative !== undefined) person.legalRepresentative = legalRepresentative;

          // Only update the plan if they are an AFILIADO in the new contract
          if (role === PersonRole.AFILIADO) {
            person.plan = plan;
          }

          person = await personRepo.save(person);
        } else {
          // Person does not exist → create new
          person = personRepo.create({
            typeIdentityCard,
            identityCard,
            name,
            birthDate: parseBirthDate(birthDate),
            gender,
            plan,
            phone,
            alternatePhone,
            email,
            address,
            city,
            state,
            postalCode,
            weight,
            height,
            occupation,
            legalRepresentative,
          });
          person = await personRepo.save(person);
        }

        // ── 4.3. Create ContractPerson junction ─────────────────────────
        const resolvedIsBillingOwner = hasBillingOwner
          ? (isBillingOwner ?? false)
          : role === PersonRole.TITULAR; // default: TITULAR is billing owner

        const contractPerson = cpRepo.create({
          contract: savedContract,
          person,
          role,
          isBillingOwner: resolvedIsBillingOwner,
          relationship,
        });
        const savedCp = await cpRepo.save(contractPerson);

        // Process health declarations
        if (healthDeclarations && healthDeclarations.length > 0) {
          const hdRepo = manager.getRepository(HealthDeclaration);
          const hdEntities = healthDeclarations.map((hd) =>
            hdRepo.create({
              ...hd,
              contractPerson: savedCp,
            }),
          );
          await hdRepo.save(hdEntities);
        }

        // ── 4.4. Record affiliation history for AFILIADOs ───────────────
        if (role === PersonRole.AFILIADO) {
          await historyRepo.save(
            historyRepo.create({
              contract: savedContract,
              person,
              plan,
              action: AffiliationAction.AFILIACION,
              amount: Number(plan?.amount ?? 0),
              reason: affiliationReason,
            }),
          );
        }
      }

      // ── 4.5. Recalculate monthly amount ─────────────────────────────────
      await this.recalculateMonthlyAmount(savedContract.id, manager);

      // ── 4.6. Return contract with relations loaded ──────────────────────
      return contractRepo.findOne({
        where: { id: savedContract.id },
        relations: [
          'contractPersons',
          'contractPersons.person',
          'contractPersons.person.plan',
          'advisor',
          'portfolio',
        ],
      });
    });

    // ── 5. Invoice Generation (after transaction commits) ──────────
    try {
      // Create initial invoice as "AFILIACION" instead of default "MENSUALIDAD"
      await this.billingService.generateInvoiceForContract(savedContract.id, undefined, true);
      this.logger.log(`Invoice generated for contract ${savedContract.code}`);
    } catch (invoiceError) {
      const errorMessage =
        invoiceError instanceof Error ? invoiceError.message : String(invoiceError);
      this.logger.error(
        `Failed to generate invoice for contract ${savedContract.code}: ${errorMessage}`,
      );
    }

    // ── 6. PDF Generation & S3 Upload (after transaction commits) ──────────
    this.generateAndUploadContractPdf(savedContract.id).catch((pdfError) => {
      const errorMessage = pdfError instanceof Error ? pdfError.message : String(pdfError);
      this.logger.error(
        `Failed to generate or upload PDF for contract ${savedContract.code}: ${errorMessage}`,
      );
    });

    return savedContract;
  }

  async generateAndUploadContractPdf(contractId: string): Promise<string | null> {
    try {
      const pdfBuffer = await this.generateContractPdfBuffer(contractId);
      if (!pdfBuffer) {
        return null;
      }
      const fullContract = await this.contractsRepository.findOne({
        where: { id: contractId },
        select: ['code'],
      });
      if (!fullContract) {
        return null;
      }
      const filename = `${fullContract.code}.pdf`;
      const pdfUrl = await this.awsService.uploadFile(
        { buffer: pdfBuffer, originalname: filename, mimetype: 'application/pdf' },
        'contracts',
        fullContract.code,
      );
      this.logger.log(`PDF generated and uploaded to S3: ${pdfUrl}`);
      return pdfUrl;
    } catch (pdfError) {
      const errorMessage = pdfError instanceof Error ? pdfError.message : String(pdfError);
      this.logger.error(
        `Failed to generate or upload PDF for contract ${contractId}: ${errorMessage}`,
      );
      return null;
    }
  }

  async generateContractPdfBuffer(contractId: string): Promise<Buffer | null> {
    try {
      const fullContract = await this.contractsRepository.findOne({
        where: { id: contractId },
        relations: [
          'contractPersons',
          'contractPersons.person',
          'contractPersons.person.plan',
          'contractPersons.healthDeclarations',
          'contractPersons.healthDeclarations.contractPerson',
          'advisor',
          'portfolio',
        ],
      });

      if (!fullContract) {
        this.logger.warn(`Contract with ID ${contractId} not found for PDF buffer generation.`);
        return null;
      }

      let titularCp = fullContract.contractPersons.find((cp) => cp.role === PersonRole.TITULAR);
      if (!titularCp) {
        titularCp = fullContract.contractPersons.find((cp) => cp.isBillingOwner === true);
      }
      const affiliateCps = fullContract.contractPersons.filter(
        (cp) => cp.role === PersonRole.AFILIADO,
      );

      const titularPerson = titularCp?.person;
      const titularData = titularPerson
        ? {
            name: titularPerson.name,
            typeIdentityCard: titularPerson.typeIdentityCard,
            identityCard: titularPerson.identityCard,
            birthDateFormatted: formatDate(titularPerson.birthDate),
            age: getAge(titularPerson.birthDate),
            weight: titularPerson.weight || '',
            height: titularPerson.height || '',
            address: titularPerson.address || '',
            city: titularPerson.city || '',
            state: titularPerson.state || '',
            postalCode: titularPerson.postalCode || '',
            phone: titularPerson.phone || '',
            alternatePhone: titularPerson.alternatePhone || '',
            email: titularPerson.email || '',
            occupation: titularPerson.occupation || '',
            legalRepresentative: titularPerson.legalRepresentative || '',
          }
        : {
            name: '',
            typeIdentityCard: '',
            identityCard: '',
            birthDateFormatted: '',
            age: '',
            weight: '',
            height: '',
            address: '',
            city: '',
            state: '',
            postalCode: '',
            phone: '',
            alternatePhone: '',
            email: '',
            occupation: '',
            legalRepresentative: '',
          };

      // Find the first plan in the contract (either from titular or affiliates)
      const planPerson = fullContract.contractPersons.find((cp) => cp.person?.plan)?.person;
      const contractPlan = planPerson?.plan;
      const planName = contractPlan?.name || '';

      const beneficiaries = affiliateCps
        .filter((cp) => !isSamePerson(cp, titularCp))
        .map((cp, idx) => {
          const person = cp.person;
          return {
            index: String(idx + 1).padStart(2, '0'),
            name: person.name,
            typeIdentityCard: person.typeIdentityCard,
            identityCard: person.identityCard,
            relationship: cp.relationship || '-',
            birthDateFormatted: formatDate(person.birthDate),
            age: getAge(person.birthDate),
            genderLabel: person.gender === true ? 'M' : person.gender === false ? 'F' : '-',
            weight: person.weight || '-',
            height: person.height || '-',
            planName: person.plan?.name || '-',
          };
        });

      const emptyRows: string[] = [];
      for (let i = beneficiaries.length + 1; i <= 7; i++) {
        emptyRows.push(String(i).padStart(2, '0'));
      }

      const allDeclarations: HealthDeclaration[] = [];
      for (const cp of fullContract.contractPersons) {
        if (cp.healthDeclarations) {
          allDeclarations.push(...cp.healthDeclarations);
        }
      }

      const healthQuestions = HEALTH_CATEGORIES_METADATA.map((meta) => {
        const matchingDecls = allDeclarations.filter(
          (d) => d.category === meta.category && d.hasCondition,
        );
        const hasCondition = matchingDecls.length > 0;

        const affectedDetailsList = matchingDecls.map((d) => {
          const cp = fullContract.contractPersons.find((c) => c.id === d.contractPerson?.id);
          const name = cp?.person?.name || 'Desconocido';
          const detailsStr = d.details ? `: ${d.details}` : '';
          return `${name}${detailsStr}`;
        });

        const affectedDetails = affectedDetailsList.join(', ');

        return {
          id: meta.id,
          title: meta.title,
          description: meta.description,
          hasCondition,
          affectedDetails,
        };
      });

      const isTitularAlsoBeneficiary = affiliateCps.some((cp) => isSamePerson(cp, titularCp));

      const titularRow =
        titularCp && !isTitularAlsoBeneficiary
          ? {
              name: titularCp.person.name,
              typeIdentityCard: titularCp.person.typeIdentityCard,
              identityCard: titularCp.person.identityCard,
              age: getAge(titularCp.person.birthDate),
              planName: titularCp.person.plan?.name || 'TITULAR',
              coverage: titularCp.person.plan?.coverage
                ? Number(titularCp.person.plan.coverage).toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                : '0.00',
              monthlyCost: titularCp.person.plan?.amount
                ? Number(titularCp.person.plan.amount).toFixed(2)
                : '0.00',
            }
          : null;

      const beneficiariesRow = affiliateCps
        .filter((cp) => !isSamePerson(cp, titularCp))
        .map((cp) => {
          const plan = cp.person?.plan;
          const coverage = plan?.coverage
            ? Number(plan.coverage).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
            : '0.00';
          return {
            name: cp.person.name,
            typeIdentityCard: cp.person.typeIdentityCard,
            identityCard: cp.person.identityCard,
            age: getAge(cp.person.birthDate),
            planName: plan?.name || '-',
            coverage,
            monthlyCost: plan ? Number(plan.amount).toFixed(2) : '0.00',
          };
        });

      const contractedPlansMap = new Map<
        string,
        { count: number; coverage: string; unitCost: number; totalCost: number }
      >();

      for (const cp of fullContract.contractPersons) {
        const plan = cp.person?.plan;
        if (plan) {
          const planName = plan.name.toUpperCase();
          const unitCost = Number(plan.amount) || 0;
          const coverage = plan.coverage
            ? Number(plan.coverage).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
            : '0.00';

          const existing = contractedPlansMap.get(planName);
          if (existing) {
            existing.count += 1;
            existing.totalCost += unitCost;
          } else {
            contractedPlansMap.set(planName, {
              count: 1,
              coverage,
              unitCost,
              totalCost: unitCost,
            });
          }
        }
      }

      const contractedPlansList = Array.from(contractedPlansMap.entries()).map(([name, data]) => ({
        name,
        count: data.count,
        coverage: data.coverage,
        unitCost: data.unitCost.toFixed(2),
        totalCost: data.totalCost.toFixed(2),
      }));

      const {
        day: dayNumber,
        monthIndex,
        year: yearNumber,
      } = getCalendarDateComponents(fullContract.affiliationDate || getCaracasTodayJSDate());
      const dayText = SPANISH_DAYS[dayNumber] || String(dayNumber);
      const monthText = SPANISH_MONTHS[monthIndex];

      const logoBase64 = await loadLogoBase64(this.logger);

      const pdfData = {
        contractCode: fullContract.code,
        affiliationDateFormatted: formatDate(fullContract.affiliationDate),
        logoBase64,
        titular: titularData,
        planName,
        beneficiaries,
        emptyRows,
        healthQuestions,
        advisorName: fullContract.advisor?.name || '',
        dayText,
        dayNumber,
        monthText,
        yearNumber,
        titularRow,
        beneficiariesRow,
        contractedPlansList,
      };

      return this.pdfService.generatePdf('contract-affiliation', pdfData);
    } catch (pdfError) {
      const errorMessage = pdfError instanceof Error ? pdfError.message : String(pdfError);
      this.logger.error(
        `Failed to generate or upload PDF for contract ${contractId}: ${errorMessage}`,
      );
      return null;
    }
  }

  async inactivate(contractId: string, dto: InactivateContractDto): Promise<Contract> {
    const contract = await this.findOne(contractId);

    if (contract.status === ContractStatus.INACTIVE) {
      throw new BadRequestException('El contrato ya se encuentra inactivo.');
    }

    return this.contractsRepository.manager.transaction(async (manager) => {
      const contractRepo = manager.getRepository(Contract);
      const cpRepo = manager.getRepository(ContractPerson);
      const historyRepo = manager.getRepository(AffiliationHistory);

      // Lock contract for update to guarantee idempotency and avoid race conditions
      const lockedContract = await contractRepo.findOne({
        where: { id: contractId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!lockedContract) {
        throw new NotFoundException(`El contrato con ID "${contractId}" no fue encontrado.`);
      }

      if (lockedContract.status === ContractStatus.INACTIVE) {
        throw new BadRequestException('El contrato ya se encuentra inactivo.');
      }

      // Update contract status and reason
      lockedContract.status = ContractStatus.INACTIVE;
      lockedContract.inactivationReason = dto.reason;
      await contractRepo.save(lockedContract);

      // Record DESAFILIACION for each active person (only AFILIADOs, to avoid counting TITULARs as desafiliations)
      const activePersons = await cpRepo.find({
        where: {
          contract: { id: contractId },
          role: PersonRole.AFILIADO,
        },
        relations: ['person', 'person.plan'],
      });

      // Truncate to match AffiliationHistory.reason max length (255)
      const truncatedReason = dto.reason ? dto.reason.substring(0, 255) : null;

      for (const cp of activePersons) {
        await historyRepo.save(
          historyRepo.create({
            contract: lockedContract,
            person: cp.person,
            plan: cp.person?.plan ?? null,
            action: AffiliationAction.DESAFILIACION,
            amount: Number(cp.person?.plan?.amount ?? 0),
            reason: truncatedReason,
          }),
        );
      }

      return lockedContract;
    });
  }

  async findAll(query: FindContractDto): Promise<PaginatedResult<Contract>> {
    const queryBuilder = this.contractsRepository.createQueryBuilder('contract');
    const targetBillingMonth = this.buildTargetBillingMonth(query);

    this.applyRelations(queryBuilder);
    this.applySearchFilter(queryBuilder, query.search);
    this.applyAdvisorFilter(queryBuilder, query.advisorId);
    if (query.stage || targetBillingMonth) {
      this.applyInvoiceJoins(queryBuilder, targetBillingMonth);
      this.applyStageFilter(queryBuilder, query.stage, targetBillingMonth);
    }

    if (query.stage) {
      queryBuilder.andWhere("contract.status = 'ACTIVE'");
    } else if (query.status) {
      queryBuilder.andWhere('contract.status = :status', { status: query.status });
    }

    queryBuilder.orderBy('contract.code', 'ASC');

    return paginateQueryBuilder(queryBuilder, query);
  }

  // ---------------------------------------------------------------------------
  // findAll — private helpers
  // ---------------------------------------------------------------------------

  /**
   * Builds the `YYYY-MM` billing month string when both month and year are present.
   */
  private buildTargetBillingMonth(query: FindContractDto): string | undefined {
    if (query.month && query.year) {
      return `${query.year}-${String(query.month).padStart(2, '0')}`;
    }
    return undefined;
  }

  /**
   * Joins the base relations needed for listing contracts.
   */
  private applyRelations(qb: SelectQueryBuilder<Contract>): void {
    qb.leftJoinAndSelect('contract.contractPersons', 'contractPersons')
      .leftJoinAndSelect('contractPersons.person', 'person')
      .leftJoinAndSelect('person.plan', 'plan')
      .leftJoinAndSelect('contract.advisor', 'advisor')
      .leftJoinAndSelect('contract.portfolio', 'portfolio');
  }

  /**
   * Adds the ILIKE search clause for code, billing-owner name, or identity card.
   */
  private applySearchFilter(qb: SelectQueryBuilder<Contract>, search?: string): void {
    if (!search) return;
    qb.andWhere(
      '(contract.code ILIKE :search OR contract.legacy_code ILIKE :search OR (contractPersons.isBillingOwner = true AND (person.name ILIKE :search OR person.identityCard ILIKE :search)))',
      { search: `%${search}%` },
    );
  }

  /**
   * Filters contracts by advisor when an advisorId is provided.
   */
  private applyAdvisorFilter(qb: SelectQueryBuilder<Contract>, advisorId?: string): void {
    if (!advisorId) return;
    qb.andWhere('contract.advisor_id = :advisorId', { advisorId });
  }

  /**
   * Joins invoices and payments. When a billing month is specified the invoice
   * join is constrained to that month only.
   */
  private applyInvoiceJoins(qb: SelectQueryBuilder<Contract>, targetBillingMonth?: string): void {
    if (targetBillingMonth) {
      qb.setParameter('targetBillingMonth', targetBillingMonth);
      qb.leftJoinAndSelect(
        'contract.invoices',
        'invoices',
        'invoices.billingMonth = :targetBillingMonth',
      ).leftJoinAndSelect('invoices.payments', 'payments');
    } else {
      qb.leftJoinAndSelect('contract.invoices', 'invoices').leftJoinAndSelect(
        'invoices.payments',
        'payments',
      );
    }
  }

  /**
   * Dispatches to the correct stage-filter strategy.
   */
  private applyStageFilter(
    qb: SelectQueryBuilder<Contract>,
    stage?: string,
    targetBillingMonth?: string,
  ): void {
    if (!stage) return;

    const stageFilterMap: Record<
      string,
      (qb: SelectQueryBuilder<Contract>, billingMonthClause: string) => void
    > = {
      rejected: this.applyRejectedFilter,
      partial: this.applyPartialFilter,
      paid: this.applyPaidFilter,
      pending: this.applyPendingFilter,
    };

    const filterFn = stageFilterMap[stage];
    if (!filterFn) return;

    const billingMonthClause = targetBillingMonth
      ? 'AND inv.billing_month = :targetBillingMonth'
      : '';

    filterFn(qb, billingMonthClause);
  }

  /**
   * Stage filter: contracts with at least one rejected payment on a
   * pending/partial invoice.
   */
  private applyRejectedFilter(qb: SelectQueryBuilder<Contract>, billingMonthClause: string): void {
    qb.andWhere(
      `EXISTS (
        SELECT 1 FROM invoices inv
        LEFT JOIN payments p ON p.invoice_id = inv.id
        WHERE inv.contract_id = contract.id
          ${billingMonthClause}
          AND inv.status IN ('PENDING', 'PARTIAL')
          AND p.status = 'REJECTED'
      )`,
    );
  }

  /**
   * Stage filter: contracts with a PARTIAL invoice but no rejections.
   */
  private applyPartialFilter(qb: SelectQueryBuilder<Contract>, billingMonthClause: string): void {
    qb.andWhere(
      `EXISTS (
        SELECT 1 FROM invoices inv
        WHERE inv.contract_id = contract.id
          ${billingMonthClause}
          AND inv.status = 'PARTIAL'
      ) AND NOT EXISTS (
        SELECT 1 FROM invoices inv
        LEFT JOIN payments p ON p.invoice_id = inv.id
        WHERE inv.contract_id = contract.id
          ${billingMonthClause}
          AND inv.status IN ('PENDING', 'PARTIAL')
          AND p.status = 'REJECTED'
      )`,
    );
  }

  /**
   * Stage filter: contracts whose relevant invoices are fully paid or cancelled.
   */
  private applyPaidFilter(qb: SelectQueryBuilder<Contract>, billingMonthClause: string): void {
    if (billingMonthClause) {
      // With billing month: at least one PAID/CANCELLED invoice in that month
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM invoices inv
          WHERE inv.contract_id = contract.id
            ${billingMonthClause}
            AND inv.status IN ('PAID', 'CANCELLED')
        )`,
      );
    } else {
      // Without billing month: ALL invoices must be PAID/CANCELLED
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM invoices inv
          WHERE inv.contract_id = contract.id
        ) AND NOT EXISTS (
          SELECT 1 FROM invoices inv
          WHERE inv.contract_id = contract.id
            AND inv.status NOT IN ('PAID', 'CANCELLED')
        )`,
      );
    }
  }

  /**
   * Stage filter: contracts still pending — no rejections, no partial, and
   * not fully paid.
   */
  private applyPendingFilter(qb: SelectQueryBuilder<Contract>, billingMonthClause: string): void {
    if (billingMonthClause) {
      // With billing month: PENDING invoice exists and no rejections
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM invoices inv
          WHERE inv.contract_id = contract.id
            ${billingMonthClause}
            AND inv.status = 'PENDING'
        ) AND NOT EXISTS (
          SELECT 1 FROM invoices inv
          LEFT JOIN payments p ON p.invoice_id = inv.id
          WHERE inv.contract_id = contract.id
            ${billingMonthClause}
            AND inv.status IN ('PENDING', 'PARTIAL')
            AND p.status = 'REJECTED'
        )`,
      );
    } else {
      // Without billing month: no rejections, no partial, and not all paid
      qb.andWhere(
        `NOT EXISTS (
          SELECT 1 FROM invoices inv
          LEFT JOIN payments p ON p.invoice_id = inv.id
          WHERE inv.contract_id = contract.id
            AND inv.status IN ('PENDING', 'PARTIAL')
            AND p.status = 'REJECTED'
        ) AND NOT EXISTS (
          SELECT 1 FROM invoices inv
          WHERE inv.contract_id = contract.id
            AND inv.status = 'PARTIAL'
        ) AND (
          NOT EXISTS (SELECT 1 FROM invoices inv WHERE inv.contract_id = contract.id)
          OR EXISTS (
            SELECT 1 FROM invoices inv
            WHERE inv.contract_id = contract.id
              AND inv.status NOT IN ('PAID', 'CANCELLED')
          )
        )`,
      );
    }
  }

  async getPipelineStats(advisorId?: string, month?: string, year?: string) {
    const targetBillingMonth =
      month && year ? `${year}-${String(month).padStart(2, '0')}` : undefined;

    const contracts = await this.buildPipelineQuery(advisorId, targetBillingMonth);

    const totals: PipelineTotals = { totalPipeline: 0, totalCollected: 0, totalPending: 0 };
    const counts: PipelineCounts = { pending: 0, rejected: 0, partial: 0, paid: 0 };

    for (const contract of contracts) {
      if (targetBillingMonth) {
        this.classifyContractByMonth(contract, targetBillingMonth, totals, counts);
      } else {
        this.classifyContractCumulative(contract, totals, counts);
      }
    }

    return { stats: totals, counts };
  }

  // ---------------------------------------------------------------------------
  // getPipelineStats — private helpers
  // ---------------------------------------------------------------------------

  /**
   * Builds and executes the query to fetch contracts with their related
   * persons, invoices, and payments for the pipeline dashboard.
   */
  private async buildPipelineQuery(
    advisorId?: string,
    targetBillingMonth?: string,
  ): Promise<Contract[]> {
    const qb = this.contractsRepository.createQueryBuilder('contract');

    qb.leftJoinAndSelect('contract.contractPersons', 'contractPersons').leftJoinAndSelect(
      'contractPersons.person',
      'person',
    );

    qb.andWhere("contract.status = 'ACTIVE'");

    if (advisorId) {
      qb.andWhere('contract.advisor_id = :advisorId', { advisorId });
    }

    if (targetBillingMonth) {
      qb.leftJoinAndSelect(
        'contract.invoices',
        'invoices',
        'invoices.billingMonth = :targetBillingMonth',
        { targetBillingMonth },
      ).leftJoinAndSelect('invoices.payments', 'payments');
    } else {
      qb.leftJoinAndSelect('contract.invoices', 'invoices').leftJoinAndSelect(
        'invoices.payments',
        'payments',
      );
    }

    return qb.getMany();
  }

  /**
   * Classifies a single contract and accumulates financial stats when a
   * specific billing month is targeted.
   */
  private classifyContractByMonth(
    contract: Contract,
    targetBillingMonth: string,
    totals: PipelineTotals,
    counts: PipelineCounts,
  ): void {
    const targetInvoice = contract.invoices?.find((inv) => inv.billingMonth === targetBillingMonth);
    if (!targetInvoice) return;

    totals.totalPipeline += Number(targetInvoice.baseAmount ?? targetInvoice.totalAmount);

    const hasRejection = targetInvoice.payments?.some((p) => p.status === 'REJECTED');
    if (
      hasRejection &&
      (targetInvoice.status === 'PENDING' || targetInvoice.status === 'PARTIAL')
    ) {
      counts.rejected++;
    } else if (targetInvoice.status === 'PARTIAL') {
      counts.partial++;
    } else if (targetInvoice.status === 'PAID' || targetInvoice.status === 'CANCELLED') {
      counts.paid++;
    } else {
      counts.pending++;
    }

    this.accumulateInvoiceStats(targetInvoice, totals);
  }

  /**
   * Classifies a single contract and accumulates financial stats across
   * all invoices (no specific billing month).
   */
  private classifyContractCumulative(
    contract: Contract,
    totals: PipelineTotals,
    counts: PipelineCounts,
  ): void {
    totals.totalPipeline += Number(contract.monthlyAmount);

    const hasRejection = contract.invoices?.some(
      (inv) =>
        (inv.status === 'PENDING' || inv.status === 'PARTIAL') &&
        inv.payments?.some((p) => p.status === 'REJECTED'),
    );

    if (hasRejection) {
      counts.rejected++;
    } else {
      const hasPartial = contract.invoices?.some((inv) => inv.status === 'PARTIAL');
      if (hasPartial) {
        counts.partial++;
      } else {
        const allPaid =
          !!contract.invoices &&
          contract.invoices.length > 0 &&
          contract.invoices.every((inv) => inv.status === 'PAID' || inv.status === 'CANCELLED');
        counts[allPaid ? 'paid' : 'pending']++;
      }
    }

    contract.invoices?.forEach((inv) => this.accumulateInvoiceStats(inv, totals));
  }

  /**
   * Adds a single invoice's financial contribution to the running totals.
   */
  private accumulateInvoiceStats(
    inv: {
      status: string;
      totalAmount: number;
      paidAmount: number;
      baseAmount?: number;
      retentionAmount?: number;
    },
    totals: PipelineTotals,
  ): void {
    const retention = Number(inv.retentionAmount || 0);
    const amountDue = Math.max(0, Number(inv.baseAmount ?? inv.totalAmount) - retention);

    if (inv.status === 'PAID') {
      totals.totalCollected += Number(inv.paidAmount);
    } else if (inv.status === 'PARTIAL') {
      totals.totalCollected += Number(inv.paidAmount);
      totals.totalPending += Math.max(0, amountDue - Number(inv.paidAmount));
    } else if (inv.status === 'PENDING') {
      totals.totalPending += amountDue;
    }
  }

  async findByCode(code: string): Promise<Contract> {
    return this.contractsRepository.findOne({
      where: [{ code }, { legacyCode: code }],
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
        'surpluses',
        'surpluses.payment',
        'advisor',
        'portfolio',
      ],
    });
    if (!contract) {
      throw new NotFoundException(`Contract with ID "${id}" not found`);
    }
    return contract;
  }

  async update(id: string, updateContractDto: UpdateContractDto): Promise<Contract> {
    const contract = await this.findOne(id);
    const { advisorId, portfolioId, ...rest } = updateContractDto;

    Object.assign(contract, rest);

    if (advisorId !== undefined) {
      contract.advisor = advisorId ? ({ id: advisorId } as Advisor) : null;
    }

    if (portfolioId !== undefined) {
      contract.portfolio = portfolioId ? ({ id: portfolioId } as Portfolio) : null;
    }

    return this.contractsRepository.save(contract);
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
      relations: ['contract', 'person', 'person.plan'],
    });

    if (!contractPerson) {
      throw new NotFoundException(`Contract person with ID "${contractPersonId}" not found`);
    }

    if (contractPerson.role === 'TITULAR') {
      throw new BadRequestException('El TITULAR no puede ser eliminado');
    }

    if (contractPerson.isBillingOwner) {
      throw new BadRequestException('Debe existir un responsable de facturación');
    }

    await this.contractsRepository.manager.transaction(async (manager) => {
      const historyRepo = manager.getRepository(AffiliationHistory);
      const cpRepo = manager.getRepository(ContractPerson);

      // Registrar en historial ANTES de eliminar
      await historyRepo.save(
        historyRepo.create({
          contract: contractPerson.contract,
          person: contractPerson.person,
          plan: contractPerson.person?.plan ?? null,
          action: AffiliationAction.DESAFILIACION,
          amount: Number(contractPerson.person?.plan?.amount ?? 0),
          reason: null,
        }),
      );

      // Soft delete (no hard delete) para mantener trazabilidad
      await cpRepo.softRemove(contractPerson);

      // Billing es responsable de limpiar la línea MENSUALIDAD de la factura activa
      await this.billingService.removeAffiliateLineFromActiveInvoice(
        contractPerson.contract.id,
        contractPerson.person.id,
        manager,
      );

      // Recalcular el monto mensual
      await this.recalculateMonthlyAmount(contractPerson.contract.id, manager);
    });
  }

  /**
   * Recalculates the monthly amount for a given contract ID
   * by summing the amount of all plans associated to its persons (only AFILIADOS have plans).
   */
  async recalculateMonthlyAmount(contractId: string, manager?: EntityManager): Promise<void> {
    const cpRepo = manager ? manager.getRepository(ContractPerson) : this.contractPersonsRepository;
    const contractRepo = manager ? manager.getRepository(Contract) : this.contractsRepository;

    const affiliates = await cpRepo.find({
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

    await contractRepo.update(contractId, { monthlyAmount: totalAmount });
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
        { contract: { id: contractId }, deletedAt: IsNull() },
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
        { contract: { id: contractId }, deletedAt: IsNull() },
        { isBillingOwner: false },
      );

      // Marcar al nuevo responsable
      target.isBillingOwner = true;
      await entityManager.save(ContractPerson, target);
    });
  }

  async getAffiliationStats(month: number, year: number) {
    const start = DateTime.fromObject({ year, month, day: 1 }, { zone: CARACAS_ZONE }).startOf(
      'day',
    );
    const end = start.endOf('month');
    const startDate = start.toJSDate();
    const endDate = end.toJSDate();

    const stats = await this.affiliationHistoryRepository
      .createQueryBuilder('h')
      .select([
        `SUM(CASE WHEN h.action = 'AFILIACION' THEN 1 ELSE 0 END) AS new_affiliations`,
        `SUM(CASE WHEN h.action = 'DESAFILIACION' THEN 1 ELSE 0 END) AS disaffiliations`,
        `SUM(CASE WHEN h.action = 'AFILIACION' THEN h.amount ELSE 0 END) AS revenue_gained`,
        `SUM(CASE WHEN h.action = 'DESAFILIACION' THEN h.amount ELSE 0 END) AS revenue_lost`,
      ])
      .where('h.action_date BETWEEN :startDate AND :endDate', { startDate, endDate })
      .getRawOne();

    return {
      newAffiliations: Number(stats?.new_affiliations ?? 0),
      disaffiliations: Number(stats?.disaffiliations ?? 0),
      revenueGained: Number(stats?.revenue_gained ?? 0),
      revenueLost: Number(stats?.revenue_lost ?? 0),
      netChange: Number(stats?.new_affiliations ?? 0) - Number(stats?.disaffiliations ?? 0),
      netRevenueChange: Number(stats?.revenue_gained ?? 0) - Number(stats?.revenue_lost ?? 0),
    };
  }
}
