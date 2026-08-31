import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Advisor } from '../../advisors/entities/advisor.entity';
import { InvoiceService } from '../../billing/invoices/services/invoice.service';
import { SystemCounter } from '../../common/entities/system-counter.entity';
import { Person, TypeIdentityCard } from '../../persons/entities/person.entity';
import { PlansService } from '../../plans/services/plans.service';
import { CreateContractFullDto } from '../dto/create-contract-full.dto';
import { CreateContractDto } from '../dto/create-contract.dto';
import { AffiliationHistory } from '../entities/affiliation-history.entity';
import { ContractPerson, PersonRole } from '../entities/contract-person.entity';
import { Contract, ContractStatus } from '../entities/contract.entity';
import { HealthDeclaration } from '../entities/health-declaration.entity';
import { ContractAffiliationService } from '../services/contract-affiliation.service';
import { ContractCreationService } from '../services/contract-creation.service';
import { ContractPdfService } from '../services/contract-pdf.service';

describe('ContractCreationService', () => {
  let service: ContractCreationService;
  let contractsRepository: jest.Mocked<Repository<Contract>>;
  let invoiceService: jest.Mocked<InvoiceService>;
  let affiliationService: jest.Mocked<ContractAffiliationService>;
  let contractPdfService: jest.Mocked<ContractPdfService>;

  const mockAdvisor = { id: 'adv-1', code: '001', name: 'Asesor Test' } as Advisor;
  const mockContract: Contract = {
    id: 'contract-1',
    code: 'SIR-001-00001',
    status: ContractStatus.ACTIVE,
    monthlyAmount: 50,
    retentionPercentage: 0,
    advisorCommission: 0,
    excludeFromNextBilling: false,
    affiliationDate: new Date('2026-08-01'),
    inactivationReason: null as unknown as string,
    contractPersons: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null as unknown as Date,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractCreationService,
        {
          provide: getRepositoryToken(Contract),
          useValue: {
            create: jest.fn().mockImplementation((val) => val),
            save: jest.fn().mockResolvedValue(mockContract),
            manager: {
              transaction: jest.fn(),
            },
          },
        },
        {
          provide: InvoiceService,
          useValue: {
            generateInvoiceForContract: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: PlansService,
          useValue: {
            findOne: jest.fn().mockResolvedValue({ id: 'plan-1', name: 'Plan Básico', amount: 50 }),
          },
        },
        {
          provide: ContractAffiliationService,
          useValue: {
            recalculateMonthlyAmount: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ContractPdfService,
          useValue: {
            generateAndUploadContractPdf: jest.fn().mockResolvedValue('https://s3/contract.pdf'),
          },
        },
      ],
    }).compile();

    service = module.get<ContractCreationService>(ContractCreationService);
    contractsRepository = module.get(getRepositoryToken(Contract));
    invoiceService = module.get(InvoiceService);
    affiliationService = module.get(ContractAffiliationService);
    contractPdfService = module.get(ContractPdfService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create basic contract in a transaction with atomic counter', async () => {
      const mockCounter = { key: 'contract_code', value: 1 };
      const mockManager = {
        getRepository: jest.fn().mockImplementation((entity) => {
          if (entity === Advisor) {
            return { findOne: jest.fn().mockResolvedValue(mockAdvisor) };
          }
          if (entity === SystemCounter) {
            return {
              findOne: jest.fn().mockResolvedValue(mockCounter),
              save: jest.fn().mockResolvedValue(mockCounter),
            };
          }
          if (entity === Contract) {
            return {
              create: jest.fn().mockReturnValue(mockContract),
              save: jest.fn().mockResolvedValue(mockContract),
            };
          }
          return {};
        }),
      };

      contractsRepository.manager.transaction = jest
        .fn()
        .mockImplementation(async (cb) => cb(mockManager));

      const dto: CreateContractDto = {
        affiliationDate: '2026-08-01',
        advisorId: 'adv-1',
      };

      const res = await service.create(dto);
      expect(res).toEqual(mockContract);
    });
  });

  describe('createFull', () => {
    it('should reject if more than one TITULAR is provided', async () => {
      const dto: CreateContractFullDto = {
        affiliationDate: '2026-08-01',
        advisorId: 'adv-1',
        affiliates: [
          {
            typeIdentityCard: TypeIdentityCard.V,
            identityCard: '1',
            name: 'Juan',
            role: PersonRole.TITULAR,
          },
          {
            typeIdentityCard: TypeIdentityCard.V,
            identityCard: '2',
            name: 'Pedro',
            role: PersonRole.TITULAR,
          },
        ],
      };

      await expect(service.createFull(dto)).rejects.toThrow(BadRequestException);
    });

    it('should reject if AFILIADO has no planId', async () => {
      const dto: CreateContractFullDto = {
        affiliationDate: '2026-08-01',
        advisorId: 'adv-1',
        affiliates: [
          {
            typeIdentityCard: TypeIdentityCard.V,
            identityCard: '1',
            name: 'Juan',
            role: PersonRole.AFILIADO,
          },
        ],
      };

      await expect(service.createFull(dto)).rejects.toThrow(BadRequestException);
    });

    it('should create contract and affiliates full transactionally and trigger post-commit tasks', async () => {
      const dto: CreateContractFullDto = {
        affiliationDate: '2026-08-01',
        advisorId: 'adv-1',
        affiliates: [
          {
            typeIdentityCard: TypeIdentityCard.V,
            identityCard: '12345678',
            name: 'Carlos Titular',
            role: PersonRole.TITULAR,
            isBillingOwner: true,
          },
          {
            typeIdentityCard: TypeIdentityCard.V,
            identityCard: '87654321',
            name: 'Maria Beneficiaria',
            role: PersonRole.AFILIADO,
            planId: 'plan-1',
          },
        ],
      };

      const mockCounter = { key: 'contract_code', value: 1 };
      const mockSavedPerson1 = {
        id: 'p-1',
        identityCard: '12345678',
        typeIdentityCard: 'V',
        name: 'Carlos Titular',
      };
      const mockSavedPerson2 = {
        id: 'p-2',
        identityCard: '87654321',
        typeIdentityCard: 'V',
        name: 'Maria Beneficiaria',
      };

      const mockManager = {
        getRepository: jest.fn().mockImplementation((entity) => {
          if (entity === Advisor) {
            return { findOne: jest.fn().mockResolvedValue(mockAdvisor) };
          }
          if (entity === SystemCounter) {
            return {
              findOne: jest.fn().mockResolvedValue(mockCounter),
              save: jest.fn().mockResolvedValue(mockCounter),
            };
          }
          if (entity === Contract) {
            return {
              create: jest.fn().mockReturnValue(mockContract),
              save: jest.fn().mockResolvedValue(mockContract),
              findOne: jest.fn().mockResolvedValue(mockContract),
            };
          }
          if (entity === Person) {
            return {
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockImplementation((val) => val),
              save: jest.fn().mockImplementation(async (p) => {
                if (p.identityCard === '12345678') return mockSavedPerson1;
                return mockSavedPerson2;
              }),
            };
          }
          if (entity === ContractPerson) {
            return {
              find: jest.fn().mockResolvedValue([]),
              create: jest.fn().mockImplementation((val) => val),
              save: jest.fn().mockImplementation(async (val) => ({ id: 'cp-saved', ...val })),
            };
          }
          if (entity === AffiliationHistory) {
            return {
              create: jest.fn().mockImplementation((val) => val),
              save: jest.fn().mockResolvedValue(true),
            };
          }
          if (entity === HealthDeclaration) {
            return {
              create: jest.fn().mockImplementation((val) => val),
              save: jest.fn().mockResolvedValue([]),
            };
          }
          return {};
        }),
      };

      contractsRepository.manager.transaction = jest
        .fn()
        .mockImplementation(async (cb) => cb(mockManager));

      const res = await service.createFull(dto);

      expect(res).toEqual(mockContract);
      expect(affiliationService.recalculateMonthlyAmount).toHaveBeenCalledWith(
        mockContract.id,
        mockManager,
      );
      expect(invoiceService.generateInvoiceForContract).toHaveBeenCalledWith(
        mockContract.id,
        undefined,
        true,
      );
      expect(contractPdfService.generateAndUploadContractPdf).toHaveBeenCalledWith(mockContract.id);
    });
  });
});
