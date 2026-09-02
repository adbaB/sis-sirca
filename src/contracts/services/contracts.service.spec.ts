import { Test, TestingModule } from '@nestjs/testing';
import { ContractAffiliationService } from './contract-affiliation.service';
import { ContractCreationService } from './contract-creation.service';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { ContractPdfService } from './contract-pdf.service';
import { ContractStatisticsService } from './contract-statistics.service';
import { ContractsService } from './contracts.service';
import { ContractQueryRepository } from '../repositories/contract-query.repository';
import { Contract, ContractStatus } from '../entities/contract.entity';
import { CreateContractFullDto } from '../dto/create-contract-full.dto';
import { FindContractDto } from '../dto/find-contract.dto';
import { UpdateContractDto } from '../dto/update-contract.dto';
import { InactivateContractDto } from '../dto/inactivate-contract.dto';
import { CreateBeneficiaryDto } from '../dto/create-beneficiary.dto';
import { SetContractTitularDto } from '../dto/set-contract-titular.dto';
import { SetBillingOwnerDto } from '../dto/set-billing-owner.dto';
import { Person, TypeIdentityCard } from '../../persons/entities/person.entity';
import { PersonRole } from '../entities/contract-person.entity';

describe('ContractsService (Facade)', () => {
  let service: ContractsService;
  let creationService: jest.Mocked<ContractCreationService>;
  let lifecycleService: jest.Mocked<ContractLifecycleService>;
  let affiliationService: jest.Mocked<ContractAffiliationService>;
  let pdfService: jest.Mocked<ContractPdfService>;
  let statisticsService: jest.Mocked<ContractStatisticsService>;
  let queryRepository: jest.Mocked<ContractQueryRepository>;

  const mockContract = {
    id: 'contract-uuid-1',
    code: 'SIR-001-00001',
    status: ContractStatus.ACTIVE,
    monthlyAmount: 50,
  } as Contract;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractsService,
        {
          provide: ContractCreationService,
          useValue: {
            createFull: jest.fn().mockResolvedValue(mockContract),
          },
        },
        {
          provide: ContractLifecycleService,
          useValue: {
            findOne: jest.fn().mockResolvedValue(mockContract),
            findByCode: jest.fn().mockResolvedValue(mockContract),
            update: jest.fn().mockResolvedValue(mockContract),
            remove: jest.fn().mockResolvedValue(undefined),
            inactivate: jest.fn().mockResolvedValue(mockContract),
            activate: jest.fn().mockResolvedValue(mockContract),
            setAdvisor: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ContractAffiliationService,
          useValue: {
            addBeneficiary: jest.fn().mockResolvedValue({ id: 'person-1' } as Person),
            removeAffiliate: jest.fn().mockResolvedValue(undefined),
            setContractTitular: jest.fn().mockResolvedValue(undefined),
            setBillingOwner: jest.fn().mockResolvedValue(undefined),
            recalculateMonthlyAmount: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ContractPdfService,
          useValue: {
            generateContractPdfBuffer: jest.fn().mockResolvedValue(Buffer.from('pdf')),
            generateAndUploadContractPdf: jest.fn().mockResolvedValue('https://s3/pdf.pdf'),
          },
        },
        {
          provide: ContractStatisticsService,
          useValue: {
            getPipelineStats: jest.fn().mockResolvedValue({
              stats: { totalPipeline: 100, totalCollected: 50, totalPending: 50 },
              counts: { pending: 1, rejected: 0, partial: 0, paid: 0 },
            }),
            getAffiliationStats: jest.fn().mockResolvedValue({
              mode: 'billing',
              period: { startDate: '2026-07-25', endDate: '2026-08-24' },
              newAffiliations: 5,
              disaffiliations: 1,
              revenueGained: 100,
              revenueLost: 20,
              netChange: 4,
              netRevenueChange: 80,
            }),
          },
        },
        {
          provide: ContractQueryRepository,
          useValue: {
            findAllPaginated: jest.fn().mockResolvedValue({
              data: [mockContract],
              meta: {
                totalItems: 1,
                itemCount: 1,
                itemsPerPage: 10,
                totalPages: 1,
                currentPage: 1,
              },
            }),
          },
        },
      ],
    }).compile();

    service = module.get<ContractsService>(ContractsService);
    creationService = module.get(ContractCreationService);
    lifecycleService = module.get(ContractLifecycleService);
    affiliationService = module.get(ContractAffiliationService);
    pdfService = module.get(ContractPdfService);
    statisticsService = module.get(ContractStatisticsService);
    queryRepository = module.get(ContractQueryRepository);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Creation delegates', () => {
    it('createFull should delegate to creationService.createFull', async () => {
      const dto: CreateContractFullDto = {
        affiliationDate: '2026-08-01',
        advisorId: 'adv-1',
        affiliates: [
          {
            typeIdentityCard: TypeIdentityCard.V,
            identityCard: '12345678',
            name: 'Juan',
            role: PersonRole.TITULAR,
          },
        ],
      };
      const res = await service.createFull(dto);
      expect(creationService.createFull).toHaveBeenCalledWith(dto);
      expect(res).toEqual(mockContract);
    });
  });

  describe('Queries & Search delegates', () => {
    it('findAll should delegate to queryRepository.findAllPaginated', async () => {
      const query: FindContractDto = { search: 'SIR' };
      const res = await service.findAll(query);
      expect(queryRepository.findAllPaginated).toHaveBeenCalledWith(query);
      expect(res.data).toEqual([mockContract]);
    });

    it('findOne should delegate to lifecycleService.findOne', async () => {
      const res = await service.findOne('contract-uuid-1');
      expect(lifecycleService.findOne).toHaveBeenCalledWith('contract-uuid-1');
      expect(res).toEqual(mockContract);
    });

    it('findByCode should delegate to lifecycleService.findByCode', async () => {
      const res = await service.findByCode('SIR-001-00001');
      expect(lifecycleService.findByCode).toHaveBeenCalledWith('SIR-001-00001');
      expect(res).toEqual(mockContract);
    });
  });

  describe('Lifecycle delegates', () => {
    it('update should delegate to lifecycleService.update', async () => {
      const dto: UpdateContractDto = { retentionPercentage: 10 };
      const res = await service.update('contract-uuid-1', dto);
      expect(lifecycleService.update).toHaveBeenCalledWith('contract-uuid-1', dto);
      expect(res).toEqual(mockContract);
    });

    it('remove should delegate to lifecycleService.remove', async () => {
      await service.remove('contract-uuid-1');
      expect(lifecycleService.remove).toHaveBeenCalledWith('contract-uuid-1');
    });

    it('inactivate should delegate to lifecycleService.inactivate', async () => {
      const dto: InactivateContractDto = { reason: 'Mora' };
      const res = await service.inactivate('contract-uuid-1', dto);
      expect(lifecycleService.inactivate).toHaveBeenCalledWith('contract-uuid-1', dto);
      expect(res).toEqual(mockContract);
    });

    it('activate should delegate to lifecycleService.activate', async () => {
      const res = await service.activate('contract-uuid-1');
      expect(lifecycleService.activate).toHaveBeenCalledWith('contract-uuid-1');
      expect(res).toEqual(mockContract);
    });

    it('setAdvisor should delegate to lifecycleService.setAdvisor', async () => {
      await service.setAdvisor('contract-uuid-1', 'adv-2');
      expect(lifecycleService.setAdvisor).toHaveBeenCalledWith('contract-uuid-1', 'adv-2');
    });
  });

  describe('Affiliation delegates', () => {
    it('addBeneficiary should delegate to affiliationService.addBeneficiary', async () => {
      const dto: CreateBeneficiaryDto = {
        name: 'Maria',
        typeIdentityCard: TypeIdentityCard.V,
        identityCard: '87654321',
        planId: 'plan-1',
        role: PersonRole.AFILIADO,
        isBillingOwner: false,
        contractId: 'contract-uuid-1',
      };
      const res = await service.addBeneficiary('contract-uuid-1', dto);
      expect(affiliationService.addBeneficiary).toHaveBeenCalledWith('contract-uuid-1', dto);
      expect(res.id).toBe('person-1');
    });

    it('removeAffiliate should delegate to affiliationService.removeAffiliate', async () => {
      await service.removeAffiliate('cp-1');
      expect(affiliationService.removeAffiliate).toHaveBeenCalledWith('cp-1');
    });

    it('setContractTitular should delegate to affiliationService.setContractTitular', async () => {
      const dto: SetContractTitularDto = { contractPersonId: 'cp-1' };
      await service.setContractTitular('contract-uuid-1', dto);
      expect(affiliationService.setContractTitular).toHaveBeenCalledWith('contract-uuid-1', dto);
    });

    it('setBillingOwner should delegate to affiliationService.setBillingOwner', async () => {
      const dto: SetBillingOwnerDto = { contractPersonId: 'cp-1' };
      await service.setBillingOwner('contract-uuid-1', dto);
      expect(affiliationService.setBillingOwner).toHaveBeenCalledWith('contract-uuid-1', dto);
    });

    it('recalculateMonthlyAmount should delegate to affiliationService.recalculateMonthlyAmount', async () => {
      await service.recalculateMonthlyAmount('contract-uuid-1');
      expect(affiliationService.recalculateMonthlyAmount).toHaveBeenCalledWith(
        'contract-uuid-1',
        undefined,
      );
    });
  });

  describe('PDF delegates', () => {
    it('generateContractPdfBuffer should delegate to pdfService.generateContractPdfBuffer', async () => {
      const res = await service.generateContractPdfBuffer('contract-uuid-1');
      expect(pdfService.generateContractPdfBuffer).toHaveBeenCalledWith('contract-uuid-1');
      expect(res).toBeInstanceOf(Buffer);
    });

    it('generateAndUploadContractPdf should delegate to pdfService.generateAndUploadContractPdf', async () => {
      const res = await service.generateAndUploadContractPdf('contract-uuid-1');
      expect(pdfService.generateAndUploadContractPdf).toHaveBeenCalledWith('contract-uuid-1');
      expect(res).toBe('https://s3/pdf.pdf');
    });
  });

  describe('Statistics delegates', () => {
    it('getPipelineStats should delegate to statisticsService.getPipelineStats', async () => {
      const res = await service.getPipelineStats('adv-1', '08', '2026');
      expect(statisticsService.getPipelineStats).toHaveBeenCalledWith('adv-1', '08', '2026');
      expect(res.stats.totalPipeline).toBe(100);
    });

    it('getAffiliationStats should delegate to statisticsService.getAffiliationStats', async () => {
      const res = await service.getAffiliationStats(8, 2026, 'billing');
      expect(statisticsService.getAffiliationStats).toHaveBeenCalledWith(8, 2026, 'billing');
      expect(res.netChange).toBe(4);
    });
  });
});
