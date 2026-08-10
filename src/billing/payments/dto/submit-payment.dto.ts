import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

/**
 * DTO para la recepción inicial de reportes de pago enviados por usuarios externos.
 */
export class SubmitPaymentDto {
  /** Nombre completo de la persona que reporta el pago. */
  @IsString()
  @IsNotEmpty()
  name: string;

  /** Correo electrónico de contacto del pagador. */
  @IsEmail()
  @IsNotEmpty()
  email: string;

  // Se pueden agregar más campos según requiera el flujo.
  // El archivo de comprobante se gestiona por separado mediante FileInterceptor.
}
