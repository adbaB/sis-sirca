import { EntityManager } from 'typeorm';
import { generateClaimNumber } from './claim-number-generator.helper';
import { SystemCounter } from '../../common/entities/system-counter.entity';
import { DateTime } from 'luxon';
import { CARACAS_ZONE } from '../../common/utils/date.util';

describe('generateClaimNumber', () => {
  it('should generate purely numeric claim numbers without letters or hyphens', async () => {
    const mockCounter: SystemCounter = {
      key: 'claim_number',
      value: 1,
    };

    const counterRepo = {
      findOne: jest.fn().mockResolvedValue(mockCounter),
      create: jest.fn().mockReturnValue(mockCounter),
      save: jest.fn().mockImplementation(async (c) => c),
    };

    const mockManager = {
      getRepository: jest.fn().mockImplementation((entity) => {
        if (entity === SystemCounter) {
          return counterRepo;
        }
        return {};
      }),
    } as unknown as EntityManager;

    const currentYear = DateTime.now().setZone(CARACAS_ZONE).year;
    const result = await generateClaimNumber(mockManager);

    // 1. Debe ser estrictamente numérico (solo dígitos 0-9)
    expect(result.claimNumber).toMatch(/^\d+$/);

    // 2. NO debe contener guiones ni letras
    expect(result.claimNumber).not.toContain('-');
    expect(result.claimNumber).not.toMatch(/[a-zA-Z]/);

    // 3. Formato esperado: YYYY + 000001
    expect(result.claimNumber).toBe(`${currentYear}000001`);
    expect(result.serial).toBe(1);
    expect(result.year).toBe(currentYear);

    // 4. Debe incrementar el contador en base de datos
    expect(mockCounter.value).toBe(2);
    expect(counterRepo.save).toHaveBeenCalledWith(mockCounter);
  });

  it('should initialize counter to 1 if not present in system_counters', async () => {
    let createdCounter: SystemCounter | null = null;

    const counterRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((dto) => {
        createdCounter = { ...dto };
        return createdCounter;
      }),
      save: jest.fn().mockImplementation(async (c) => c),
    };

    const mockManager = {
      getRepository: jest.fn().mockImplementation((entity) => {
        if (entity === SystemCounter) {
          return counterRepo;
        }
        return {};
      }),
    } as unknown as EntityManager;

    const currentYear = DateTime.now().setZone(CARACAS_ZONE).year;
    const result = await generateClaimNumber(mockManager);

    expect(result.claimNumber).toBe(`${currentYear}000001`);
    expect(result.claimNumber).toMatch(/^\d+$/);
    expect(counterRepo.create).toHaveBeenCalledWith({ key: 'claim_number', value: 1 });
    expect(counterRepo.save).toHaveBeenCalled();
  });
});
