import { DateTime } from 'luxon';

export const CARACAS_ZONE = 'America/Caracas';

/**
 * Returns the current time as a Luxon DateTime in America/Caracas timezone.
 */
export function getCaracasNow(): DateTime {
  return DateTime.now().setZone(CARACAS_ZONE);
}

/**
 * Returns the current time as a JavaScript Date object translated to America/Caracas timezone.
 */
export function getCaracasTodayJSDate(): Date {
  return getCaracasNow().toJSDate();
}

/**
 * Formats a Date, string, or DateTime to a string in America/Caracas timezone.
 * Defaults to YYYY-MM-DD.
 */
export function formatToISODateString(dateVal: Date | string | DateTime): string {
  if (!dateVal) return '';
  let dt: DateTime;
  if (dateVal instanceof DateTime) {
    dt = dateVal.setZone(CARACAS_ZONE);
  } else if (dateVal instanceof Date) {
    dt = DateTime.fromJSDate(dateVal).setZone(CARACAS_ZONE);
  } else {
    dt = DateTime.fromISO(dateVal).setZone(CARACAS_ZONE);
    if (!dt.isValid) {
      dt = DateTime.fromSQL(dateVal).setZone(CARACAS_ZONE);
    }
  }
  return dt.isValid ? dt.toFormat('yyyy-MM-dd') : '';
}

/**
 * Formats a Date, string, or DateTime to Spanish format (DD-MM-YYYY or custom).
 */
export function formatDateES(dateVal: Date | string | DateTime, format = 'dd-MM-yyyy'): string {
  if (!dateVal) return '';
  let dt: DateTime;
  if (dateVal instanceof DateTime) {
    dt = dateVal.setZone(CARACAS_ZONE);
  } else if (dateVal instanceof Date) {
    dt = DateTime.fromJSDate(dateVal).setZone(CARACAS_ZONE);
  } else {
    dt = DateTime.fromISO(dateVal).setZone(CARACAS_ZONE);
    if (!dt.isValid) {
      const parsedDate = new Date(`${dateVal}T00:00:00`);
      dt = DateTime.fromJSDate(parsedDate).setZone(CARACAS_ZONE);
    }
  }
  return dt.isValid ? dt.toFormat(format) : '';
}

/**
 * Parses receipt/payment date string flexibly to a Luxon DateTime in America/Caracas timezone.
 */
export function parseDateToCaracas(dateStr: string | null | undefined, isZelle = false): DateTime {
  if (!dateStr) return DateTime.invalid('Empty date string');
  const raw = dateStr.trim();

  // Try ISO first (YYYY-MM-DD)
  let dt = DateTime.fromISO(raw, { zone: CARACAS_ZONE });

  // Zelle receipts use US format (MM/DD/YYYY or MM-DD-YYYY)
  if (!dt.isValid && isZelle) {
    dt = DateTime.fromFormat(raw, 'MM/dd/yyyy', { zone: CARACAS_ZONE });
    if (!dt.isValid) {
      dt = DateTime.fromFormat(raw, 'MM-dd-yyyy', { zone: CARACAS_ZONE });
    }
  }

  // DD/MM/YYYY
  if (!dt.isValid) {
    dt = DateTime.fromFormat(raw, 'dd/MM/yyyy', { zone: CARACAS_ZONE });
  }
  // DD-MM-YYYY
  if (!dt.isValid) {
    dt = DateTime.fromFormat(raw, 'dd-MM-yyyy', { zone: CARACAS_ZONE });
  }

  // Fallback for non-Zelle if it happens to be MM/DD/YYYY
  if (!dt.isValid && !isZelle) {
    dt = DateTime.fromFormat(raw, 'MM/dd/yyyy', { zone: CARACAS_ZONE });
    if (!dt.isValid) {
      dt = DateTime.fromFormat(raw, 'MM-dd-yyyy', { zone: CARACAS_ZONE });
    }
  }

  return dt;
}

/**
 * Safely parses birthDate string into a JS Date object at Caracas zone midnight.
 * This avoids off-by-one errors when converting standard YYYY-MM-DD input.
 */
export function parseBirthDate(birthDateStr: string | null | undefined): Date | undefined {
  if (!birthDateStr) return undefined;
  const dt = DateTime.fromISO(birthDateStr, { zone: CARACAS_ZONE }).startOf('day');
  return dt.isValid ? dt.toJSDate() : undefined;
}

/**
 * Calculates start of month as JS Date in America/Caracas.
 */
export function getStartOfMonth(dateVal?: Date | string | DateTime): Date {
  const dt = getCaracasDateTime(dateVal);
  return dt.startOf('month').toJSDate();
}

/**
 * Calculates end of month (last millisecond) as JS Date in America/Caracas.
 */
export function getEndOfMonth(dateVal?: Date | string | DateTime): Date {
  const dt = getCaracasDateTime(dateVal);
  return dt.endOf('month').toJSDate();
}

/**
 * Calculates due date (typically 5th of the month) as JS Date in America/Caracas.
 */
export function getDueDate(dateVal?: Date | string | DateTime, dueDay = 5): Date {
  const dt = getCaracasDateTime(dateVal);
  return dt.set({ day: dueDay }).startOf('day').toJSDate();
}

/**
 * Returns billingMonth (YYYY-MM) string according to day 25 cutoff logic in America/Caracas.
 */
export function getBillingMonth(dateVal?: Date | string | DateTime): string {
  const dt = getCaracasDateTime(dateVal);
  if (dt.day >= 25) {
    return dt.plus({ months: 1 }).toFormat('yyyy-MM');
  }
  return dt.toFormat('yyyy-MM');
}

/**
 * Converts Excel serial date to a Caracas timezone YYYY-MM-DD string.
 */
export function excelDateToDateString(serial: number): string | null {
  if (!serial || isNaN(serial)) return null;
  // Excel base date is Dec 30, 1899
  const utcMs = Math.round((serial - 25569) * 86400 * 1000);
  const dt = DateTime.fromMillis(utcMs, { zone: 'utc' });
  return dt.isValid ? dt.toFormat('yyyy-MM-dd') : null;
}

/**
 * Robust parsing of OCR date string (typically DD/MM/YYYY) to YYYY-MM-DD.
 */
export function parseOcrDateToISO(fechaStr: string | null | undefined): string {
  if (!fechaStr) return '';
  const cleaned = fechaStr.replace(/[-.]/g, '/').trim();
  const parts = cleaned.split('/');
  if (parts.length === 3) {
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    const fullYear = year.length === 2 ? `20${year}` : year;
    return `${fullYear}-${month}-${day}`;
  }
  return '';
}

/**
 * Helper to normalize any date input to a Caracas Luxon DateTime.
 */
export function getCaracasDateTime(dateVal?: Date | string | DateTime): DateTime {
  if (!dateVal) return getCaracasNow();
  if (dateVal instanceof DateTime) return dateVal.setZone(CARACAS_ZONE);
  if (dateVal instanceof Date) return DateTime.fromJSDate(dateVal).setZone(CARACAS_ZONE);
  return DateTime.fromISO(dateVal).setZone(CARACAS_ZONE);
}
