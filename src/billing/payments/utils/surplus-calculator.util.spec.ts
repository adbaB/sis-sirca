import { BadRequestException } from '@nestjs/common';
import { calculateSurplusApplication } from './surplus-calculator.util';

describe('surplus-calculator.util', () => {
  it('should return zeros when surplus amounts are empty', () => {
    const result = calculateSurplusApplication(null, null, 100);
    expect(result.amountToApplyUsd).toBe(0);
    expect(result.hasLeftover).toBe(false);
  });

  it('should throw BadRequestException if Bs surplus needs exchange rate and rate is missing', () => {
    expect(() => calculateSurplusApplication(null, 1000, 100)).toThrow(BadRequestException);
  });

  it('should apply full USD surplus when it is smaller than invoice balance', () => {
    const result = calculateSurplusApplication(50, null, 100);
    expect(result.amountToApplyUsd).toBe(50);
    expect(result.amountToApplyBs).toBe(0);
    expect(result.hasLeftover).toBe(false);
    expect(result.leftoverUsd).toBeNull();
  });

  it('should cap USD surplus and calculate leftover when surplus exceeds invoice balance', () => {
    const result = calculateSurplusApplication(150, null, 100);
    expect(result.amountToApplyUsd).toBe(100);
    expect(result.hasLeftover).toBe(true);
    expect(result.leftoverUsd).toBe(50);
  });

  it('should convert Bs surplus using rate and calculate proportional application and leftover', () => {
    // 4000 Bs with rate = 40 => 100 USD total surplus.
    // Invoice balance = 50 USD.
    // Amount to apply = 50 USD, 2000 Bs. Leftover = 50 USD, 2000 Bs.
    const result = calculateSurplusApplication(null, 4000, 50, 40);
    expect(result.paymentAmountUsd).toBe(100);
    expect(result.amountToApplyUsd).toBe(50);
    expect(result.amountToApplyBs).toBe(2000);
    expect(result.hasLeftover).toBe(true);
    expect(result.leftoverBs).toBe(2000);
  });
});
