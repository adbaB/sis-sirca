import { IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class GetInteractionsQueryDto extends PaginationQueryDto {
  @IsString()
  @IsNotEmpty()
  @IsUUID('4')
  invoiceId: string;
}
