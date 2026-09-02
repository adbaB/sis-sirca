import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { InvoiceService } from '../../billing/invoices/services/invoice.service';
import {
  getContextSafe,
  registerPostCommitHook,
  resolveQueryRunner,
} from '../../common/context/request-context';
import { Transactional } from '../../common/decorators/transactional.decorator';
import { parseBirthDate } from '../../common/utils/date.util';
import { Person } from '../../persons/entities/person.entity';
import { Plan } from '../../plans/entities/plan.entity';
import { PlansService } from '../../plans/services/plans.service';
import { CreateContractFullDto } from '../dto/create-contract-full.dto';
import { AffiliationHistory } from '../entities/affiliation-history.entity';
import { ContractPerson, PersonRole } from '../entities/contract-person.entity';
import { Contract, ContractStatus } from '../entities/contract.entity';
import { HealthDeclaration } from '../entities/health-declaration.entity';
import { AffiliationAction } from '../enums/affiliation-action.enum';
import { generateContractCode } from '../helpers/contract-code-generator.helper';
import { validateContractAffiliates } from '../helpers/contract-validator.helper';
import { ContractAffiliationService } from './contract-affiliation.service';
import { ContractPdfService } from './contract-pdf.service';

@Injectable()
export class ContractCreationService {
  private readonly logger = new Logger(ContractCreationService.name);

  constructor(
    @InjectRepository(Contract)
    private readonly contractsRepository: Repository<Contract>,
    private readonly dataSource: DataSource,
    private readonly invoiceService: InvoiceService,
    private readonly plansService: PlansService,
    private readonly affiliationService: ContractAffiliationService,
    private readonly contractPdfService: ContractPdfService,
  ) {}

  /**
   * Creates a full contract with all affiliated persons in a single atomic transaction.
   * Dispatches initial invoice generation and PDF upload asynchronously after commit.
   */
  @Transactional()
  async createFull(dto: CreateContractFullDto): Promise<Contract> {
    const { advisorId, portfolioId, affiliates, ...contractData } = dto;

    // 1. Domain validations
    validateContractAffiliates(affiliates);

    const billingOwners = affiliates.filter((a) => a.isBillingOwner === true);
    const hasBillingOwner = billingOwners.length === 1;

    const qr = resolveQueryRunner(undefined, this.dataSource);
    const manager = qr.manager;

    const personRepo = manager.getRepository(Person);
    const contractRepo = manager.getRepository(Contract);
    const cpRepo = manager.getRepository(ContractPerson);
    const historyRepo = manager.getRepository(AffiliationHistory);

    // 2. Generate code and create contract entity
    const { generatedCode, advisor } = await generateContractCode(manager, advisorId);

    const contract = contractRepo.create({
      ...contractData,
      code: generatedCode,
      advisor,
      ...(portfolioId ? { portfolio: { id: portfolioId } } : {}),
    });
    const savedContract = await contractRepo.save(contract);

    // 3. Process each affiliate
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

      // Check if person exists (lock row for updates to prevent race conditions)
      let person = await personRepo.findOne({
        where: { identityCard, typeIdentityCard },
        lock: { mode: 'pessimistic_write' },
      });

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
        if (gender !== undefined) person.gender = gender;
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

      // Create ContractPerson junction
      const resolvedIsBillingOwner = hasBillingOwner
        ? (isBillingOwner ?? false)
        : role === PersonRole.TITULAR;

      const contractPerson = cpRepo.create({
        contract: savedContract,
        person,
        plan: role === PersonRole.AFILIADO ? plan : null,
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

      // Record affiliation history for AFILIADOs
      if (role === PersonRole.AFILIADO) {
        await historyRepo.save(
          historyRepo.create({
            contract: savedContract,
            person,
            plan,
            action: AffiliationAction.AFILIACION,
            amount: Number(plan?.amount ?? 0),
            reason: affiliationReason,
            actionDate: savedContract.affiliationDate ?? new Date(),
          }),
        );
      }
    }

    // Recalculate monthly amount
    await this.affiliationService.recalculateMonthlyAmount(savedContract.id, manager);

    // Load full contract with all relations
    const fullContract = (await contractRepo.findOne({
      where: { id: savedContract.id },
      relations: [
        'contractPersons',
        'contractPersons.plan',
        'contractPersons.person',
        'contractPersons.person.plan',
        'advisor',
        'portfolio',
      ],
    })) as Contract;

    // Post-commit tasks: invoice generation and PDF upload
    const postCommitTasks = async () => {
      try {
        await this.invoiceService.generateInvoiceForContract(savedContract.id, undefined, true);
        this.logger.log(`Invoice generated for contract ${savedContract.code}`);
      } catch (invoiceError) {
        const errorMessage =
          invoiceError instanceof Error ? invoiceError.message : String(invoiceError);
        this.logger.error(
          `Failed to generate invoice for contract ${savedContract.code}: ${errorMessage}`,
        );
      }

      this.contractPdfService.generateAndUploadContractPdf(savedContract.id).catch((pdfError) => {
        const errorMessage = pdfError instanceof Error ? pdfError.message : String(pdfError);
        this.logger.error(
          `Failed to generate or upload PDF for contract ${savedContract.code}: ${errorMessage}`,
        );
      });
    };

    if (getContextSafe()) {
      registerPostCommitHook(postCommitTasks);
    } else {
      void postCommitTasks();
    }

    return fullContract;
  }
}
