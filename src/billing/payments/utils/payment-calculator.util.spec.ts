import { BadRequestException } from '@nestjs/common';
import { validateAmounts, resolveAmountUsd, computePaymentSplit } from './payment-calculator.util';
import { CreatePaymentDto } from '../dto/create-payment.dto';

describe('payment-calculator.util', () => {
  describe('validateAmounts', () => {
    it('should throw BadRequestException if Zelle amount is invalid or zero', () => {
      const dto: Partial<CreatePaymentDto> = {
        paymentMethod: 'zelle',
        amount: 0,
      };

      expect(() => validateAmounts(dto as CreatePaymentDto, 0, 0)).toThrow(BadRequestException);
    });

    it('should pass if Zelle amount is valid', () => {
      const dto: Partial<CreatePaymentDto> = {
        paymentMethod: 'zelle',
        amount: 100,
      };

      expect(() => validateAmounts(dto as CreatePaymentDto, 100, 0)).not.toThrow();
    });

    it('should throw BadRequestException if non-Zelle Bs amount is invalid or zero', () => {
      const dto: Partial<CreatePaymentDto> = {
        paymentMethod: 'pago_movil',
        amountExtracted: 0,
      };

      expect(() => validateAmounts(dto as CreatePaymentDto, 0, 0)).toThrow(BadRequestException);
    });

    it('should pass if non-Zelle Bs amount is valid', () => {
      const dto: Partial<CreatePaymentDto> = {
        paymentMethod: 'pago_movil',
        amountExtracted: 500,
      };

      expect(() => validateAmounts(dto as CreatePaymentDto, 0, 500)).not.toThrow();
    });
  });

  describe('resolveAmountUsd', () => {
    it('should return raw amount for Zelle', () => {
      const dto: Partial<CreatePaymentDto> = { paymentMethod: 'zelle' };
      expect(resolveAmountUsd(dto as CreatePaymentDto, 150, 40)).toBe(150);
    });

    it('should calculate USD from extracted Bs amount for non-Zelle', () => {
      const dto: Partial<CreatePaymentDto> = {
        paymentMethod: 'pago_movil',
        amountExtracted: 2000,
      };
      expect(resolveAmountUsd(dto as CreatePaymentDto, 0, 40)).toBe(50);
    });
  });

  describe('computePaymentSplit', () => {
    it('should handle exact payment without surplus for Zelle', () => {
      const split = computePaymentSplit(100, 100, 0, 'zelle', 40);
      expect(split.paymentAmountUsd).toBe(100);
      expect(split.paymentAmountBs).toBe(0);
      expect(split.surplusAmountUsd).toBeNull();
      expect(split.surplusAmountBs).toBeNull();
    });

    it('should calculate surplus for Zelle when amount exceeds unpaid balance', () => {
      const split = computePaymentSplit(150, 100, 0, 'zelle', 40);
      expect(split.paymentAmountUsd).toBe(100);
      expect(split.paymentAmountBs).toBe(0);
      expect(split.surplusAmountUsd).toBe(50);
      expect(split.surplusAmountBs).toBeNull();
    });

    it('should calculate surplus in Bs for non-Zelle when amount exceeds unpaid balance', () => {
      // Amount extracted = 6000 Bs, rate = 40 => 150 USD total. Unpaid invoice = 100 USD.
      // Surplus = 50 USD = 2000 Bs.
      const split = computePaymentSplit(150, 100, 6000, 'pago_movil', 40);
      expect(split.paymentAmountUsd).toBe(100);
      expect(split.paymentAmountBs).toBe(4000);
      expect(split.surplusAmountUsd).toBeNull();
      expect(split.surplusAmountBs).toBe(2000);
    });
  });
});
