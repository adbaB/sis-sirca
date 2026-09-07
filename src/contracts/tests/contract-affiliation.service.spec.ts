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
import { ContractPerson, Parentesco, PersonRole } from '../entities/contract-person.entity';
import { Contract, ContractStatus } from '../entities/contract.entity';
import { HealthDeclaration } from '../entities/health-declaration.entity';
import { AffiliationAction } from '../enums/affiliation-action.enum';
import {
  BeneficiaryVerificationResult,
  ContractVerificationResult,
} from '../interfaces/person-verification.interface';
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
            findOne: jest.fn(),
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
            update: jest.fn(),
          },
        },
        {
          provide: InvoiceService,
          useValue: {
            removeAffiliateLineFromActiveInvoice: jest.fn(),
            addAffiliateInclusionLineToActiveInvoice: jest.fn(),
            updatePlanLineOnActiveInvoice: jest.fn(),
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

    it('should propagate affiliationReason from migrateFromInactiveContracts to AffiliationHistory', async () => {
      const mockContractRepo = {
        findOne: jest.fn().mockResolvedValue(mockContract),
        update: jest.fn().mockResolvedValue(true),
      };
      const inactiveCp = {
        id: 'cp-inactive',
        contract: { id: 'c-inactive', code: 'SIR-001-00000', status: ContractStatus.INACTIVE },
        person: mockCreated,
        plan: mockPlan,
      };
      const mockCpRepo = {
        findOne: jest.fn().mockResolvedValue(null),
        find: jest.fn().mockImplementation(async (opts) => {
          if (opts?.where?.contract?.status === ContractStatus.INACTIVE) {
            return [inactiveCp];
          }
          return [];
        }),
        create: jest.fn().mockImplementation((val) => ({ id: 'cp-new', ...val })),
        save: jest.fn().mockImplementation(async (val) => val),
        softRemove: jest.fn().mockResolvedValue(true),
      };
      const mockHistoryRepo = {
        create: jest.fn().mockImplementation((val) => val),
        save: jest.fn().mockResolvedValue(true),
      };

      mockManager.getRepository = jest.fn().mockImplementation((entity) => {
        if (entity === Contract) return mockContractRepo;
        if (entity === ContractPerson) return mockCpRepo;
        if (entity === AffiliationHistory) return mockHistoryRepo;
        return {};
      });

      plansService.findOne.mockResolvedValue(mockPlan as unknown as Plan);
      personsService.findByIdentityCard.mockResolvedValue(null);
      personsService.create.mockResolvedValue(mockCreated);

      await service.addBeneficiary('contract-1', dto);

      expect(mockHistoryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AffiliationAction.AFILIACION,
          reason: 'Proveniente del contrato SIR-001-00000',
        }),
      );
    });
  });

  describe('removeAffiliate', () => {
    it('should throw NotFoundException if contractPerson not found', async () => {
      const mockCpRepo = { findOne: jest.fn().mockResolvedValue(null) };
      mockManager.getRepository = jest.fn().mockReturnValue(mockCpRepo);

      await expect(service.removeAffiliate('invalid-id')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if contractId does not match', async () => {
      const mockCp = {
        id: 'cp-1',
        role: PersonRole.AFILIADO,
        contract: { id: 'contract-1' },
      } as unknown as ContractPerson;
      const mockCpRepo = { findOne: jest.fn().mockResolvedValue(mockCp) };
      mockManager.getRepository = jest.fn().mockReturnValue(mockCpRepo);

      await expect(service.removeAffiliate('cp-1', 'different-contract')).rejects.toThrow(
        'El afiliado no pertenece al contrato especificado.',
      );
    });

    it('should throw BadRequestException if trying to remove TITULAR', async () => {
      const mockCp = {
        id: 'cp-1',
        role: PersonRole.TITULAR,
        isBillingOwner: false,
        contract: { id: 'contract-1' },
      } as unknown as ContractPerson;
      const mockCpRepo = { findOne: jest.fn().mockResolvedValue(mockCp) };
      mockManager.getRepository = jest.fn().mockReturnValue(mockCpRepo);

      await expect(service.removeAffiliate('cp-1')).rejects.toThrow(
        'El TITULAR no puede ser eliminado',
      );
    });

    it('should throw BadRequestException if trying to remove billing owner', async () => {
      const mockCp = {
        id: 'cp-1',
        role: PersonRole.AFILIADO,
        isBillingOwner: true,
        contract: { id: 'contract-1' },
      } as unknown as ContractPerson;
      const mockCpRepo = { findOne: jest.fn().mockResolvedValue(mockCp) };
      mockManager.getRepository = jest.fn().mockReturnValue(mockCpRepo);

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

      const mockHistoryRepo = { create: jest.fn().mockImplementation((v) => v), save: jest.fn() };
      const mockCpRepo = {
        findOne: jest.fn().mockResolvedValue(mockCp),
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

      await service.removeAffiliate('cp-1', 'contract-1');

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
      const mockCpRepo = { findOne: jest.fn().mockResolvedValue(null) };
      mockManager.getRepository = jest.fn().mockReturnValue(mockCpRepo);

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

      const mockCpRepo = {
        findOne: jest.fn().mockResolvedValue(mockTarget),
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
      const mockCpRepo = { findOne: jest.fn().mockResolvedValue(null) };
      mockManager.getRepository = jest.fn().mockReturnValue(mockCpRepo);

      await expect(
        service.setBillingOwner('contract-1', { contractPersonId: 'cp-1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should unset other billing owners and set target in transaction', async () => {
      const mockTarget = { id: 'cp-1', isBillingOwner: false } as unknown as ContractPerson;
      const mockCpRepo = { findOne: jest.fn().mockResolvedValue(mockTarget) };
      mockManager.getRepository = jest.fn().mockReturnValue(mockCpRepo);

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

  describe('updateBeneficiary', () => {
    it('should throw NotFoundException if beneficiary not found', async () => {
      const mockCpRepo = { findOne: jest.fn().mockResolvedValue(null) };
      mockManager.getRepository = jest.fn().mockReturnValue(mockCpRepo);

      await expect(
        service.updateBeneficiary('contract-1', 'cp-invalid', { name: 'Juan' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if planId provided for TITULAR', async () => {
      const mockCp = {
        id: 'cp-titular',
        role: PersonRole.TITULAR,
        contract: { id: 'contract-1' },
        person: { id: 'p-1', name: 'Pedro' },
      };
      const mockCpRepo = { findOne: jest.fn().mockResolvedValue(mockCp) };
      mockManager.getRepository = jest.fn().mockReturnValue(mockCpRepo);

      await expect(
        service.updateBeneficiary('contract-1', 'cp-titular', { planId: 'plan-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if new plan does not exist', async () => {
      const mockCp = {
        id: 'cp-1',
        role: PersonRole.AFILIADO,
        contract: { id: 'contract-1' },
        person: { id: 'p-1', name: 'Pedro' },
      };
      const mockCpRepo = { findOne: jest.fn().mockResolvedValue(mockCp) };
      mockManager.getRepository = jest.fn().mockReturnValue(mockCpRepo);
      plansService.findOne.mockResolvedValue(null);

      await expect(
        service.updateBeneficiary('contract-1', 'cp-1', { planId: 'plan-nonexistent' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update person, relationship, and plan, triggering invoice line update and monthly amount recalculation', async () => {
      const mockOldPlan = { id: 'plan-old', name: 'Plan Basico', amount: 10 };
      const mockNewPlan = { id: 'plan-new', name: 'Plan Premium', amount: 25 };
      const mockCp = {
        id: 'cp-1',
        role: PersonRole.AFILIADO,
        contract: { id: 'contract-1' },
        person: { id: 'p-1', name: 'Pedro', plan: mockOldPlan },
        plan: mockOldPlan,
        relationship: undefined,
      };

      const mockPersonRepo = { update: jest.fn().mockResolvedValue(true) };
      const mockContractRepo = { update: jest.fn().mockResolvedValue(true) };
      const mockCpRepo = {
        findOne: jest.fn().mockResolvedValue(mockCp),
        save: jest.fn().mockImplementation(async (cp) => cp),
        find: jest.fn().mockResolvedValue([
          {
            role: PersonRole.AFILIADO,
            plan: mockNewPlan,
            person: { status: PersonStatus.ACTIVE },
          },
        ]),
      };
      const mockHdRepo = {
        delete: jest.fn().mockResolvedValue(true),
        create: jest.fn().mockImplementation((val) => val),
        save: jest.fn().mockResolvedValue(true),
      };

      mockManager.getRepository = jest.fn().mockImplementation((entity) => {
        if (entity === ContractPerson) return mockCpRepo;
        if (entity === Person) return mockPersonRepo;
        if (entity === Contract) return mockContractRepo;
        if (entity === HealthDeclaration) return mockHdRepo;
        return {};
      });

      plansService.findOne.mockResolvedValue(mockNewPlan as unknown as Plan);
      personsService.update.mockResolvedValue({
        id: 'p-1',
        name: 'Pedro Actualizado',
      } as unknown as Person);

      const result = await service.updateBeneficiary('contract-1', 'cp-1', {
        name: 'Pedro Actualizado',
        relationship: Parentesco.HIJO,
        planId: 'plan-new',
      });

      expect(personsService.update).toHaveBeenCalledWith(
        'p-1',
        expect.objectContaining({ name: 'Pedro Actualizado' }),
        mockManager,
      );
      expect(mockCp.relationship).toBe('HIJO');
      expect(mockCp.plan).toEqual(mockNewPlan);
      expect(mockPersonRepo.update).toHaveBeenCalledWith('p-1', { plan: mockNewPlan });
      expect(invoiceService.updatePlanLineOnActiveInvoice).toHaveBeenCalledWith(
        'contract-1',
        'p-1',
        'plan-new',
        25,
        'Plan Premium',
      );
      expect(mockContractRepo.update).toHaveBeenCalledWith('contract-1', { monthlyAmount: 25 });
      expect(result).toBeDefined();
    });
  });

  describe('bulkUpdateBeneficiaries', () => {
    it('should throw NotFoundException if contract not found', async () => {
      const mockContractRepo = { findOne: jest.fn().mockResolvedValue(null) };
      mockManager.getRepository = jest.fn().mockReturnValue(mockContractRepo);

      await expect(
        service.bulkUpdateBeneficiaries('contract-invalid', {
          beneficiaries: [{ contractPersonId: 'cp-1', name: 'Pedro' }],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update multiple beneficiaries and recalculate monthly amount once', async () => {
      const mockContractRepo = {
        findOne: jest.fn().mockResolvedValue({ id: 'contract-1' }),
        update: jest.fn().mockResolvedValue(true),
      };
      const mockCp = {
        id: 'cp-1',
        role: PersonRole.AFILIADO,
        contract: { id: 'contract-1' },
        person: { id: 'p-1', name: 'Pedro' },
        plan: null,
      };
      const mockCpRepo = {
        findOne: jest.fn().mockResolvedValue(mockCp),
        save: jest.fn().mockImplementation(async (cp) => cp),
        find: jest.fn().mockResolvedValue([]),
      };

      mockManager.getRepository = jest.fn().mockImplementation((entity) => {
        if (entity === Contract) return mockContractRepo;
        if (entity === ContractPerson) return mockCpRepo;
        return {};
      });

      const updateSpy = jest
        .spyOn(service, 'updateBeneficiary')
        .mockResolvedValue(mockCp as unknown as ContractPerson);

      const result = await service.bulkUpdateBeneficiaries('contract-1', {
        beneficiaries: [
          { contractPersonId: 'cp-1', name: 'Pedro' },
          { id: 'cp-2', name: 'Maria' },
        ],
      });

      expect(updateSpy).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
      expect(mockContractRepo.update).toHaveBeenCalled();
    });
  });

  describe('verifyPersonAffiliation', () => {
    it('should throw NotFoundException if person is not found', async () => {
      jest.spyOn(personsService, 'findByIdentityCard').mockResolvedValue(null);

      await expect(service.verifyPersonAffiliation(TypeIdentityCard.V, '99999999')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return person with empty contracts if person has no beneficiary affiliations', async () => {
      const mockPerson = {
        id: 'p-1',
        name: 'Carlos Ruiz',
        typeIdentityCard: TypeIdentityCard.V,
        identityCard: '12345678',
        phone: '04121234567',
        birthDate: new Date('1990-01-01'),
        status: PersonStatus.ACTIVE,
      } as Person;

      jest.spyOn(personsService, 'findByIdentityCard').mockResolvedValue(mockPerson);
      jest.spyOn(contractPersonsRepository, 'find').mockResolvedValue([]);

      const result = await service.verifyPersonAffiliation(TypeIdentityCard.V, '12345678');

      expect(result.person.id).toBe('p-1');
      expect(result.contracts).toHaveLength(0);
      expect(result.hasActiveContract).toBe(false);
      expect(result.hasSuspendedContract).toBe(false);
    });

    it('should return and prioritize contracts (ACTIVE first, then SUSPENDED, then INACTIVE)', async () => {
      const mockPerson = {
        id: 'p-1',
        name: 'Carlos Ruiz',
        typeIdentityCard: TypeIdentityCard.V,
        identityCard: '12345678',
        status: PersonStatus.ACTIVE,
      } as Person;

      const mockAffiliations = [
        {
          id: 'cp-old',
          role: PersonRole.AFILIADO,
          contract: {
            id: 'c-old',
            code: 'SIR-001-00001',
            status: ContractStatus.INACTIVE,
            affiliationDate: new Date('2024-01-01'),
          },
          plan: { name: 'Plan Básico' },
        },
        {
          id: 'cp-suspended',
          role: PersonRole.AFILIADO,
          contract: {
            id: 'c-susp',
            code: 'SIR-001-00002',
            status: ContractStatus.SUSPENDED,
            affiliationDate: new Date('2025-06-01'),
          },
          plan: { name: 'Plan Plus' },
        },
        {
          id: 'cp-active',
          role: PersonRole.AFILIADO,
          contract: {
            id: 'c-act',
            code: 'SIR-001-00003',
            status: ContractStatus.ACTIVE,
            affiliationDate: new Date('2026-01-01'),
          },
          plan: { name: 'Plan Premium' },
        },
      ] as unknown as ContractPerson[];

      jest.spyOn(personsService, 'findByIdentityCard').mockResolvedValue(mockPerson);
      jest.spyOn(contractPersonsRepository, 'find').mockResolvedValue(mockAffiliations);

      const result = await service.verifyPersonAffiliation(TypeIdentityCard.V, '12345678');

      expect(result.contracts).toHaveLength(3);
      expect(result.contracts[0].code).toBe('SIR-001-00003');
      expect(result.contracts[0].status).toBe(ContractStatus.ACTIVE);
      expect(result.contracts[0].isSuspended).toBe(false);

      expect(result.contracts[1].code).toBe('SIR-001-00002');
      expect(result.contracts[1].status).toBe(ContractStatus.SUSPENDED);
      expect(result.contracts[1].isSuspended).toBe(true);

      expect(result.contracts[2].code).toBe('SIR-001-00001');
      expect(result.contracts[2].status).toBe(ContractStatus.INACTIVE);
      expect(result.contracts[2].isSuspended).toBe(false);

      expect(result.hasActiveContract).toBe(true);
      expect(result.hasSuspendedContract).toBe(true);
    });
  });

  describe('verifyContractByCode', () => {
    it('should throw NotFoundException if contract is not found', async () => {
      jest.spyOn(contractsRepository, 'findOne').mockResolvedValue(null);

      await expect(service.verifyContractByCode('SIR-404')).rejects.toThrow(NotFoundException);
    });

    it('should return contract details, titular and beneficiaries with eligibility', async () => {
      const mockContract = {
        id: 'c-1',
        code: 'SIR-001-00001',
        status: ContractStatus.ACTIVE,
        affiliationDate: new Date('2026-01-15'),
        cutoffDay: 5,
        contractPersons: [
          {
            id: 'cp-titular',
            role: PersonRole.TITULAR,
            isBillingOwner: true,
            person: {
              id: 'p-titular',
              name: 'Pedro Titular',
              typeIdentityCard: TypeIdentityCard.V,
              identityCard: '11111111',
              phone: '04141111111',
            },
          },
          {
            id: 'cp-beneficiary-1',
            role: PersonRole.AFILIADO,
            relationship: Parentesco.HIJO,
            person: {
              id: 'p-ben-1',
              name: 'Hijo Activo',
              typeIdentityCard: TypeIdentityCard.V,
              identityCard: '22222222',
              status: PersonStatus.ACTIVE,
            },
            plan: { name: 'Plan Familiar' },
          },
        ],
      } as unknown as Contract;

      jest.spyOn(contractsRepository, 'findOne').mockResolvedValue(mockContract);

      const result = await service.verifyContractByCode('SIR-001-00001');

      expect(result.mode).toBe('BY_CONTRACT');
      expect(result.contract.code).toBe('SIR-001-00001');
      expect(result.contract.isSuspended).toBe(false);
      expect(result.contract.titular?.name).toBe('Pedro Titular');
      expect(result.totalBeneficiaries).toBe(1);
      expect(result.beneficiaries[0].name).toBe('Hijo Activo');
      expect(result.beneficiaries[0].isEligible).toBe(true);
    });

    it('should mark beneficiaries as isEligible: false when contract is SUSPENDED', async () => {
      const mockContract = {
        id: 'c-susp',
        code: 'SIR-001-00002',
        status: ContractStatus.SUSPENDED,
        affiliationDate: new Date('2026-01-15'),
        cutoffDay: 10,
        contractPersons: [
          {
            id: 'cp-beneficiary-1',
            role: PersonRole.AFILIADO,
            relationship: Parentesco.ESPOSA,
            person: {
              id: 'p-ben-2',
              name: 'Esposa',
              typeIdentityCard: TypeIdentityCard.V,
              identityCard: '33333333',
              status: PersonStatus.ACTIVE,
            },
            plan: { name: 'Plan Oro' },
          },
        ],
      } as unknown as Contract;

      jest.spyOn(contractsRepository, 'findOne').mockResolvedValue(mockContract);

      const result = await service.verifyContractByCode('SIR-001-00002');

      expect(result.contract.isSuspended).toBe(true);
      expect(result.beneficiaries[0].isEligible).toBe(false);
    });
  });

  describe('verifyUnified', () => {
    it('should throw BadRequestException if query is empty or whitespace', async () => {
      await expect(service.verifyUnified('')).rejects.toThrow(BadRequestException);
      await expect(service.verifyUnified('   ')).rejects.toThrow(BadRequestException);
    });

    it('should auto-detect contract code and delegate to verifyContractByCode', async () => {
      jest.spyOn(contractsRepository, 'findOne').mockResolvedValueOnce({
        id: 'c-1',
        code: 'SIR-001-00001',
      } as Contract);

      const mockContractResult: ContractVerificationResult = {
        mode: 'BY_CONTRACT',
        contract: {
          id: 'c-1',
          code: 'SIR-001-00001',
          status: ContractStatus.ACTIVE,
          isSuspended: false,
          affiliationDate: new Date(),
          cutoffDay: 5,
          titular: null,
        },
        beneficiaries: [],
        totalBeneficiaries: 0,
      };

      const spy = jest.spyOn(service, 'verifyContractByCode').mockResolvedValue(mockContractResult);

      const result = await service.verifyUnified('SIR-001-00001');

      expect(spy).toHaveBeenCalledWith('SIR-001-00001');
      expect(result.mode).toBe('BY_CONTRACT');
    });

    it('should auto-detect document with prefix and delegate to verifyPersonAffiliation', async () => {
      jest.spyOn(contractsRepository, 'findOne').mockResolvedValueOnce(null);

      const mockPersonResult: BeneficiaryVerificationResult = {
        mode: 'BY_BENEFICIARY',
        person: {
          id: 'p-1',
          name: 'Carlos Ruiz',
          typeIdentityCard: TypeIdentityCard.V,
          identityCard: '12345678',
          status: PersonStatus.ACTIVE,
        },
        contracts: [],
        hasActiveContract: false,
        hasSuspendedContract: false,
      };

      const spy = jest
        .spyOn(service, 'verifyPersonAffiliation')
        .mockResolvedValue(mockPersonResult);

      const result = await service.verifyUnified('V-12345678');

      expect(spy).toHaveBeenCalledWith(TypeIdentityCard.V, '12345678');
      expect(result.mode).toBe('BY_BENEFICIARY');
    });

    it('should throw NotFoundException if neither contract nor person is found', async () => {
      jest.spyOn(contractsRepository, 'findOne').mockResolvedValueOnce(null);
      jest.spyOn(service, 'verifyPersonAffiliation').mockRejectedValue(new NotFoundException());

      await expect(service.verifyUnified('Z-99999999')).rejects.toThrow(NotFoundException);
    });
  });
});
