import { BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AffiliatePersonDto } from '../dto/affiliate-person.dto';
import { RenewContractDto } from '../dto/renew-contract.dto';
import { PersonRole } from '../entities/contract-person.entity';
import { TypeIdentityCard } from '../../persons/entities/person.entity';
import { validateContractAffiliates } from '../helpers/contract-validator.helper';

describe('validateContractAffiliates & DTO Validations', () => {
  describe('validateContractAffiliates', () => {
    it('should pass when titular has no planId and does not provide birthDate, weight, or height', () => {
      const affiliates: AffiliatePersonDto[] = [
        {
          typeIdentityCard: TypeIdentityCard.V,
          identityCard: '12345678',
          name: 'Titular Sin Plan',
          role: PersonRole.TITULAR,
          isBillingOwner: true,
        },
      ];

      expect(() => validateContractAffiliates(affiliates)).not.toThrow();
    });

    it('should pass when affiliate has planId and valid birthDate, weight, and height', () => {
      const affiliates: AffiliatePersonDto[] = [
        {
          typeIdentityCard: TypeIdentityCard.V,
          identityCard: '12345678',
          name: 'Afiliado Con Plan',
          role: PersonRole.AFILIADO,
          planId: 'plan-uuid-1',
          birthDate: '1995-05-15',
          weight: 70,
          height: 1.75,
        },
      ];

      expect(() => validateContractAffiliates(affiliates)).not.toThrow();
    });

    it('should throw BadRequestException when affiliate has planId but missing birthDate', () => {
      const affiliates: AffiliatePersonDto[] = [
        {
          typeIdentityCard: TypeIdentityCard.V,
          identityCard: '12345678',
          name: 'Afiliado Sin Fecha',
          role: PersonRole.AFILIADO,
          planId: 'plan-uuid-1',
          weight: 70,
          height: 1.75,
        },
      ];

      expect(() => validateContractAffiliates(affiliates)).toThrow(BadRequestException);
      expect(() => validateContractAffiliates(affiliates)).toThrow(
        /fecha de nacimiento es obligatoria/,
      );
    });

    it('should throw BadRequestException when affiliate has planId but missing weight', () => {
      const affiliates: AffiliatePersonDto[] = [
        {
          typeIdentityCard: TypeIdentityCard.V,
          identityCard: '12345678',
          name: 'Afiliado Sin Peso',
          role: PersonRole.AFILIADO,
          planId: 'plan-uuid-1',
          birthDate: '1995-05-15',
          height: 1.75,
        },
      ];

      expect(() => validateContractAffiliates(affiliates)).toThrow(BadRequestException);
      expect(() => validateContractAffiliates(affiliates)).toThrow(/peso es obligatorio/);
    });

    it('should throw BadRequestException when affiliate has planId but missing height', () => {
      const affiliates: AffiliatePersonDto[] = [
        {
          typeIdentityCard: TypeIdentityCard.V,
          identityCard: '12345678',
          name: 'Afiliado Sin Talla',
          role: PersonRole.AFILIADO,
          planId: 'plan-uuid-1',
          birthDate: '1995-05-15',
          weight: 70,
        },
      ];

      expect(() => validateContractAffiliates(affiliates)).toThrow(BadRequestException);
      expect(() => validateContractAffiliates(affiliates)).toThrow(/talla es obligatoria/);
    });

    it('should throw BadRequestException when affiliate has role AFILIADO but no planId', () => {
      const affiliates: AffiliatePersonDto[] = [
        {
          typeIdentityCard: TypeIdentityCard.V,
          identityCard: '12345678',
          name: 'Afiliado Sin Plan',
          role: PersonRole.AFILIADO,
        },
      ];

      expect(() => validateContractAffiliates(affiliates)).toThrow(BadRequestException);
      expect(() => validateContractAffiliates(affiliates)).toThrow(/debe tener un plan asignado/);
    });
  });

  describe('AffiliatePersonDto class-validator decorators', () => {
    it('should validate successfully when titular has no plan and no optional fields', async () => {
      const dto = plainToInstance(AffiliatePersonDto, {
        typeIdentityCard: TypeIdentityCard.V,
        identityCard: '12345678',
        name: 'Titular Valido',
        role: PersonRole.TITULAR,
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail validation when planId is present but birthDate, weight, and height are missing', async () => {
      const dto = plainToInstance(AffiliatePersonDto, {
        typeIdentityCard: TypeIdentityCard.V,
        identityCard: '12345678',
        name: 'Afiliado Incompleto',
        role: PersonRole.AFILIADO,
        planId: '123e4567-e89b-12d3-a456-426614174000',
      });

      const errors = await validate(dto);
      const propertyNames = errors.map((e) => e.property);
      expect(propertyNames).toContain('birthDate');
      expect(propertyNames).toContain('weight');
      expect(propertyNames).toContain('height');
    });
  });

  describe('RenewContractDto class-validator decorators', () => {
    it('should validate successfully with valid startDate and expirationDate', async () => {
      const dto = plainToInstance(RenewContractDto, {
        startDate: '2026-09-01',
        expirationDate: '2027-09-01',
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail when startDate is missing', async () => {
      const dto = plainToInstance(RenewContractDto, {});

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'startDate')).toBe(true);
    });
  });
});
