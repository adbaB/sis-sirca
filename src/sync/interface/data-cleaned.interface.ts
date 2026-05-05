import { PersonStatus, TypeIdentityCard } from '../../persons/entities/person.entity';

export interface DataCleaned {
  name: string;
  typeIdentityCard: TypeIdentityCard;
  identityCard: string;
  affiliationDate: string;
  contract: string;
  isTitular: boolean;
  plan: string;
  gender: boolean;
  isBillingOwner: boolean;
  status: PersonStatus;
  advisor: string;
  // Row number (1-indexed) for log traceability, without exposing PII.
  rowNumber: number;
}
