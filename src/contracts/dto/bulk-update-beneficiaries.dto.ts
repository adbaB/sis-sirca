import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { UpdateBeneficiaryDto } from './update-beneficiary.dto';

export class BulkUpdateBeneficiaryItemDto extends UpdateBeneficiaryDto {
  @IsUUID()
  @IsOptional()
  contractPersonId?: string;

  @IsUUID()
  @IsOptional()
  id?: string;
}

export class BulkUpdateBeneficiariesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateBeneficiaryItemDto)
  beneficiaries: BulkUpdateBeneficiaryItemDto[];
}
