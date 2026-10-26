import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  ContractCoveragePeriod,
  CoveragePeriodStatus,
} from '../entities/contract-coverage-period.entity';
import { ContractPerson } from '../entities/contract-person.entity';
import { CoveragePeriodService } from './coverage-period.service';

describe('CoveragePeriodService', () => {
  let service: CoveragePeriodService;
  let periodRepo: jest.Mocked<Repository<ContractCoveragePeriod>>;
  let cpRepo: jest.Mocked<Repository<ContractPerson>>;

  const mockContractPerson = {
    id: 'cp-1',
    contract: {
      id: 'contract-1',
      startDate: new Date('2026-01-01'),
      expirationDate: new Date('2027-01-01'),
    },
    plan: {
      id: 'plan-1',
      coverage: 5000,
    },
  } as unknown as ContractPerson;

  beforeEach(async () => {
    const mockPeriodRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation(async (entity) => ({
        id: entity.id || 'period-1',
        ...entity,
      })),
      update: jest.fn(),
    };

    const mockCpRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
    };

    const mockManager = {
      getRepository: jest.fn().mockImplementation((entity) => {
        if (entity === ContractCoveragePeriod) return mockPeriodRepo;
        if (entity === ContractPerson) return mockCpRepo;
        return {};
      }),
    };

    const mockQr = {
      isTransactionActive: false,
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: mockManager,
    };

    const mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQr),
      manager: mockManager,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoveragePeriodService,
        {
          provide: getRepositoryToken(ContractCoveragePeriod),
          useValue: mockPeriodRepo,
        },
        {
          provide: getRepositoryToken(ContractPerson),
          useValue: mockCpRepo,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<CoveragePeriodService>(CoveragePeriodService);
    periodRepo = mockPeriodRepo as unknown as jest.Mocked<Repository<ContractCoveragePeriod>>;
    cpRepo = mockCpRepo as unknown as jest.Mocked<Repository<ContractPerson>>;
  });

  describe('getOrCreateActivePeriod', () => {
    it('should return existing active period if present', async () => {
      const existingPeriod = {
        id: 'period-1',
        contractId: 'contract-1',
        status: CoveragePeriodStatus.ACTIVE,
        initialCoverage: 5000,
        remainingCoverage: 5000,
        reservedCoverage: 0,
        consumedCoverage: 0,
      } as ContractCoveragePeriod;

      periodRepo.findOne.mockResolvedValue(existingPeriod);

      const result = await service.getOrCreateActivePeriod('cp-1');
      expect(result).toBe(existingPeriod);
      expect(periodRepo.save).not.toHaveBeenCalled();
    });

    it('should create new active period if none exists', async () => {
      periodRepo.findOne.mockResolvedValue(null);
      cpRepo.findOne.mockResolvedValue(mockContractPerson);

      const result = await service.getOrCreateActivePeriod('cp-1');
      expect(result.initialCoverage).toBe(5000);
      expect(result.remainingCoverage).toBe(5000);
      expect(result.reservedCoverage).toBe(0);
      expect(result.status).toBe(CoveragePeriodStatus.ACTIVE);
      expect(periodRepo.save).toHaveBeenCalled();
    });

    it('should throw NotFoundException if contractPerson does not exist', async () => {
      periodRepo.findOne.mockResolvedValue(null);
      cpRepo.findOne.mockResolvedValue(null);

      await expect(service.getOrCreateActivePeriod('invalid-cp')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('lockCoverageAmount', () => {
    it('should successfully lock coverage when sufficient remaining coverage', async () => {
      const activePeriod = {
        id: 'period-1',
        initialCoverage: 5000,
        remainingCoverage: 5000,
        reservedCoverage: 0,
        consumedCoverage: 0,
        status: CoveragePeriodStatus.ACTIVE,
      } as ContractCoveragePeriod;

      periodRepo.findOne.mockResolvedValue(activePeriod);

      const result = await service.lockCoverageAmount('period-1', 500);
      expect(result.reservedCoverage).toBe(500);
      expect(result.remainingCoverage).toBe(4500);
      expect(periodRepo.save).toHaveBeenCalled();
    });

    it('should throw BadRequestException when remaining coverage is insufficient', async () => {
      const activePeriod = {
        id: 'period-1',
        initialCoverage: 1000,
        remainingCoverage: 200,
        reservedCoverage: 0,
        consumedCoverage: 800,
        status: CoveragePeriodStatus.ACTIVE,
      } as ContractCoveragePeriod;

      periodRepo.findOne.mockResolvedValue(activePeriod);

      await expect(service.lockCoverageAmount('period-1', 500)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('updateLockedCoverageAmount', () => {
    it('should increase lock amount and adjust remaining coverage', async () => {
      const period = {
        id: 'period-1',
        initialCoverage: 5000,
        remainingCoverage: 4500,
        reservedCoverage: 500,
        consumedCoverage: 0,
      } as ContractCoveragePeriod;

      periodRepo.findOne.mockResolvedValue(period);

      const result = await service.updateLockedCoverageAmount('period-1', 500, 800);
      expect(result.reservedCoverage).toBe(800);
      expect(result.remainingCoverage).toBe(4200);
    });

    it('should throw if delta exceeds remaining coverage', async () => {
      const period = {
        id: 'period-1',
        initialCoverage: 5000,
        remainingCoverage: 200,
        reservedCoverage: 500,
        consumedCoverage: 4300,
      } as ContractCoveragePeriod;

      periodRepo.findOne.mockResolvedValue(period);

      await expect(service.updateLockedCoverageAmount('period-1', 500, 1000)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('releaseAndDeductCoverage', () => {
    it('should release reserved coverage and increase consumed coverage', async () => {
      const period = {
        id: 'period-1',
        initialCoverage: 5000,
        remainingCoverage: 4000,
        reservedCoverage: 1000,
        consumedCoverage: 0,
      } as ContractCoveragePeriod;

      periodRepo.findOne.mockResolvedValue(period);

      const result = await service.releaseAndDeductCoverage('period-1', 1000, 950);
      expect(result.reservedCoverage).toBe(0);
      expect(result.consumedCoverage).toBe(950);
      expect(result.remainingCoverage).toBe(4050);
    });
  });

  describe('closeCurrentAndOpenNewPeriod', () => {
    it('should close current period and open new active period with 100% initial coverage', async () => {
      const currentPeriod = {
        id: 'period-1',
        contractId: 'contract-1',
        contractPersonId: 'cp-1',
        periodNumber: 1,
        status: CoveragePeriodStatus.ACTIVE,
        initialCoverage: 5000,
      } as ContractCoveragePeriod;

      periodRepo.find.mockResolvedValue([currentPeriod]);
      cpRepo.findOne.mockResolvedValue(mockContractPerson);

      await service.closeCurrentAndOpenNewPeriod(
        'contract-1',
        new Date('2027-01-01'),
        new Date('2028-01-01'),
      );

      expect(periodRepo.save).toHaveBeenCalledTimes(2);
      expect(currentPeriod.status).toBe(CoveragePeriodStatus.CLOSED);
    });

    it('should create new coverage periods for affiliates when renewing a contract that had no previous active coverage periods', async () => {
      periodRepo.find.mockResolvedValue([]);
      cpRepo.find.mockResolvedValue([
        {
          id: 'cp-affiliate-1',
          role: 'AFILIADO',
          plan: { id: 'plan-1', coverage: 3000 },
        } as unknown as ContractPerson,
        {
          id: 'cp-affiliate-2',
          role: 'AFILIADO',
          plan: { id: 'plan-2', coverage: 5000 },
        } as unknown as ContractPerson,
      ]);
      periodRepo.findOne.mockResolvedValue(null);

      await service.closeCurrentAndOpenNewPeriod(
        'contract-1',
        new Date('2027-01-01'),
        new Date('2028-01-01'),
      );

      expect(periodRepo.save).toHaveBeenCalledTimes(2);
      expect(periodRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'contract-1',
          contractPersonId: 'cp-affiliate-1',
          periodNumber: 1,
          initialCoverage: 3000,
          remainingCoverage: 3000,
          status: CoveragePeriodStatus.ACTIVE,
        }),
      );
      expect(periodRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'contract-1',
          contractPersonId: 'cp-affiliate-2',
          periodNumber: 1,
          initialCoverage: 5000,
          remainingCoverage: 5000,
          status: CoveragePeriodStatus.ACTIVE,
        }),
      );
    });
  });
});
