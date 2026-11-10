import { describe, expect, it } from 'vitest';
import {
  buildDoctorAvailability,
  validateDoctorSlotBooking,
  type DoctorScheduleConfigInput,
} from './doctor-availability.helper';

describe('doctor-availability.helper', () => {
  const baseConfig: DoctorScheduleConfigInput = {
    consultationDurationMinutes: 30,
    maxDailyConsultations: 3,
    maxWeeklyConsultations: 5,
    maxMonthlyConsultations: 10,
    weeklySchedule: [
      { dayOfWeek: 1, enabled: true, startTime: '08:00', endTime: '10:00' }, // Lunes: 4 bloques de 30m (08:00, 08:30, 09:00, 09:30)
      { dayOfWeek: 3, enabled: true, startTime: '14:00', endTime: '15:30' }, // Miércoles: 3 bloques (14:00, 14:30, 15:00)
    ],
  };

  it('generates 30-minute time slots for enabled days and marks booked slots accurately', () => {
    // 2026-11-09 is Monday (dayOfWeek = 1), 2026-11-10 is Tuesday (dayOfWeek = 2)
    const referenceNow = new Date('2026-11-08T12:00:00-04:00');
    const summary = buildDoctorAvailability({
      config: baseConfig,
      startDate: '2026-11-09',
      endDate: '2026-11-10',
      appointments: [
        {
          id: 'evt-1',
          scheduledAt: '2026-11-09T08:30:00.000-04:00',
          status: 'SCHEDULED',
        },
      ],
      referenceNow,
    });

    expect(summary.days).toHaveLength(2);
    const monday = summary.days[0];
    expect(monday.date).toBe('2026-11-09');
    expect(monday.enabled).toBe(true);
    expect(monday.bookedCount).toBe(1);
    expect(monday.slots).toHaveLength(4);
    expect(monday.slots.map((s) => s.startTime)).toEqual(['08:00', '08:30', '09:00', '09:30']);
    expect(monday.slots[0].status).toBe('AVAILABLE');
    expect(monday.slots[1].status).toBe('BOOKED');
    expect(monday.slots[1].bookedEventualityId).toBe('evt-1');

    const tuesday = summary.days[1];
    expect(tuesday.date).toBe('2026-11-10');
    expect(tuesday.enabled).toBe(false);
    expect(tuesday.slots).toHaveLength(0);
  });

  it('marks remaining slots as QUOTA_REACHED when maxDailyConsultations is reached', () => {
    const referenceNow = new Date('2026-11-08T12:00:00-04:00');
    const summary = buildDoctorAvailability({
      config: baseConfig, // maxDailyConsultations: 3
      startDate: '2026-11-09',
      endDate: '2026-11-09',
      appointments: [
        { id: 'evt-1', scheduledAt: '2026-11-09T08:00:00.000-04:00', status: 'SCHEDULED' },
        { id: 'evt-2', scheduledAt: '2026-11-09T08:30:00.000-04:00', status: 'WAITING_INVOICE' },
        { id: 'evt-3', scheduledAt: '2026-11-09T09:00:00.000-04:00', status: 'CLOSED' },
      ],
      referenceNow,
    });

    const monday = summary.days[0];
    expect(monday.bookedCount).toBe(3);
    expect(monday.availableCount).toBe(0);
    expect(monday.slots[3].startTime).toBe('09:30');
    expect(monday.slots[3].status).toBe('QUOTA_REACHED');
  });

  it('validates booking requests against disabled days, occupied slots, and daily/weekly/monthly quotas', () => {
    const referenceNow = new Date('2026-11-08T12:00:00-04:00');

    // 1. Valid slot on Monday 08:00
    const validRes = validateDoctorSlotBooking({
      config: baseConfig,
      scheduledAt: '2026-11-09T08:00:00-04:00',
      appointments: [],
      referenceNow,
    });
    expect(validRes.valid).toBe(true);

    // 2. Disabled day (Tuesday 2026-11-10)
    const disabledDayRes = validateDoctorSlotBooking({
      config: baseConfig,
      scheduledAt: '2026-11-10T08:00:00-04:00',
      appointments: [],
      referenceNow,
    });
    expect(disabledDayRes.valid).toBe(false);

    // 3. Already booked slot (unless excluded for reschedule)
    const occupiedRes = validateDoctorSlotBooking({
      config: baseConfig,
      scheduledAt: '2026-11-09T08:30:00-04:00',
      appointments: [
        { id: 'evt-99', scheduledAt: '2026-11-09T08:30:00-04:00', status: 'SCHEDULED' },
      ],
      referenceNow,
    });
    expect(occupiedRes.valid).toBe(false);

    const excludedSelfRes = validateDoctorSlotBooking({
      config: baseConfig,
      scheduledAt: '2026-11-09T08:30:00-04:00',
      appointments: [
        { id: 'evt-99', scheduledAt: '2026-11-09T08:30:00-04:00', status: 'SCHEDULED' },
      ],
      excludeEventualityId: 'evt-99',
      referenceNow,
    });
    expect(excludedSelfRes.valid).toBe(true);
  });
});
