import { DateTime } from 'luxon';
import {
  getCaracasNow,
  getCaracasTodayJSDate,
  formatToISODateString,
  formatDateES,
  parseDateToCaracas,
  parseBirthDate,
  getStartOfMonth,
  getEndOfMonth,
  getDueDate,
  getBillingMonth,
  excelDateToDateString,
  parseOcrDateToISO,
} from './date.util';

describe('Date Utilities', () => {
  it('should get current time in Caracas zone', () => {
    const now = getCaracasNow();
    expect(now.zoneName).toBe('America/Caracas');
  });

  it('should get JS Date in Caracas zone', () => {
    const jsDate = getCaracasTodayJSDate();
    expect(jsDate).toBeInstanceOf(Date);
  });

  it('should format date to ISO YYYY-MM-DD', () => {
    const jsDate = new Date('2026-07-03T12:00:00Z');
    // If converted to Caracas timezone, 2026-07-03T12:00:00Z is 2026-07-03T08:00:00-04:00
    expect(formatToISODateString(jsDate)).toBe('2026-07-03');
    expect(formatToISODateString('2026-07-03')).toBe('2026-07-03');
  });

  it('should format date to Spanish formats', () => {
    const jsDate = new Date('2026-07-03T12:00:00Z');
    expect(formatDateES(jsDate)).toBe('03-07-2026');
    expect(formatDateES(jsDate, 'dd/MM/yyyy')).toBe('03/07/2026');
  });

  it('should parse receipt dates flexibly', () => {
    // ISO
    let dt = parseDateToCaracas('2026-07-03');
    expect(dt.isValid).toBe(true);
    expect(dt.toFormat('yyyy-MM-dd')).toBe('2026-07-03');

    // Zelle US format
    dt = parseDateToCaracas('07/03/2026', true);
    expect(dt.isValid).toBe(true);
    expect(dt.toFormat('yyyy-MM-dd')).toBe('2026-07-03');

    // standard DD/MM/YYYY
    dt = parseDateToCaracas('03/07/2026');
    expect(dt.isValid).toBe(true);
    expect(dt.toFormat('yyyy-MM-dd')).toBe('2026-07-03');

    // standard DD-MM-YYYY
    dt = parseDateToCaracas('03-07-2026');
    expect(dt.isValid).toBe(true);
    expect(dt.toFormat('yyyy-MM-dd')).toBe('2026-07-03');
  });

  it('should parse birth dates without day shifting', () => {
    const birth = parseBirthDate('1990-01-01');
    expect(birth).toBeInstanceOf(Date);
    // When formatting to ISO date, it should match 1990-01-01
    expect(DateTime.fromJSDate(birth!).setZone('America/Caracas').toFormat('yyyy-MM-dd')).toBe(
      '1990-01-01',
    );
  });

  it('should compute start and end of month', () => {
    const start = getStartOfMonth('2026-07-15');
    const end = getEndOfMonth('2026-07-15');

    expect(formatToISODateString(start)).toBe('2026-07-01');
    expect(formatToISODateString(end)).toBe('2026-07-31');
  });

  it('should compute due date', () => {
    const due = getDueDate('2026-07-15');
    expect(formatToISODateString(due)).toBe('2026-07-05');
  });

  it('should compute billing month with day 25 cutoff logic', () => {
    expect(getBillingMonth('2026-07-24')).toBe('2026-07');
    expect(getBillingMonth('2026-07-25')).toBe('2026-08');
  });

  it('should convert Excel serial dates safely', () => {
    // 45292 is Excel serial for 2024-01-01
    expect(excelDateToDateString(45292)).toBe('2024-01-01');
  });

  it('should parse OCR dates safely', () => {
    expect(parseOcrDateToISO('10/10/2023')).toBe('2023-10-10');
    expect(parseOcrDateToISO('10-10-23')).toBe('2023-10-10');
  });
});
