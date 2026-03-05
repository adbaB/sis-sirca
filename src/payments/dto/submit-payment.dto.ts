import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class SubmitPaymentDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  // We can add more fields depending on what SIRCA needs.
  // The image (comprobante) will be handled separately by the FileInterceptor.
}
