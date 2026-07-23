import { IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class GetInteractionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @ValidateIf((o) => Boolean(o.invoiceId))
  @IsString()
  @IsUUID('4')
  invoiceId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
