import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { InvoiceService } from '../../billing/invoices/services/invoice.service';
import { Person, PersonStatus, TypeIdentityCard } from '../../persons/entities/person.entity';
import { PersonsService } from '../../persons/services/persons.service';
import { PlansService } from '../../plans/services/plans.service';
import { Plan } from '../../plans/entities/plan.entity';
import { CreateBeneficiaryDto } from '../dto/create-beneficiary.dto';
import { AffiliationHistory } from '../entities/affiliation-history.entity';
import { ContractPerson, PersonRole } from '../entities/contract-person.entity';
import { Contract, ContractStatus } from '../entities/contract.entity';
import { HealthDeclaration } from '../entities/health-declaration.entity';
import { ContractAffiliationService } from '../services/contract-affiliation.service';

describe('ContractAffiliationService', () => {
  let service: ContractAffiliationService;
  let contractsRepository: jest.Mocked<Repository<Contract>>;
  let contractPersonsRepository: jest.Mocked<Repository<ContractPerson>>;
  let personsService: jest.Mocked<PersonsService>;
  let invoiceService: jest.Mocked<InvoiceService>;
  let plansService: jest.Mocked<PlansService>;
  let mockManager: Record<string, unknown>;
  let mockQr: Record<string, unknown>;

  beforeEach(async () => {
    mockManager = {
      getRepository: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };

    mockQr = {
      isTransactionActive: false,
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockImplementation(async () => {
        mockQr.isTransactionActive = true;
      }),
      commitTransaction: jest.fn().mockImplementation(async () => {
        mockQr.isTransactionActive = false;
      }),
      rollbackTransaction: jest.fn().mockImplementation(async () => {
        mockQr.isTransactionActive = false;
      }),
      release: jest.fn().mockResolvedValue(undefined),
      manager: mockManager,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractAffiliationService,
        {
          provide: getRepositoryToken(Contract),
          useValue: {
            update: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(ContractPerson),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: {
            createQueryRunner: jest.fn().mockReturnValue(mockQr),
          },
        },
        {
          provide: PersonsService,
          useValue: {
            create: jest.fn(),
            findByIdentityCard: jest.fn(),
          },
        },
        {
          provide: InvoiceService,
          useValue: {
            removeAffiliateLineFromActiveInvoice: jest.fn(),
            addAffiliateInclusionLineToActiveInvoice: jest.fn(),
          },
        },
        {
          provide: PlansService,
          useValue: {
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ContractAffiliationService>(ContractAffiliationService);
    contractsRepository = module.get(getRepositoryToken(Contract));
    contractPersonsRepository = module.get(getRepositoryToken(ContractPerson));
    personsService = module.get(PersonsService);
    invoiceService = module.get(InvoiceService);
    plansService = module.get(PlansService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addBeneficiary', () => {
    const mockContract = { id: 'contract-1', code: 'SIR-001', status: ContractStatus.ACTIVE };
    const mockPlan = { id: 'plan-1', name: 'Plan Básico', amount: 30 };
    const dto: CreateBeneficiaryDto = {
      name: 'Maria',
      typeIdentityCard: TypeIdentityCard.V,
      identityCard: '12345678',
      role: PersonRole.AFILIADO,
      planId: 'plan-1',
      isBillingOwner: false,
      contractId: 'contract-1',
    };
    const mockCreated = {
      id: 'p-1',
      name: 'Maria',
      identityCard: '12345678',
      typeIdentityCard: TypeIdentityCard.V,
    } as Person;

    it('should throw NotFoundException if contract not found', async () => {
      const mockContractRepo = { findOne: jest.fn().mockResolvedValue(null) };
      mockManager.getRepository = jest.fn().mockReturnValue(mockContractRepo);

      await expect(service.addBeneficiary('invalid-contract', dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if AFILIADO has no planId', async () => {
      const mockContractRepo = { findOne: jest.fn().mockResolvedValue(mockContract) };
      mockManager.getRepository = jest.fn().mockReturnValue(mockContractRepo);

      await expect(
        service.addBeneficiary('contract-1', { ...dto, planId: '' as unknown as string }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should successfully affiliate a new person and record history and inclusion line', async () => {
      const mockContractRepo = {
        findOne: jest.fn().mockResolvedValue(mockContract),
        update: jest.fn().mockResolvedValue(true),
      };
      const mockCpRepo = {
        findOne: jest.fn().mockResolvedValue(null), // not already affiliated to this contract
        find: jest.fn().mockResolvedValue([]), // not active in any other contract
        create: jest.fn().mockImplementation((val) => ({ id: 'cp-new', ...val })),
        save: jest.fn().mockImplementation(async (val) => val),
      };
      const mockHistoryRepo = {
        create: jest.fn().mockImplementation((val) => val),
        save: jest.fn().mockResolvedValue(true),
      };
      const mockHdRepo = {
        create: jest.fn().mockImplementation((val) => val),
        save: jest.fn().mockResolvedValue(true),
      };

      mockManager.getRepository = jest.fn().mockImplementation((entity) => {
        if (entity === Contract) return mockContractRepo;
        if (entity === ContractPerson) return mockCpRepo;
        if (entity === AffiliationHistory) return mockHistoryRepo;
        if (entity === HealthDeclaration) return mockHdRepo;
        return {};
      });

      plansService.findOne.mockResolvedValue(mockPlan as unknown as Plan);
      personsService.findByIdentityCard.mockResolvedValue(null);
      personsService.create.mockResolvedValue(mockCreated);

      const res = await service.addBeneficiary('contract-1', dto);

      expect(res).toEqual(mockCreated);
      expect(personsService.create).toHaveBeenCalled();
      expect(mockCpRepo.save).toHaveBeenCalled();
      expect(mockHistoryRepo.save).toHaveBeenCalled();
      expect(invoiceService.addAffiliateInclusionLineToActiveInvoice).toHaveBeenCalledWith(
        'contract-1',
        mockCreated,
        mockPlan,
        mockManager,
      );
    });
  });

  describe('removeAffiliate', () => {
    it('should throw NotFoundException if contractPerson not found', async () => {
      contractPersonsRepository.findOne.mockResolvedValue(null);
      await expect(service.removeAffiliate('invalid-id')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if trying to remove TITULAR', async () => {
      contractPersonsRepository.findOne.mockResolvedValue({
        id: 'cp-1',
        role: PersonRole.TITULAR,
        isBillingOwner: false,
      } as unknown as ContractPerson);

      await expect(service.removeAffiliate('cp-1')).rejects.toThrow(
        'El TITULAR no puede ser eliminado',
      );
    });

    it('should throw BadRequestException if trying to remove billing owner', async () => {
      contractPersonsRepository.findOne.mockResolvedValue({
        id: 'cp-1',
        role: PersonRole.AFILIADO,
        isBillingOwner: true,
      } as unknown as ContractPerson);

      await expect(service.removeAffiliate('cp-1')).rejects.toThrow(
        'Debe existir un responsable de facturación',
      );
    });

    it('should remove affiliate and trigger invoice line removal and recalculation', async () => {
      const mockCp = {
        id: 'cp-1',
        role: PersonRole.AFILIADO,
        isBillingOwner: false,
        contract: { id: 'contract-1' },
        person: { id: 'p-1', name: 'Ana', plan: { amount: 30 } },
        plan: { amount: 30 },
      } as unknown as ContractPerson;

      contractPersonsRepository.findOne.mockResolvedValue(mockCp);

      const mockHistoryRepo = { create: jest.fn().mockImplementation((v) => v), save: jest.fn() };
      const mockCpRepo = {
        softRemove: jest.fn().mockResolvedValue(true),
        find: jest.fn().mockResolvedValue([]),
      };
      const mockContractRepo = { update: jest.fn().mockResolvedValue(true) };

      mockManager.getRepository = jest.fn().mockImplementation((target) => {
        if (target === AffiliationHistory) return mockHistoryRepo;
        if (target === ContractPerson) return mockCpRepo;
        if (target === Contract) return mockContractRepo;
        return {};
      });

      await service.removeAffiliate('cp-1');

      expect(mockHistoryRepo.save).toHaveBeenCalled();
      expect(mockCpRepo.softRemove).toHaveBeenCalledWith(mockCp);
      expect(invoiceService.removeAffiliateLineFromActiveInvoice).toHaveBeenCalledWith(
        'contract-1',
        'p-1',
        mockManager,
      );
    });
  });

  describe('setContractTitular', () => {
    it('should throw NotFoundException if contractPerson not found in contract', async () => {
      contractPersonsRepository.findOne.mockResolvedValue(null);
      await expect(
        service.setContractTitular('contract-1', { contractPersonId: 'cp-1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should toggle titular in transaction and recalculate monthly amount', async () => {
      const mockTarget = {
        id: 'cp-1',
        role: PersonRole.AFILIADO,
        contract: { id: 'contract-1' },
        person: { plan: { amount: 25 } },
      } as unknown as ContractPerson;

      contractPersonsRepository.findOne.mockResolvedValue(mockTarget);

      const mockCpRepo = {
        find: jest.fn().mockResolvedValue([]),
      };
      const mockContractRepo = {
        update: jest.fn().mockResolvedValue(true),
      };

      mockManager.find = jest.fn().mockResolvedValue([]);
      mockManager.save = jest.fn().mockResolvedValue(true);
      mockManager.getRepository = jest.fn().mockImplementation((target) => {
        if (target === ContractPerson) return mockCpRepo;
        if (target === Contract) return mockContractRepo;
        return {};
      });

      await service.setContractTitular('contract-1', { contractPersonId: 'cp-1' });

      expect(mockManager.save).toHaveBeenCalled();
      expect(mockContractRepo.update).toHaveBeenCalled();
    });
  });

  describe('setBillingOwner', () => {
    it('should throw NotFoundException if target not found', async () => {
      contractPersonsRepository.findOne.mockResolvedValue(null);
      await expect(
        service.setBillingOwner('contract-1', { contractPersonId: 'cp-1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should unset other billing owners and set target in transaction', async () => {
      const mockTarget = { id: 'cp-1', isBillingOwner: false } as unknown as ContractPerson;
      contractPersonsRepository.findOne.mockResolvedValue(mockTarget);

      mockManager.update = jest.fn().mockResolvedValue(true);
      mockManager.save = jest.fn().mockResolvedValue(true);

      await service.setBillingOwner('contract-1', { contractPersonId: 'cp-1' });

      expect(mockManager.update).toHaveBeenCalled();
      expect(mockTarget.isBillingOwner).toBe(true);
      expect(mockManager.save).toHaveBeenCalledWith(ContractPerson, mockTarget);
    });
  });

  describe('recalculateMonthlyAmount', () => {
    it('should calculate sum of active AFILIADO plans and update contract', async () => {
      contractPersonsRepository.find.mockResolvedValue([
        {
          role: PersonRole.AFILIADO,
          plan: { amount: 20 },
          person: { status: PersonStatus.ACTIVE },
        } as unknown as ContractPerson,
        {
          role: PersonRole.AFILIADO,
          person: { status: PersonStatus.ACTIVE, plan: { amount: 30 } },
        } as unknown as ContractPerson,
        {
          role: PersonRole.TITULAR,
          plan: { amount: 50 },
          person: { status: PersonStatus.ACTIVE },
        } as unknown as ContractPerson,
      ]);

      await service.recalculateMonthlyAmount('contract-1');

      expect(contractsRepository.update).toHaveBeenCalledWith('contract-1', {
        monthlyAmount: 50,
      });
    });
  });
});
