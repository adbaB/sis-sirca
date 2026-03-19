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
}
