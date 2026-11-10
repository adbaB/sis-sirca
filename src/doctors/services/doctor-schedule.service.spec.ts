import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Repository } from 'typeorm';
import { DoctorScheduleService } from './doctor-schedule.service';
import { Doctor } from '../entities/doctor.entity';
import { Eventuality } from '../../eventualities/entities/eventuality.entity';
import {
  EntityNotFoundException,
  InvalidDomainOperationException,
} from '../../common/exceptions/domain-exceptions';

describe('DoctorScheduleService', () => {
  let service: DoctorScheduleService;
  let doctorRepo: {
    findOne: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  };
  let eventualityRepo: {
    createQueryBuilder: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    doctorRepo = {
      findOne: vi.fn(),
      save: vi.fn((d: Doctor) => Promise.resolve(d)),
    };
    const qbMock = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    eventualityRepo = {
      createQueryBuilder: vi.fn(() => qbMock),
    };

    service = new DoctorScheduleService(
      doctorRepo as unknown as Repository<Doctor>,
      eventualityRepo as unknown as Repository<Eventuality>,
    );
  });

  it('throws EntityNotFoundException when updating schedule of non-existent doctor', async () => {
    doctorRepo.findOne.mockResolvedValue(null);

    await expect(
      service.updateScheduleConfig('doc-404', {
        consultationDurationMinutes: 30,
        weeklySchedule: [],
      }),
    ).rejects.toThrow(EntityNotFoundException);
  });

  it('rejects schedule where endTime is not greater than startTime on an enabled day', async () => {
    doctorRepo.findOne.mockResolvedValue({ id: 'doc-1' } as Doctor);

    await expect(
      service.updateScheduleConfig('doc-1', {
        consultationDurationMinutes: 30,
        weeklySchedule: [{ dayOfWeek: 1, enabled: true, startTime: '12:00', endTime: '08:00' }],
      }),
    ).rejects.toThrow(InvalidDomainOperationException);
  });

  it('saves valid doctor schedule configuration and returns updated doctor', async () => {
    const existingDoc = {
      id: 'doc-1',
      firstName: 'Ana',
      lastName: 'Pérez',
      consultationDurationMinutes: 30,
      weeklySchedule: [],
    } as unknown as Doctor;
    doctorRepo.findOne.mockResolvedValue(existingDoc);

    const updated = await service.updateScheduleConfig('doc-1', {
      consultationDurationMinutes: 20,
      maxDailyConsultations: 10,
      maxWeeklyConsultations: 40,
      maxMonthlyConsultations: 120,
      defaultMedicalServiceId: null,
      weeklySchedule: [{ dayOfWeek: 1, enabled: true, startTime: '08:00', endTime: '12:00' }],
    });

    expect(updated.consultationDurationMinutes).toBe(20);
    expect(updated.maxDailyConsultations).toBe(10);
    expect(updated.maxWeeklyConsultations).toBe(40);
    expect(updated.maxMonthlyConsultations).toBe(120);
    expect(updated.weeklySchedule).toHaveLength(1);
    expect(doctorRepo.save).toHaveBeenCalledTimes(1);
  });
});
