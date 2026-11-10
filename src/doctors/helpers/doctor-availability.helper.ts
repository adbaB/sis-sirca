import { DateTime } from 'luxon';
import { CARACAS_ZONE } from '../../common/utils/date.util';
import type { DoctorDaySchedule } from '../entities/doctor.entity';

export interface DoctorScheduleConfigInput {
  readonly consultationDurationMinutes: number;
  readonly maxDailyConsultations: number | null;
  readonly maxWeeklyConsultations: number | null;
  readonly maxMonthlyConsultations: number | null;
  readonly weeklySchedule: readonly DoctorDaySchedule[];
}

export interface BookedAppointmentInput {
  readonly id: string;
  readonly scheduledAt: Date | string;
  readonly status: string;
}

export type DoctorSlotStatus = 'AVAILABLE' | 'BOOKED' | 'QUOTA_REACHED' | 'PAST';

export interface DoctorTimeSlot {
  readonly startTime: string;
  readonly endTime: string;
  readonly isoDateTime: string;
  readonly status: DoctorSlotStatus;
  readonly bookedEventualityId?: string;
}

export interface DoctorDayAvailability {
  readonly date: string;
  readonly dayOfWeek: number;
  readonly enabled: boolean;
  readonly bookedCount: number;
  readonly maxDaily: number | null;
  readonly availableCount: number;
  readonly slots: readonly DoctorTimeSlot[];
}

export interface DoctorAvailabilitySummary {
  readonly consultationDurationMinutes: number;
  readonly quotas: {
    readonly maxDaily: number | null;
    readonly maxWeekly: number | null;
    readonly maxMonthly: number | null;
    readonly currentWeekBooked: number;
    readonly currentMonthBooked: number;
  };
  readonly days: readonly DoctorDayAvailability[];
}

export interface SlotValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
  readonly normalizedIsoDateTime?: string;
  readonly date?: string;
  readonly startTime?: string;
}

function parseTimeMinutes(timeStr: string): number {
  const [hh, mm] = (timeStr || '08:00').split(':').map((n) => parseInt(n, 10));
  return (Number.isFinite(hh) ? hh : 8) * 60 + (Number.isFinite(mm) ? mm : 0);
}

function formatMinutesToHHmm(totalMinutes: number): string {
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function toCaracasDateTime(value: Date | string): DateTime {
  return value instanceof Date
    ? DateTime.fromJSDate(value).setZone(CARACAS_ZONE)
    : DateTime.fromISO(value, { zone: CARACAS_ZONE });
}

function getIsoWeekKey(dt: DateTime): string {
  return `${dt.weekYear}-W${String(dt.weekNumber).padStart(2, '0')}`;
}

function filterActiveAppointments(
  appointments: readonly BookedAppointmentInput[],
  excludeEventualityId?: string,
) {
  return appointments
    .filter(
      (a) => a.id !== excludeEventualityId && a.status !== 'CANCELLED' && a.status !== 'REJECTED',
    )
    .map((a) => {
      const dt = toCaracasDateTime(a.scheduledAt);
      return { id: a.id, dt, dateStr: dt.toFormat('yyyy-MM-dd'), timeStr: dt.toFormat('HH:mm') };
    })
    .filter((a) => a.dt.isValid);
}

function buildDaySlots(params: {
  readonly dateStr: string;
  readonly dayRule: DoctorDaySchedule | undefined;
  readonly duration: number;
  readonly dayBookedList: ReadonlyArray<{ id: string; timeStr: string }>;
  readonly quotaReached: boolean;
  readonly nowDt: DateTime;
}): DoctorTimeSlot[] {
  if (!params.dayRule) return [];
  const startMins = parseTimeMinutes(params.dayRule.startTime);
  const endMins = parseTimeMinutes(params.dayRule.endTime);
  const slots: DoctorTimeSlot[] = [];

  for (let m = startMins; m + params.duration <= endMins; m += params.duration) {
    const slotStart = formatMinutesToHHmm(m);
    const slotEnd = formatMinutesToHHmm(m + params.duration);
    const slotDt = DateTime.fromISO(`${params.dateStr}T${slotStart}:00`, { zone: CARACAS_ZONE });
    const matchedBooking = params.dayBookedList.find((b) => b.timeStr === slotStart);

    let status: DoctorSlotStatus = 'AVAILABLE';
    if (matchedBooking) status = 'BOOKED';
    else if (slotDt < params.nowDt) status = 'PAST';
    else if (params.quotaReached) status = 'QUOTA_REACHED';

    slots.push({
      startTime: slotStart,
      endTime: slotEnd,
      isoDateTime: slotDt.toISO() || `${params.dateStr}T${slotStart}:00.000-04:00`,
      status,
      bookedEventualityId: matchedBooking?.id,
    });
  }
  return slots;
}

export function buildDoctorAvailability(params: {
  readonly config: DoctorScheduleConfigInput;
  readonly startDate: string;
  readonly endDate: string;
  readonly appointments: readonly BookedAppointmentInput[];
  readonly referenceNow?: Date;
}): DoctorAvailabilitySummary {
  const duration = Math.max(5, params.config.consultationDurationMinutes || 30);
  const nowDt = params.referenceNow
    ? DateTime.fromJSDate(params.referenceNow).setZone(CARACAS_ZONE)
    : DateTime.now().setZone(CARACAS_ZONE);

  const activeAppts = filterActiveAppointments(params.appointments);
  const weekCounts = new Map<string, number>();
  const monthCounts = new Map<string, number>();
  const dayApptsMap = new Map<string, Array<{ id: string; timeStr: string }>>();

  for (const appt of activeAppts) {
    const wk = getIsoWeekKey(appt.dt);
    const mk = appt.dt.toFormat('yyyy-MM');
    weekCounts.set(wk, (weekCounts.get(wk) ?? 0) + 1);
    monthCounts.set(mk, (monthCounts.get(mk) ?? 0) + 1);
    const list = dayApptsMap.get(appt.dateStr) ?? [];
    list.push({ id: appt.id, timeStr: appt.timeStr });
    dayApptsMap.set(appt.dateStr, list);
  }

  const startDt = DateTime.fromISO(params.startDate, { zone: CARACAS_ZONE }).startOf('day');
  const endDt = DateTime.fromISO(params.endDate, { zone: CARACAS_ZONE }).startOf('day');
  const days: DoctorDayAvailability[] = [];

  for (let cursor = startDt; cursor <= endDt; cursor = cursor.plus({ days: 1 })) {
    const dateStr = cursor.toFormat('yyyy-MM-dd');
    const jsDayOfWeek = cursor.weekday === 7 ? 0 : cursor.weekday;
    const dayRule = (params.config.weeklySchedule || []).find(
      (d) => d.dayOfWeek === jsDayOfWeek && d.enabled,
    );
    const dayBookedList = dayApptsMap.get(dateStr) ?? [];
    const bookedCount = dayBookedList.length;
    const quotaReached =
      (params.config.maxDailyConsultations !== null &&
        bookedCount >= params.config.maxDailyConsultations) ||
      (params.config.maxWeeklyConsultations !== null &&
        (weekCounts.get(getIsoWeekKey(cursor)) ?? 0) >= params.config.maxWeeklyConsultations) ||
      (params.config.maxMonthlyConsultations !== null &&
        (monthCounts.get(cursor.toFormat('yyyy-MM')) ?? 0) >=
          params.config.maxMonthlyConsultations);

    const slots = buildDaySlots({
      dateStr,
      dayRule,
      duration,
      dayBookedList,
      quotaReached,
      nowDt,
    });
    const availableSlotsCount = slots.filter((s) => s.status === 'AVAILABLE').length;
    const remainingDailyQuota =
      params.config.maxDailyConsultations !== null
        ? Math.max(0, params.config.maxDailyConsultations - bookedCount)
        : availableSlotsCount;

    days.push({
      date: dateStr,
      dayOfWeek: jsDayOfWeek,
      enabled: Boolean(dayRule),
      bookedCount,
      maxDaily: params.config.maxDailyConsultations,
      availableCount: Math.min(availableSlotsCount, remainingDailyQuota),
      slots,
    });
  }

  const refTarget = startDt.isValid ? startDt : nowDt;
  return {
    consultationDurationMinutes: duration,
    quotas: {
      maxDaily: params.config.maxDailyConsultations,
      maxWeekly: params.config.maxWeeklyConsultations,
      maxMonthly: params.config.maxMonthlyConsultations,
      currentWeekBooked: weekCounts.get(getIsoWeekKey(refTarget)) ?? 0,
      currentMonthBooked: monthCounts.get(refTarget.toFormat('yyyy-MM')) ?? 0,
    },
    days,
  };
}

export function validateDoctorSlotBooking(params: {
  readonly config: DoctorScheduleConfigInput;
  readonly scheduledAt: Date | string;
  readonly appointments: readonly BookedAppointmentInput[];
  readonly excludeEventualityId?: string;
  readonly referenceNow?: Date;
}): SlotValidationResult {
  const targetDt = toCaracasDateTime(params.scheduledAt);
  if (!targetDt.isValid) {
    return { valid: false, reason: 'La fecha y hora de la cita no tienen un formato válido.' };
  }

  const dateStr = targetDt.toFormat('yyyy-MM-dd');
  const startTime = targetDt.toFormat('HH:mm');
  const summary = buildDoctorAvailability({
    config: params.config,
    startDate: dateStr,
    endDate: dateStr,
    appointments: params.appointments.filter((a) => a.id !== params.excludeEventualityId),
    referenceNow: params.referenceNow,
  });

  const dayInfo = summary.days[0];
  if (!dayInfo || !dayInfo.enabled) {
    return { valid: false, reason: `El médico no pasa consulta en la fecha (${dateStr}).` };
  }
  const slot = dayInfo.slots.find((s) => s.startTime === startTime);
  if (!slot) {
    return { valid: false, reason: `La hora ${startTime} no coincide con la agenda del médico.` };
  }
  if (slot.status === 'BOOKED') {
    return { valid: false, reason: `El turno ${startTime} del ${dateStr} ya está ocupado.` };
  }
  if (slot.status === 'PAST') {
    return {
      valid: false,
      reason: `No se puede agendar en fecha/hora pasada (${dateStr} ${startTime}).`,
    };
  }
  if (slot.status === 'QUOTA_REACHED') {
    return {
      valid: false,
      reason: 'El médico alcanzó su cupo máximo de consultas para esa fecha.',
    };
  }
  return { valid: true, normalizedIsoDateTime: slot.isoDateTime, date: dateStr, startTime };
}
