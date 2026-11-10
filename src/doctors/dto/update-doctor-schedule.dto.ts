import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class DoctorDayScheduleDto {
  @IsInt()
  @Min(0)
  @Max(6)
  readonly dayOfWeek: number;

  @IsBoolean()
  readonly enabled: boolean;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'La hora de inicio debe estar en formato HH:mm (ej. 08:00).',
  })
  readonly startTime: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'La hora de fin debe estar en formato HH:mm (ej. 12:00).',
  })
  readonly endTime: string;
}

export class UpdateDoctorScheduleDto {
  @IsInt()
  @Min(5)
  @Max(240)
  readonly consultationDurationMinutes: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  readonly maxDailyConsultations?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  readonly maxWeeklyConsultations?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  readonly maxMonthlyConsultations?: number | null;

  @IsOptional()
  @IsUUID('4')
  readonly defaultMedicalServiceId?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DoctorDayScheduleDto)
  readonly weeklySchedule: DoctorDayScheduleDto[];
}
