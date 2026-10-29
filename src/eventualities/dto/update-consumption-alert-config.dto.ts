import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateConsumptionAlertConfigDto {
  @IsNumber()
  @Min(1)
  @Max(100)
  consumptionThresholdPercentage: number; // Porcentaje que dispara la alerta (ej. 80 para 80%)

  @IsArray()
  @IsString({ each: true })
  notificationPhones: string[]; // Lista de teléfonos para WhatsApp (ej. ["584141234567"])

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  templateName?: string; // Nombre de la plantilla en Meta WhatsApp para alerta de cobertura
}

export interface ConsumptionAlertConfigResponse {
  consumptionThresholdPercentage: number;
  notificationPhones: string[];
  enabled: boolean;
  templateName: string;
}
