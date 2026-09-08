import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Person, PersonStatus, TypeIdentityCard } from '../../persons/entities/person.entity';
import { PersonsService } from '../../persons/services/persons.service';
import { DEFAULT_CUTOFF_DAY } from '../constants/contract.constants';
import { ContractPerson, PersonRole } from '../entities/contract-person.entity';
import { Contract, ContractStatus } from '../entities/contract.entity';
import {
  BeneficiaryContractItem,
  ContractBeneficiaryItem,
  ContractVerificationResult,
  OwnerContractItem,
  PersonVerificationResult,
  UnifiedVerificationResult,
  VerificationMode,
} from '../interfaces/person-verification.interface';

@Injectable()
export class ContractVerificationService {
  constructor(
    @InjectRepository(Contract)
    private readonly contractsRepository: Repository<Contract>,
    @InjectRepository(ContractPerson)
    private readonly contractPersonsRepository: Repository<ContractPerson>,
    private readonly personsService: PersonsService,
  ) {}

  /**
   * Verifies a person's affiliation status across all contracts by their identity card.
   * Returns two distinct lists:
   * 1. beneficiaryContracts: Contracts where the person enjoys health plan coverage as AFILIADO.
   * 2. ownerContracts: Contracts where the person is TITULAR or isBillingOwner, each containing
   *    its full list of affiliated beneficiaries and eligibility status.
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

    const statusPriority: Record<ContractStatus, number> = {
      [ContractStatus.ACTIVE]: 1,
      [ContractStatus.SUSPENDED]: 2,
      [ContractStatus.INACTIVE]: 3,
    };

    const sortByPriority = <T extends { status: ContractStatus; affiliationDate?: Date }>(
      items: T[],
    ): T[] => {
      return items.sort((a, b) => {
        const pA = statusPriority[a.status] ?? 99;
        const pB = statusPriority[b.status] ?? 99;
        if (pA !== pB) return pA - pB;
        const dA = a.affiliationDate ? new Date(a.affiliationDate).getTime() : 0;
        const dB = b.affiliationDate ? new Date(b.affiliationDate).getTime() : 0;
        return dB - dA;
      });
    };

    // ── 1. Contratos donde la persona es BENEFICIARIA (AFILIADO) ────────────
    const beneficiaryAffiliations = await this.contractPersonsRepository.find({
      where: {
        person: { id: person.id },
        role: PersonRole.AFILIADO,
      },
      relations: ['contract', 'plan', 'person', 'person.plan'],
      order: {
        createdAt: 'DESC',
      },
    });

    const seenBeneficiaryContractIds = new Set<string>();
    const rawBeneficiaryContracts: BeneficiaryContractItem[] = [];

    for (const cp of beneficiaryAffiliations) {
      if (!cp.contract || seenBeneficiaryContractIds.has(cp.contract.id)) continue;
      seenBeneficiaryContractIds.add(cp.contract.id);

      const isEligible =
        cp.contract.status === ContractStatus.ACTIVE && person.status === PersonStatus.ACTIVE;

      rawBeneficiaryContracts.push({
        id: cp.contract.id,
        code: cp.contract.code,
        status: cp.contract.status,
        isSuspended: cp.contract.status === ContractStatus.SUSPENDED,
        isEligible,
        affiliationDate: cp.contract.affiliationDate,
        planName: cp.plan?.name ?? cp.person?.plan?.name ?? null,
      });
    }

    const beneficiaryContracts = sortByPriority(rawBeneficiaryContracts);

    // ── 2. Contratos donde la persona es TITULAR o isBillingOwner ─────────────
    const ownerAffiliations = await this.contractPersonsRepository.find({
      where: [
        { person: { id: person.id }, role: PersonRole.TITULAR },
        { person: { id: person.id }, isBillingOwner: true },
      ],
      relations: ['contract'],
      order: {
        createdAt: 'DESC',
      },
    });

    const ownerContractMap = new Map<string, { isTitular: boolean; isBillingOwner: boolean }>();
    for (const aff of ownerAffiliations) {
      if (!aff.contract?.id) continue;
      const existing = ownerContractMap.get(aff.contract.id) ?? {
        isTitular: false,
        isBillingOwner: false,
      };
      if (aff.role === PersonRole.TITULAR) existing.isTitular = true;
      if (aff.isBillingOwner) existing.isBillingOwner = true;
      ownerContractMap.set(aff.contract.id, existing);
    }

    let ownerContracts: OwnerContractItem[] = [];

    if (ownerContractMap.size > 0) {
      const ownerContractIds = Array.from(ownerContractMap.keys());
      const ownerContractsEntities = await this.contractsRepository.find({
        where: { id: In(ownerContractIds) },
        relations: [
          'contractPersons',
          'contractPersons.person',
          'contractPersons.plan',
          'contractPersons.person.plan',
        ],
      });

      const rawOwnerContracts: OwnerContractItem[] = ownerContractsEntities.map((contract) => {
        const titularCp =
          contract.contractPersons?.find((cp) => cp.role === PersonRole.TITULAR) ??
          contract.contractPersons?.find((cp) => cp.isBillingOwner === true);
        const titularPerson = titularCp?.person ?? null;

        const beneficiaryCps =
          contract.contractPersons?.filter(
            (cp) => cp.role === PersonRole.AFILIADO && cp.person != null,
          ) ?? [];

        const beneficiaries: ContractBeneficiaryItem[] = beneficiaryCps.map((bcp) => {
          const plan = bcp.plan ?? bcp.person?.plan ?? null;
          const bPerson = bcp.person;
          const isEligible =
            contract.status === ContractStatus.ACTIVE && bPerson?.status === PersonStatus.ACTIVE;

          return {
            contractPersonId: bcp.id,
            personId: bPerson?.id,
            name: bPerson?.name,
            typeIdentityCard: bPerson?.typeIdentityCard,
            identityCard: bPerson?.identityCard,
            birthDate: bPerson?.birthDate,
            phone: bPerson?.phone,
            relationship: bcp.relationship,
            planName: plan?.name ?? null,
            personStatus: bPerson?.status,
            isEligible,
          };
        });

        const flags = ownerContractMap.get(contract.id);

        return {
          id: contract.id,
          code: contract.code,
          status: contract.status,
          isSuspended: contract.status === ContractStatus.SUSPENDED,
          affiliationDate: contract.affiliationDate,
          cutoffDay: contract.cutoffDay ?? DEFAULT_CUTOFF_DAY,
          isTitular: flags?.isTitular ?? false,
          isBillingOwner: flags?.isBillingOwner ?? false,
          titular: titularPerson
            ? {
                id: titularPerson.id,
                name: titularPerson.name,
                typeIdentityCard: titularPerson.typeIdentityCard,
                identityCard: titularPerson.identityCard,
                phone: titularPerson.phone,
              }
            : null,
          beneficiaries,
          totalBeneficiaries: beneficiaries.length,
        };
      });

      ownerContracts = sortByPriority(rawOwnerContracts);
    }

    return {
      mode: VerificationMode.BY_PERSON,
      person: {
        id: person.id,
        name: person.name,
        typeIdentityCard: person.typeIdentityCard,
        identityCard: person.identityCard,
        phone: person.phone,
        birthDate: person.birthDate,
        status: person.status,
      },
      beneficiaryContracts,
      ownerContracts,
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

    const titularCp =
      contract.contractPersons?.find((cp) => cp.role === PersonRole.TITULAR) ??
      contract.contractPersons?.find((cp) => cp.isBillingOwner === true);

    const titularPerson = titularCp?.person ?? null;

    const beneficiaryCps =
      contract.contractPersons?.filter(
        (cp) => cp.role === PersonRole.AFILIADO && cp.person != null,
      ) ?? [];

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
      mode: VerificationMode.BY_CONTRACT,
      contract: {
        id: contract.id,
        code: contract.code,
        status: contract.status,
        isSuspended: contract.status === ContractStatus.SUSPENDED,
        affiliationDate: contract.affiliationDate,
        cutoffDay: contract.cutoffDay ?? DEFAULT_CUTOFF_DAY,
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
    // - Documentos tradicionales: "V-12345678", "V12345678", "E-84123456", "12345678", "J-123456789"
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
    const normalizeCandidates = (res: unknown): Person[] => {
      if (Array.isArray(res)) return res;
      if (res) return [res as Person];
      return [];
    };

    let candidates = normalizeCandidates(
      await this.personsService.findByIdentityCardOnly(cleanNumber),
    );
    if (candidates.length === 0 && cleanNumber !== query) {
      candidates = normalizeCandidates(await this.personsService.findByIdentityCardOnly(query));
    }

    if (candidates.length === 1) {
      return this.verifyPersonAffiliation(
        candidates[0].typeIdentityCard,
        candidates[0].identityCard,
      );
    } else if (candidates.length > 1) {
      for (const candidate of candidates) {
        try {
          const res = await this.verifyPersonAffiliation(
            candidate.typeIdentityCard,
            candidate.identityCard,
          );
          if (res.beneficiaryContracts.length > 0 || res.ownerContracts.length > 0) {
            return res;
          }
        } catch {
          // Siguiente candidato
        }
      }
      const preferred =
        candidates.find((c) => c.typeIdentityCard === TypeIdentityCard.V) ?? candidates[0];
      return this.verifyPersonAffiliation(preferred.typeIdentityCard, preferred.identityCard);
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
