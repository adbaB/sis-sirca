import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { EventualityStatus, EventualityType } from '../entities/eventuality.entity';

export class FindEventualitiesDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(EventualityType)
  type?: EventualityType;

  @IsOptional()
  @IsEnum(EventualityStatus)
  status?: EventualityStatus;

  @IsOptional()
  @IsUUID()
  personId?: string;

  @IsOptional()
  @IsUUID()
  contractId?: string;

  @IsOptional()
  @IsString()
  claimNumber?: string;
}
