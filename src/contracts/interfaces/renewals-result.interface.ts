import { PaginationMeta } from '../../common/interfaces/paginated-result.interface';
import { Contract } from '../entities/contract.entity';

export interface RenewalCounts {
  expiringSoon: number;
  pendingRenewal: number;
}

export interface RenewalsResult {
  data: Contract[];
  counts: RenewalCounts;
  meta: PaginationMeta;
}
