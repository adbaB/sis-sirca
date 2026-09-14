import { PersonStatus, TypeIdentityCard } from '../../persons/entities/person.entity';
import { Parentesco } from '../entities/contract-person.entity';
import { ContractStatus } from '../entities/contract.entity';

export enum VerificationMode {
  BY_CONTRACT = 'BY_CONTRACT',
  BY_PERSON = 'BY_PERSON',
}

/**
 * Detalle de un beneficiario asociado a un contrato.
 */
export interface ContractBeneficiaryItem {
  contractPersonId: string;
  personId: string;
  name: string;
  typeIdentityCard: TypeIdentityCard;
  identityCard: string;
  birthDate?: Date;
  phone?: string;
  relationship?: Parentesco;
  planName: string | null;
  personStatus: PersonStatus;
  isEligible: boolean;
}

/**
 * Contrato donde la persona consultada figura como beneficiaria directa (Lista 1).
 */
export interface BeneficiaryContractItem {
  id: string;
  code: string;
  status: ContractStatus;
  isSuspended: boolean;
  isEligible: boolean;
  affiliationDate: Date;
  planName: string | null;
}

/**
 * Contrato donde la persona consultada es Titular o Pagadora (isBillingOwner),
 * con su lista de beneficiarios afiliados (Lista 2).
 */
export interface OwnerContractItem {
  id: string;
  code: string;
  status: ContractStatus;
  isSuspended: boolean;
  affiliationDate: Date;
  cutoffDay: number;
  isTitular: boolean;
  isBillingOwner: boolean;
  titular: {
    id: string;
    name: string;
    typeIdentityCard: TypeIdentityCard;
    identityCard: string;
    phone?: string;
  } | null;
  beneficiaries: ContractBeneficiaryItem[];
  totalBeneficiaries: number;
}

/**
 * Resultado de verificación cuando se busca por Cédula o RIF.
 */
export interface PersonVerificationResult {
  mode: VerificationMode.BY_PERSON;
  person: {
    id: string;
    name: string;
    typeIdentityCard: TypeIdentityCard;
    identityCard: string;
    phone?: string;
    birthDate?: Date;
    status: PersonStatus;
  };
  beneficiaryContracts: BeneficiaryContractItem[];
  ownerContracts: OwnerContractItem[];
}

/**
 * Resultado de verificación cuando se busca directamente por código de contrato.
 */
export interface ContractVerificationResult {
  mode: VerificationMode.BY_CONTRACT;
  contract: {
    id: string;
    code: string;
    status: ContractStatus;
    isSuspended: boolean;
    affiliationDate: Date;
    cutoffDay: number;
    titular: {
      id: string;
      name: string;
      typeIdentityCard: TypeIdentityCard;
      identityCard: string;
      phone?: string;
    } | null;
  };
  beneficiaries: ContractBeneficiaryItem[];
  totalBeneficiaries: number;
}

export type UnifiedVerificationResult = ContractVerificationResult | PersonVerificationResult;
