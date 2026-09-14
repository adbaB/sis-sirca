import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsUUID, ValidateIf, ValidateNested } from 'class-validator';
import { UpdateBeneficiaryDto } from './update-beneficiary.dto';

export class BulkUpdateBeneficiaryItemDto extends UpdateBeneficiaryDto {
  @ValidateIf((o: BulkUpdateBeneficiaryItemDto) => !o.id || o.contractPersonId !== undefined)
  @IsUUID()
  contractPersonId?: string;

  @ValidateIf((o: BulkUpdateBeneficiaryItemDto) => !o.contractPersonId || o.id !== undefined)
  @IsUUID()
  id?: string;
}

export class BulkUpdateBeneficiariesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateBeneficiaryItemDto)
  beneficiaries: BulkUpdateBeneficiaryItemDto[];
}
