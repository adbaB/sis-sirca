import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export enum RenewalPhase {
  EXPIRING_SOON = 'expiring_soon',
  PENDING_RENEWAL = 'pending_renewal',
}

export class FindRenewalsDto extends PaginationQueryDto {
  @IsEnum(RenewalPhase, { message: 'La fase debe ser "expiring_soon" o "pending_renewal".' })
  @IsOptional()
  phase?: RenewalPhase;

  @IsString()
  @IsOptional()
  search?: string;

  @IsUUID('4', { message: 'El advisorId debe ser un UUID válido.' })
  @IsOptional()
  advisorId?: string;
}
