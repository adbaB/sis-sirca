import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Cie10Service } from './cie10.service';
import { Cie10Code } from './entities/cie10-code.entity';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

describe('Cie10Service', () => {
  type MockFn = Mock<(...args: unknown[]) => unknown>;

  type MockQueryBuilder = {
    where: MockFn;
    andWhere: MockFn;
    orderBy: MockFn;
    addOrderBy: MockFn;
    setParameter: MockFn;
    take: MockFn;
    getMany: MockFn;
    insert: MockFn;
    into: MockFn;
    values: MockFn;
    orUpdate: MockFn;
    execute: MockFn;
  };

  let service: Cie10Service;
  let mockRepo: {
    count: MockFn;
    findOne: MockFn;
    createQueryBuilder: Mock<() => MockQueryBuilder>;
  };

  const sampleCodes: Cie10Code[] = [
    {
      code: 'A00',
      cleanCode: 'A00',
      description: 'Cólera',
      chapter: 'Ciertas enfermedades infecciosas y parasitarias',
      block: 'Enfermedades infecciosas intestinales',
      category: 'A00',
      level: 'category',
      isTerminal: false,
      metadata: {
        inclusions: ['infección por Vibrio cholerae'],
      },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      code: 'A00.0',
      cleanCode: 'A000',
      description: 'Cólera debido a Vibrio cholerae O1, biotipo cholerae',
      chapter: 'Ciertas enfermedades infecciosas y parasitarias',
      block: 'Enfermedades infecciosas intestinales',
      category: 'A00',
      level: 'subcategory',
      isTerminal: true,
      metadata: {
        inclusions: ['Cólera clásico'],
      },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      code: 'A00.1',
      cleanCode: 'A001',
      description: 'Cólera debido a Vibrio cholerae O1, biotipo El Tor',
      chapter: 'Ciertas enfermedades infecciosas y parasitarias',
      block: 'Enfermedades infecciosas intestinales',
      category: 'A00',
      level: 'subcategory',
      isTerminal: true,
      metadata: {
        inclusions: ['Cólera El Tor'],
      },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  beforeEach(async () => {
    const qb: MockQueryBuilder = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      addOrderBy: vi.fn().mockReturnThis(),
      setParameter: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockImplementation(() => {
        // Simular retorno
        return Promise.resolve(sampleCodes.filter((c) => c.isTerminal));
      }),
      insert: vi.fn().mockReturnThis(),
      into: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      orUpdate: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue({}),
    };

    mockRepo = {
      count: vi.fn().mockResolvedValue(11286),
      findOne: vi.fn().mockImplementation(({ where }) => {
        if (Array.isArray(where)) {
          const match = sampleCodes.find(
            (c) => c.code === where[0]?.code || c.cleanCode === where[1]?.cleanCode,
          );
          return Promise.resolve(match || null);
        }
        if (where.code) {
          return Promise.resolve(sampleCodes.find((c) => c.code === where.code) || null);
        }
        return Promise.resolve(null);
      }),
      createQueryBuilder: vi.fn().mockReturnValue(qb),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Cie10Service,
        {
          provide: getRepositoryToken(Cie10Code),
          useValue: mockRepo,
        },
      ],
    }).compile();

    service = module.get<Cie10Service>(Cie10Service);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('search', () => {
    it('should search with default onlyTerminal = true', async () => {
      const results = await service.search('cólera', 10);
      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.isTerminal)).toBe(true);
    });

    it('should search allowing all levels when onlyTerminal = false', async () => {
      await service.search('cólera', 10, false);
      const qb = mockRepo.createQueryBuilder();
      // Verificamos que no filtre por isTerminal
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('cie.code ILIKE :q'),
        expect.any(Object),
      );
    });
  });

  describe('findOne', () => {
    it('should find code by official code with dot', async () => {
      const result = await service.findOne('A00.0');
      expect(result).toBeDefined();
      expect(result?.code).toBe('A00.0');
    });

    it('should find code by clean code without dot', async () => {
      const result = await service.findOne('A000');
      expect(result).toBeDefined();
      expect(result?.code).toBe('A00.0');
    });

    it('should return null for non-existent code', async () => {
      const result = await service.findOne('ZZZ99');
      expect(result).toBeNull();
    });
  });
});
