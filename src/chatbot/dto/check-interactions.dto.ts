import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class CheckInteractionsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  invoiceIds: string[];
}
