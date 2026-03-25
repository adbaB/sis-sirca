import { IsBoolean, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class CreatePaymentTypeDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsObject()
  @IsOptional()
  datos?: any;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
