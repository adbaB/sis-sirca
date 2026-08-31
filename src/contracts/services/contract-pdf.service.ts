import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AwsService } from '../../aws/aws.service';
import { getCaracasTodayJSDate } from '../../common/utils/date.util';
import { PdfService } from '../../pdf/services/pdf.service';
import { Person, TypeIdentityCard } from '../../persons/entities/person.entity';
import { loadLogoBase64, MONTH_NAMES_ES } from '../../reports/report-utils';
import { HEALTH_CATEGORIES_METADATA } from '../constants/health-categories.constants';
import { SPANISH_DAYS } from '../constants/spanish-dates.constants';
import { ContractPerson, PersonRole } from '../entities/contract-person.entity';
import { Plan } from '../../plans/entities/plan.entity';
import { Contract } from '../entities/contract.entity';
import { HealthDeclaration } from '../entities/health-declaration.entity';
import {
  formatContractDate,
  getCalendarDateComponents,
  getContractPersonAge,
} from '../helpers/contract-date-formatter.helper';
import { isSamePerson } from '../helpers/contract-validator.helper';
import {
  BeneficiaryPdfRow,
  BeneficiarySummaryRow,
  ContractedPlanSummary,
  ContractMember,
  ContractPdfTemplateData,
  HealthQuestionPdfItem,
  TitularPdfData,
  TitularSummaryRow,
} from '../interfaces/contract-pdf-data.interface';

@Injectable()
export class ContractPdfService {
  private readonly logger = new Logger(ContractPdfService.name);

  constructor(
    @InjectRepository(Contract)
    private readonly contractsRepository: Repository<Contract>,
    private readonly pdfService: PdfService,
    private readonly awsService: AwsService,
  ) {}

  /**
   * Generates contract PDF and uploads it to AWS S3.
   */
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

  /**
   * Builds the template data and compiles the PDF buffer for the contract affiliation document.
   */
  async generateContractPdfBuffer(contractId: string): Promise<Buffer | null> {
    try {
      const fullContract = await this.contractsRepository.findOne({
        where: { id: contractId },
        relations: [
          'contractPersons',
          'contractPersons.plan',
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

      const titularData = this.buildTitularData(titularCp);

      // Find primary plan
      const planPerson = fullContract.contractPersons.find((cp) => cp.person?.plan)?.person;
      const contractPlan = planPerson?.plan;
      const planName = contractPlan?.name || '';

      const beneficiaries = this.buildBeneficiariesList(affiliateCps, titularCp, contractPlan);
      const emptyRows = this.buildEmptyRows(beneficiaries.length);
      const healthQuestions = this.buildHealthQuestions(fullContract.contractPersons);
      const titularRow = this.buildTitularRow(titularCp, contractPlan);
      const beneficiariesRow = this.buildBeneficiariesSummary(
        affiliateCps,
        titularCp,
        contractPlan,
      );
      const contractedPlansList = this.buildContractedPlansList(fullContract.contractPersons);
      const allMembers = this.buildAllMembers(fullContract.contractPersons);

      const {
        day: dayNumber,
        monthIndex,
        year: yearNumber,
      } = getCalendarDateComponents(fullContract.affiliationDate || getCaracasTodayJSDate());
      const dayText = SPANISH_DAYS[dayNumber] || String(dayNumber);
      const monthText = MONTH_NAMES_ES[monthIndex].toUpperCase();

      const logoBase64 = await loadLogoBase64(this.logger);

      const pdfData: ContractPdfTemplateData = {
        contractCode: fullContract.code,
        affiliationDateFormatted: formatContractDate(fullContract.affiliationDate),
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
        allMembers,
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

  private buildTitularData(titularCp?: ContractPerson): TitularPdfData {
    const person = titularCp?.person;
    if (!person) {
      return {
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
    }

    return {
      name: person.name,
      typeIdentityCard: person.typeIdentityCard,
      identityCard: person.identityCard,
      birthDateFormatted: formatContractDate(person.birthDate),
      age: getContractPersonAge(person.birthDate),
      weight: person.weight || '',
      height: person.height || '',
      address: person.address || '',
      city: person.city || '',
      state: person.state || '',
      postalCode: person.postalCode || '',
      phone: person.phone || '',
      alternatePhone: person.alternatePhone || '',
      email: person.email || '',
      occupation: person.occupation || '',
      legalRepresentative: person.legalRepresentative || '',
    };
  }

  private buildBeneficiariesList(
    affiliateCps: ContractPerson[],
    titularCp: ContractPerson | undefined,
    contractPlan?: Plan | null,
  ): BeneficiaryPdfRow[] {
    const beneficiariesCps = affiliateCps.filter((cp) => !isSamePerson(cp, titularCp));
    const beneficiariesList =
      beneficiariesCps.length > 0
        ? beneficiariesCps
        : affiliateCps.length > 0
          ? affiliateCps
          : titularCp
            ? [titularCp]
            : [];

    return beneficiariesList.map((cp, idx) => {
      const person = cp.person;
      const isTitular = isSamePerson(cp, titularCp);
      const plan = cp.plan || person?.plan || contractPlan;
      const coverage = plan?.coverage
        ? Number(plan.coverage).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : '0.00';
      return {
        index: String(idx + 1).padStart(2, '0'),
        name: person.name,
        typeIdentityCard: person.typeIdentityCard,
        identityCard: person.identityCard,
        relationship: cp.relationship || (isTitular ? 'TITULAR' : '-'),
        birthDateFormatted: formatContractDate(person.birthDate),
        age: getContractPersonAge(person.birthDate),
        genderLabel: person.gender === true ? 'M' : person.gender === false ? 'F' : '-',
        weight: person.weight || '-',
        height: person.height || '-',
        planName: plan?.name || '-',
        coverage,
      };
    });
  }

  private buildEmptyRows(currentCount: number): string[] {
    const emptyRows: string[] = [];
    for (let i = currentCount + 1; i <= 7; i++) {
      emptyRows.push(String(i).padStart(2, '0'));
    }
    return emptyRows;
  }

  private buildHealthQuestions(contractPersons: ContractPerson[]): HealthQuestionPdfItem[] {
    const allDeclarations: HealthDeclaration[] = [];
    for (const cp of contractPersons) {
      if (cp.healthDeclarations) {
        allDeclarations.push(...cp.healthDeclarations);
      }
    }

    return HEALTH_CATEGORIES_METADATA.map((meta) => {
      const matchingDecls = allDeclarations.filter(
        (d) => d.category === meta.category && d.hasCondition,
      );
      const hasCondition = matchingDecls.length > 0;

      const affectedDetailsList = matchingDecls.map((d) => {
        const cp = contractPersons.find((c) => c.id === d.contractPerson?.id);
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
  }

  private buildTitularRow(
    titularCp: ContractPerson | undefined,
    contractPlan?: Plan | null,
  ): TitularSummaryRow | null {
    if (!titularCp) return null;
    const titularPlan = titularCp.plan || titularCp.person?.plan || contractPlan;
    return {
      name: titularCp.person.name,
      typeIdentityCard: titularCp.person.typeIdentityCard,
      identityCard: titularCp.person.identityCard,
      age: getContractPersonAge(titularCp.person.birthDate),
      planName: titularPlan?.name || 'TITULAR',
      coverage: titularPlan?.coverage
        ? Number(titularPlan.coverage).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : '0.00',
      monthlyCost: titularPlan?.amount ? Number(titularPlan.amount).toFixed(2) : '0.00',
    };
  }

  private buildBeneficiariesSummary(
    affiliateCps: ContractPerson[],
    titularCp: ContractPerson | undefined,
    contractPlan?: Plan | null,
  ): BeneficiarySummaryRow[] {
    return affiliateCps
      .filter((cp) => !isSamePerson(cp, titularCp))
      .map((cp) => {
        const plan = cp.plan || cp.person?.plan || contractPlan;
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
          age: getContractPersonAge(cp.person.birthDate),
          planName: plan?.name || '-',
          coverage,
          monthlyCost: plan ? Number(plan.amount).toFixed(2) : '0.00',
        };
      });
  }

  private buildContractedPlansList(contractPersons: ContractPerson[]): ContractedPlanSummary[] {
    const contractedPlansMap = new Map<
      string,
      { count: number; coverage: string; unitCost: number; totalCost: number }
    >();

    for (const cp of contractPersons) {
      const plan = cp.plan || cp.person?.plan;
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

    return Array.from(contractedPlansMap.entries()).map(([name, data]) => ({
      name,
      count: data.count,
      coverage: data.coverage,
      unitCost: data.unitCost.toFixed(2),
      totalCost: data.totalCost.toFixed(2),
    }));
  }

  private buildAllMembers(contractPersons: ContractPerson[]): ContractMember[] {
    const uniquePersonsMap = new Map<string, Person>();
    for (const cp of contractPersons) {
      if (cp.person) {
        const key = `${cp.person.typeIdentityCard}-${cp.person.identityCard}`;
        if (!uniquePersonsMap.has(key)) {
          uniquePersonsMap.set(key, cp.person);
        }
      }
    }

    return Array.from(uniquePersonsMap.values()).map((person) => {
      const ageNum = person.birthDate ? getContractPersonAge(person.birthDate) : 99;
      return {
        name: person.name,
        isPN:
          person.typeIdentityCard === TypeIdentityCard.PN ||
          (Boolean(person.birthDate) && ageNum < 18),
      };
    });
  }
}
