import {
  calculateContractExpirationDate,
  formatContractDate,
  getCalendarDateComponents,
  getContractPersonAge,
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
