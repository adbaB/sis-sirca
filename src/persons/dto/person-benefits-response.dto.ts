import { PlanServiceLimitType } from '../../plans/entities/plan-service.entity';

export type BenefitCoverageStatus = 'COVERED' | 'WAITING_PERIOD' | 'EXCLUDED';

export class PersonBenefitPersonSummaryDto {
  id: string;
  firstName: string;
  lastName: string;
  identityCard: string;
  typeIdentityCard: string;
  name?: string;
}

export class PersonBenefitContractSummaryDto {
  id: string;
  code: string;
  status: string;
  affiliationDate: Date | string;
}

export class PersonBenefitPlanSummaryDto {
  id: string;
  code: string;
  name: string;
  description?: string;
}

export class PersonBenefitItemDto {
  planServiceId: string;
  medicalServiceId: string;
  medicalServiceCode: string;
  medicalServiceName: string;
  serviceCategoryId: string;
  serviceCategoryName: string;
  limitType: PlanServiceLimitType | string;
  limitQuantity: number | null;
  waitingPeriodDays: number;
  remainingWaitingPeriodDays: number;
  copayAmount: number;
  copayPercentage: number;
  status: BenefitCoverageStatus;
  isCovered: boolean;
  exclusionReason?: string | null;
  exclusionSource?: string | null;
  effectiveDate?: Date | null;
}

export class PersonBenefitsResponseDto {
  person: PersonBenefitPersonSummaryDto;
  contract: PersonBenefitContractSummaryDto;
  plan: PersonBenefitPlanSummaryDto;
  affiliationDaysElapsed: number;
  services: PersonBenefitItemDto[];
}
