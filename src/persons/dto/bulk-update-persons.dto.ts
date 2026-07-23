import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsUUID, ValidateNested } from 'class-validator';
import { UpdatePersonDto } from './update-person.dto';

export class UpdatePersonWithIdDto extends UpdatePersonDto {
  @IsUUID()
  @IsNotEmpty()
  id: string;
}

export class BulkUpdatePersonsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdatePersonWithIdDto)
  persons: UpdatePersonWithIdDto[];
}
