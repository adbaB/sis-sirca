import { IsDateString, IsNotEmpty } from 'class-validator';

export class AffiliationsReportQueryDto {
  @IsNotEmpty({ message: 'La fecha inicial (startDate) es requerida.' })
  @IsDateString(
    {},
    { message: 'La fecha inicial (startDate) debe tener un formato válido YYYY-MM-DD.' },
  )
  startDate: string;

  @IsNotEmpty({ message: 'La fecha final (endDate) es requerida.' })
  @IsDateString(
    {},
    { message: 'La fecha final (endDate) debe tener un formato válido YYYY-MM-DD.' },
  )
  endDate: string;
}
