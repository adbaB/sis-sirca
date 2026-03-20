import { TypeIdentityCard } from '../../persons/entities/person.entity';

export interface DataCleaned {
  name: string;
  typeIdentityCard: TypeIdentityCard;
  identityCard: string;
  affiliationDate: string;
  contract: string;
  isTitular: boolean;
  plan: string;
  gender: boolean;
  // Row number (1-indexed) for log traceability, without exposing PII.
  rowNumber: number;
}
