import { describe, expect, it } from 'vitest';
import { normalizeWhatsappPhone } from './phone.util';

describe('normalizeWhatsappPhone', () => {
  it('should return null for empty, null, or undefined values', () => {
    expect(normalizeWhatsappPhone('')).toBeNull();
    expect(normalizeWhatsappPhone(null)).toBeNull();
    expect(normalizeWhatsappPhone(undefined)).toBeNull();
    expect(normalizeWhatsappPhone('   ')).toBeNull();
  });

  it('should normalize standard Venezuelan mobile numbers with leading 0 (11 digits)', () => {
    expect(normalizeWhatsappPhone('04141234567')).toBe('584141234567');
    expect(normalizeWhatsappPhone('04241234567')).toBe('584241234567');
    expect(normalizeWhatsappPhone('04121234567')).toBe('584121234567');
    expect(normalizeWhatsappPhone('04221234567')).toBe('584221234567');
    expect(normalizeWhatsappPhone('04161234567')).toBe('584161234567');
    expect(normalizeWhatsappPhone('04261234567')).toBe('584261234567');
  });

  it('should normalize Venezuelan numbers with spaces, hyphens, and parenthesis', () => {
    expect(normalizeWhatsappPhone('0414-123-4567')).toBe('584141234567');
    expect(normalizeWhatsappPhone('(0412) 123 4567')).toBe('584121234567');
    expect(normalizeWhatsappPhone('+58 424 123 4567')).toBe('584241234567');
    expect(normalizeWhatsappPhone('+58-414-123.4567')).toBe('584141234567');
    expect(normalizeWhatsappPhone('+58 422 650 7898')).toBe('584226507898');
  });

  it('should normalize Venezuelan numbers without leading 0 (10 digits)', () => {
    expect(normalizeWhatsappPhone('4141234567')).toBe('584141234567');
    expect(normalizeWhatsappPhone('4241234567')).toBe('584241234567');
    expect(normalizeWhatsappPhone('4121234567')).toBe('584121234567');
    expect(normalizeWhatsappPhone('4221234567')).toBe('584221234567');
    expect(normalizeWhatsappPhone('4161234567')).toBe('584161234567');
    expect(normalizeWhatsappPhone('4261234567')).toBe('584261234567');
  });

  it('should handle already international formatted Venezuelan numbers', () => {
    expect(normalizeWhatsappPhone('+584141234567')).toBe('584141234567');
    expect(normalizeWhatsappPhone('584141234567')).toBe('584141234567');
    expect(normalizeWhatsappPhone('+584226507898')).toBe('584226507898');
  });

  it('should handle international numbers of valid length (10-15 digits)', () => {
    expect(normalizeWhatsappPhone('+15551234567')).toBe('15551234567');
    expect(normalizeWhatsappPhone('+573001234567')).toBe('573001234567');
  });

  it('should remove international dialing prefix 00', () => {
    expect(normalizeWhatsappPhone('00584141234567')).toBe('584141234567');
    expect(normalizeWhatsappPhone('0015551234567')).toBe('15551234567');
  });

  it('should return null for too short or too long phone numbers', () => {
    expect(normalizeWhatsappPhone('12345')).toBeNull();
    expect(normalizeWhatsappPhone('1234567890123456789')).toBeNull();
    expect(normalizeWhatsappPhone('abc')).toBeNull();
  });
});
