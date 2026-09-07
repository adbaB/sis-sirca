import { PersonStatus, TypeIdentityCard } from '../../persons/entities/person.entity';
import { Parentesco, PersonRole } from '../entities/contract-person.entity';
import { ContractStatus } from '../entities/contract.entity';

export interface VerifiedPersonContract {
  id: string;
  code: string;
  status: ContractStatus;
  affiliationDate: Date;
  role: PersonRole;
  planName: string | null;
  isSuspended: boolean;
}

export interface BeneficiaryVerificationResult {
  mode: 'BY_BENEFICIARY';
  person: {
    id: string;
    name: string;
    typeIdentityCard: TypeIdentityCard;
    identityCard: string;
    phone?: string;
    birthDate?: Date;
    status: PersonStatus;
  };
  contracts: VerifiedPersonContract[];
  hasActiveContract: boolean;
  hasSuspendedContract: boolean;
}

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

export interface ContractVerificationResult {
  mode: 'BY_CONTRACT';
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

export type UnifiedVerificationResult = ContractVerificationResult | BeneficiaryVerificationResult;

// Backward-compatible alias
export type PersonVerificationResult = BeneficiaryVerificationResult;
