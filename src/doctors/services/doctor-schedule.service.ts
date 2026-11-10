import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DateTime } from 'luxon';
import { CARACAS_ZONE } from '../../common/utils/date.util';
import {
  EntityNotFoundException,
  InvalidDomainOperationException,
} from '../../common/exceptions/domain-exceptions';
import { Doctor, type DoctorDaySchedule } from '../entities/doctor.entity';
import { Eventuality, EventualityType } from '../../eventualities/entities/eventuality.entity';
import { UpdateDoctorScheduleDto } from '../dto/update-doctor-schedule.dto';
import {
  buildDoctorAvailability,
  validateDoctorSlotBooking,
  type BookedAppointmentInput,
  type DoctorAvailabilitySummary,
  type SlotValidationResult,
} from '../helpers/doctor-availability.helper';

@Injectable()
export class DoctorScheduleService {
  constructor(
    @InjectRepository(Doctor)
    private readonly doctorRepo: Repository<Doctor>,
    @InjectRepository(Eventuality)
    private readonly eventualityRepo: Repository<Eventuality>,
  ) {}

  async updateScheduleConfig(doctorId: string, dto: UpdateDoctorScheduleDto): Promise<Doctor> {
    const doctor = await this.doctorRepo.findOne({ where: { id: doctorId } });
    if (!doctor) {
      throw new EntityNotFoundException('Médico', doctorId);
    }

    const mappedSchedule: DoctorDaySchedule[] = (dto.weeklySchedule || []).map((day) => {
      if (day.enabled && day.endTime <= day.startTime) {
        throw new InvalidDomainOperationException(
          `La hora de fin (${day.endTime}) debe ser posterior a la hora de inicio (${day.startTime}).`,
        );
      }
      return {
        dayOfWeek: day.dayOfWeek,
        enabled: day.enabled,
        startTime: day.startTime,
        endTime: day.endTime,
      };
    });

    doctor.consultationDurationMinutes = dto.consultationDurationMinutes;
    doctor.maxDailyConsultations =
      dto.maxDailyConsultations !== undefined ? dto.maxDailyConsultations : null;
    doctor.maxWeeklyConsultations =
      dto.maxWeeklyConsultations !== undefined ? dto.maxWeeklyConsultations : null;
    doctor.maxMonthlyConsultations =
      dto.maxMonthlyConsultations !== undefined ? dto.maxMonthlyConsultations : null;
    doctor.defaultMedicalServiceId =
      dto.defaultMedicalServiceId !== undefined ? dto.defaultMedicalServiceId : null;
    doctor.weeklySchedule = mappedSchedule;

    return this.doctorRepo.save(doctor);
  }

  async getDoctorAvailability(
    doctorId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<DoctorAvailabilitySummary> {
    const doctor = await this.doctorRepo.findOne({ where: { id: doctorId } });
    if (!doctor) {
      throw new EntityNotFoundException('Médico', doctorId);
    }

    const nowCaracas = DateTime.now().setZone(CARACAS_ZONE);
    const resolvedStart = startDate || nowCaracas.toFormat('yyyy-MM-dd');
    const resolvedEnd = endDate || nowCaracas.plus({ days: 30 }).toFormat('yyyy-MM-dd');

    const appointments = await this.fetchDoctorAppointmentsForWindow(
      doctorId,
      resolvedStart,
      resolvedEnd,
    );

    return buildDoctorAvailability({
      config: {
        consultationDurationMinutes: doctor.consultationDurationMinutes || 30,
        maxDailyConsultations: doctor.maxDailyConsultations ?? null,
        maxWeeklyConsultations: doctor.maxWeeklyConsultations ?? null,
        maxMonthlyConsultations: doctor.maxMonthlyConsultations ?? null,
        weeklySchedule: doctor.weeklySchedule || [],
      },
      startDate: resolvedStart,
      endDate: resolvedEnd,
      appointments,
    });
  }

  async validateSlotForDoctor(params: {
    readonly doctor: Doctor;
    readonly scheduledAt: Date | string;
    readonly excludeEventualityId?: string;
  }): Promise<SlotValidationResult> {
    const dt =
      params.scheduledAt instanceof Date
        ? DateTime.fromJSDate(params.scheduledAt).setZone(CARACAS_ZONE)
        : DateTime.fromISO(params.scheduledAt, { zone: CARACAS_ZONE });

    const dateStr = dt.isValid ? dt.toFormat('yyyy-MM-dd') : '';
    const appointments = dateStr
      ? await this.fetchDoctorAppointmentsForWindow(params.doctor.id, dateStr, dateStr)
      : [];

    return validateDoctorSlotBooking({
      config: {
        consultationDurationMinutes: params.doctor.consultationDurationMinutes || 30,
        maxDailyConsultations: params.doctor.maxDailyConsultations ?? null,
        maxWeeklyConsultations: params.doctor.maxWeeklyConsultations ?? null,
        maxMonthlyConsultations: params.doctor.maxMonthlyConsultations ?? null,
        weeklySchedule: params.doctor.weeklySchedule || [],
      },
      scheduledAt: params.scheduledAt,
      appointments,
      excludeEventualityId: params.excludeEventualityId,
    });
  }

  private async fetchDoctorAppointmentsForWindow(
    doctorId: string,
    startDate: string,
    endDate: string,
  ): Promise<BookedAppointmentInput[]> {
    const startDt = DateTime.fromISO(startDate, { zone: CARACAS_ZONE })
      .startOf('month')
      .minus({ days: 7 })
      .toJSDate();
    const endDt = DateTime.fromISO(endDate, { zone: CARACAS_ZONE })
      .endOf('month')
      .plus({ days: 7 })
      .toJSDate();

    const rows = await this.eventualityRepo
      .createQueryBuilder('e')
      .select(['e.id', 'e.admissionDate', 'e.status'])
      .where('e.doctorId = :doctorId', { doctorId })
      .andWhere('e.type = :type', { type: EventualityType.CONSULTATION })
      .andWhere('e.admissionDate BETWEEN :startDt AND :endDt', { startDt, endDt })
      .getMany();

    return rows
      .filter((r) => Boolean(r.admissionDate))
      .map((r) => ({
        id: r.id,
        scheduledAt: r.admissionDate as Date,
        status: r.status,
      }));
  }
}
