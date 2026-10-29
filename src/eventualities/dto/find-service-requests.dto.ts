import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import {
  ServiceRequestStatus,
  ServiceRequestType,
} from '../entities/eventuality-service-request.entity';

export class FindServiceRequestsDto {
  @IsOptional()
  @IsUUID('4')
  personId?: string;

  @IsOptional()
  @IsIn([
    ServiceRequestStatus.PENDING,
    ServiceRequestStatus.CONVERTED,
    ServiceRequestStatus.CANCELLED,
  ])
  status?: ServiceRequestStatus;

  @IsOptional()
  @IsIn([
    ServiceRequestType.LABORATORY,
    ServiceRequestType.IMAGING,
    ServiceRequestType.SPECIAL_STUDY,
    ServiceRequestType.CONSULTATION,
    ServiceRequestType.HOSPITALIZATION,
  ])
  requestType?: ServiceRequestType;

  @IsOptional()
  @IsUUID('4')
  eventualityId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  page?: string;

  @IsOptional()
  limit?: string;
}
