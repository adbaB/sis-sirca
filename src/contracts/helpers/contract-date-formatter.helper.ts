import { DateTime } from 'luxon';
import { getCaracasDateTime, getCaracasNow } from '../../common/utils/date.util';

export interface CalendarDateComponents {
  day: number;
  monthIndex: number;
  year: number;
}

/**
 * Extracts calendar date components (day, 0-indexed month, year) in the Caracas timezone.
 */
export function getCalendarDateComponents(
  dateInput?: Date | string | null,
): CalendarDateComponents {
  if (!dateInput) {
    const now = getCaracasNow();
    return { day: now.day, monthIndex: now.month - 1, year: now.year };
  }

  if (typeof dateInput === 'string') {
    const match = dateInput.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return {
        day: Number(match[3]),
        monthIndex: Number(match[2]) - 1,
        year: Number(match[1]),
      };
    }
    const dt = getCaracasDateTime(dateInput);
    if (!dt.isValid) {
      const now = getCaracasNow();
      return { day: now.day, monthIndex: now.month - 1, year: now.year };
    }
    return {
      day: dt.day,
      monthIndex: dt.month - 1,
      year: dt.year,
    };
  }

  if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    if (dateInput.getUTCHours() === 0 && dateInput.getUTCMinutes() === 0) {
      return {
        day: dateInput.getUTCDate(),
        monthIndex: dateInput.getUTCMonth(),
        year: dateInput.getUTCFullYear(),
      };
    }
    const dt = getCaracasDateTime(dateInput);
    return {
      day: dt.day,
      monthIndex: dt.month - 1,
      year: dt.year,
    };
  }

  const now = getCaracasNow();
  return {
    day: now.day,
    monthIndex: now.month - 1,
    year: now.year,
  };
}

/**
 * Calculates accurate age based on birthdate in Caracas timezone.
 */
export function getContractPersonAge(birthDate?: Date | string | null): number {
  if (!birthDate) return 0;
  const { day, monthIndex, year } = getCalendarDateComponents(birthDate);
  const today = getCaracasNow();
  let age = today.year - year;
  const m = today.month - 1 - monthIndex;
  if (m < 0 || (m === 0 && today.day < day)) {
    age--;
  }
  return age;
}

/**
 * Formats a Date or date string to DD-MM-YYYY.
 */
export function formatContractDate(date?: Date | string | null): string {
  if (!date) return '-';
  const { day, monthIndex, year } = getCalendarDateComponents(date);
  const dayStr = String(day).padStart(2, '0');
  const monthStr = String(monthIndex + 1).padStart(2, '0');
  return `${dayStr}-${monthStr}-${year}`;
}

/**
 * Calculates the contract expiration date given a start date (or affiliation date).
 * Business rule: The cycle is 1 year minus 1 month, ending on the last day of that month.
 * Example: startDate = 2026-06-28 -> expirationDate = 2027-05-31.
 * Example: startDate = 2026-01-15 -> expirationDate = 2026-12-31.
 */
export function calculateContractExpirationDate(startDate: Date | string): string {
  const { year, monthIndex } = getCalendarDateComponents(startDate);
  const dt = DateTime.fromObject(
    { year, month: monthIndex + 1, day: 1 },
    { zone: 'America/Caracas' },
  );
  return dt.plus({ years: 1 }).minus({ months: 1 }).endOf('month').toISODate()!;
}
