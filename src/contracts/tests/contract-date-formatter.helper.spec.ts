import {
  calculateContractExpirationDate,
  formatContractDate,
  formatContractPersonAge,
  getCalendarDateComponents,
  getContractPersonAge,
  getContractPersonAgeDetail,
} from '../helpers/contract-date-formatter.helper';

describe('contract-date-formatter.helper', () => {
  describe('calculateContractExpirationDate', () => {
    it('should calculate expiration date for June 28 (month 6) as May 31 of next year', () => {
      const expiration = calculateContractExpirationDate('2026-06-28');
      expect(expiration).toBe('2027-05-31');
    });

    it('should calculate expiration date for June 1 as May 31 of next year', () => {
      const expiration = calculateContractExpirationDate('2026-06-01');
      expect(expiration).toBe('2027-05-31');
    });

    it('should calculate expiration date for January 15 as December 31 of current year', () => {
      const expiration = calculateContractExpirationDate('2026-01-15');
      expect(expiration).toBe('2026-12-31');
    });

    it('should calculate expiration date for February 10 as January 31 of next year', () => {
      const expiration = calculateContractExpirationDate('2026-02-10');
      expect(expiration).toBe('2027-01-31');
    });

    it('should calculate expiration date for March in a non-leap year pointing to Feb 29 on leap year', () => {
      // 2023-03-15 + 1 year = 2024-03-15 -> - 1 month = Feb 2024 (leap year) -> 2024-02-29
      const expiration = calculateContractExpirationDate('2023-03-15');
      expect(expiration).toBe('2024-02-29');
    });

    it('should calculate expiration date for March in a leap year pointing to Feb 28 on non-leap year', () => {
      // 2024-03-15 + 1 year = 2025-03-15 -> - 1 month = Feb 2025 -> 2025-02-28
      const expiration = calculateContractExpirationDate('2024-03-15');
      expect(expiration).toBe('2025-02-28');
    });

    it('should calculate expiration date for December 31 as November 30 of next year', () => {
      const expiration = calculateContractExpirationDate('2026-12-31');
      expect(expiration).toBe('2027-11-30');
    });

    it('should work when passed a Date object', () => {
      const expiration = calculateContractExpirationDate(new Date('2026-06-28T12:00:00Z'));
      expect(expiration).toBe('2027-05-31');
    });
  });

  describe('formatContractDate', () => {
    it('should format date string to DD-MM-YYYY', () => {
      expect(formatContractDate('2026-06-28')).toBe('28-06-2026');
    });

    it('should return "-" if date is null or undefined', () => {
      expect(formatContractDate(null)).toBe('-');
      expect(formatContractDate(undefined)).toBe('-');
    });
  });

  describe('getContractPersonAge', () => {
    it('should return 0 if birthDate is missing', () => {
      expect(getContractPersonAge(null)).toBe(0);
    });

    it('should calculate positive age correctly', () => {
      const age = getContractPersonAge('2000-01-01');
      expect(age).toBeGreaterThan(20);
    });

    it('should calculate age with custom referenceDate', () => {
      const age = getContractPersonAge('2000-01-01', '2025-06-01');
      expect(age).toBe(25);
    });
  });

  describe('getContractPersonAgeDetail', () => {
    it('should return zeros and isMonthsOld false if birthDate is missing', () => {
      expect(getContractPersonAgeDetail(null)).toEqual({
        years: 0,
        months: 0,
        isMonthsOld: false,
      });
    });

    it('should identify a baby of 3 months', () => {
      const detail = getContractPersonAgeDetail('2026-06-15', '2026-09-30');
      expect(detail).toEqual({
        years: 0,
        months: 3,
        isMonthsOld: true,
      });
    });

    it('should identify a baby of 1 month', () => {
      const detail = getContractPersonAgeDetail('2026-08-15', '2026-09-30');
      expect(detail).toEqual({
        years: 0,
        months: 1,
        isMonthsOld: true,
      });
    });

    it('should identify a baby of less than 1 month as 0 months', () => {
      const detail = getContractPersonAgeDetail('2026-09-20', '2026-09-30');
      expect(detail).toEqual({
        years: 0,
        months: 0,
        isMonthsOld: true,
      });
    });

    it('should identify an adult of 25 years as not months-old', () => {
      const detail = getContractPersonAgeDetail('2001-01-01', '2026-09-30');
      expect(detail.years).toBe(25);
      expect(detail.isMonthsOld).toBe(false);
    });
  });

  describe('formatContractPersonAge', () => {
    it('should return "-" if birthDate is missing', () => {
      expect(formatContractPersonAge(null)).toBe('-');
      expect(formatContractPersonAge(undefined)).toBe('-');
    });

    it('should format months for baby with plural MESES', () => {
      const formatted = formatContractPersonAge('2026-06-15', {
        referenceDate: '2026-09-30',
        withUnitForYears: false,
      });
      expect(formatted).toBe('3 MESES');
    });

    it('should format months for baby with plural MESES even if withUnitForYears is true', () => {
      const formatted = formatContractPersonAge('2026-06-15', {
        referenceDate: '2026-09-30',
        withUnitForYears: true,
      });
      expect(formatted).toBe('3 MESES');
    });

    it('should format 1 month with singular MES', () => {
      const formatted = formatContractPersonAge('2026-08-15', {
        referenceDate: '2026-09-30',
        withUnitForYears: false,
      });
      expect(formatted).toBe('1 MES');
    });

    it('should format 0 months as 0 MESES', () => {
      const formatted = formatContractPersonAge('2026-09-20', {
        referenceDate: '2026-09-30',
        withUnitForYears: false,
      });
      expect(formatted).toBe('0 MESES');
    });

    it('should format 1 year old as "1" without unit and "1 AÑO" with unit', () => {
      expect(
        formatContractPersonAge('2025-09-15', {
          referenceDate: '2026-09-30',
          withUnitForYears: false,
        }),
      ).toBe('1');
      expect(
        formatContractPersonAge('2025-09-15', {
          referenceDate: '2026-09-30',
          withUnitForYears: true,
        }),
      ).toBe('1 AÑO');
    });

    it('should format adult years without unit as number string', () => {
      const formatted = formatContractPersonAge('2001-01-01', {
        referenceDate: '2026-09-30',
        withUnitForYears: false,
      });
      expect(formatted).toBe('25');
    });

    it('should format adult years with unit as "X AÑOS"', () => {
      const formatted = formatContractPersonAge('2001-01-01', {
        referenceDate: '2026-09-30',
        withUnitForYears: true,
      });
      expect(formatted).toBe('25 AÑOS');
    });

    it('should default withUnitForYears to true when options or withUnitForYears not specified', () => {
      const formatted = formatContractPersonAge('2001-01-01', {
        referenceDate: '2026-09-30',
      });
      expect(formatted).toBe('25 AÑOS');
    });
  });

  describe('getCalendarDateComponents', () => {
    it('should parse YYYY-MM-DD string correctly', () => {
      const components = getCalendarDateComponents('2026-06-28');
      expect(components).toEqual({
        day: 28,
        monthIndex: 5,
        year: 2026,
      });
    });
  });
});
