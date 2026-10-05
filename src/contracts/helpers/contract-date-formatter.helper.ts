import { DateTime } from 'luxon';
import { CARACAS_ZONE, getCaracasDateTime, getCaracasNow } from '../../common/utils/date.util';

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

export interface ContractPersonAgeDetail {
  years: number;
  months: number;
  isMonthsOld: boolean;
}

export interface FormatContractPersonAgeOptions {
  withUnitForYears?: boolean;
  referenceDate?: Date | string | DateTime | null;
}

/**
 * Calculates accurate age in both years and months in Caracas timezone.
 * When years is 0, the person is months old (a baby).
 */
export function getContractPersonAgeDetail(
  birthDate?: Date | string | null,
  referenceDate?: Date | string | DateTime | null,
): ContractPersonAgeDetail {
  if (!birthDate) return { years: 0, months: 0, isMonthsOld: false };
  const { day, monthIndex, year } = getCalendarDateComponents(birthDate);
  const birthDt = DateTime.fromObject(
    { year, month: monthIndex + 1, day },
    { zone: CARACAS_ZONE },
  ).startOf('day');

  let targetDt: DateTime;
  if (referenceDate) {
    if (referenceDate instanceof DateTime) {
      targetDt = referenceDate.setZone(CARACAS_ZONE).startOf('day');
    } else {
      const refComp = getCalendarDateComponents(referenceDate);
      targetDt = DateTime.fromObject(
        { year: refComp.year, month: refComp.monthIndex + 1, day: refComp.day },
        { zone: CARACAS_ZONE },
      ).startOf('day');
    }
  } else {
    targetDt = getCaracasNow().startOf('day');
  }

  if (!birthDt.isValid || !targetDt.isValid || targetDt < birthDt) {
    return { years: 0, months: 0, isMonthsOld: false };
  }

  const diff = targetDt.diff(birthDt, ['years', 'months', 'days']);
  const years = Math.max(0, Math.floor(diff.years));
  const months = Math.max(0, Math.floor(diff.months));

  return {
    years,
    months,
    isMonthsOld: years === 0,
  };
}

/**
 * Calculates accurate age based on birthdate in Caracas timezone.
 */
export function getContractPersonAge(
  birthDate?: Date | string | null,
  referenceDate?: Date | string | DateTime | null,
): number {
  if (!birthDate) return 0;
  return getContractPersonAgeDetail(birthDate, referenceDate).years;
}

/**
 * Formats a person's age for contract documents.
 * - When the person is under 1 year old (months of born): "X MESES" or "1 MES"
 * - When the person is 1 year old or older:
 *    - withUnitForYears === true: "1 AÑO" or "X AÑOS"
 *    - withUnitForYears === false: "X"
 * - When birthDate is null, undefined, or invalid: "-"
 */
export function formatContractPersonAge(
  birthDate?: Date | string | null,
  options?: FormatContractPersonAgeOptions,
): string {
  if (!birthDate) return '-';
  const detail = getContractPersonAgeDetail(birthDate, options?.referenceDate);

  if (detail.isMonthsOld) {
    return `${detail.months} ${detail.months === 1 ? 'MES' : 'MESES'}`;
  }

  const withUnit = options?.withUnitForYears ?? true;
  if (withUnit) {
    return `${detail.years} ${detail.years === 1 ? 'AÑO' : 'AÑOS'}`;
  }

  return String(detail.years);
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
