import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { InvoiceService } from '../../billing/invoices/services/invoice.service';
import { Person, PersonStatus, TypeIdentityCard } from '../../persons/entities/person.entity';
import { PersonsService } from '../../persons/services/persons.service';
import { CreateBeneficiaryDto } from '../dto/create-beneficiary.dto';
import { AffiliationHistory } from '../entities/affiliation-history.entity';
import { ContractPerson, PersonRole } from '../entities/contract-person.entity';
import { Contract } from '../entities/contract.entity';
import { ContractAffiliationService } from '../services/contract-affiliation.service';

describe('ContractAffiliationService', () => {
  let service: ContractAffiliationService;
  let contractsRepository: jest.Mocked<Repository<Contract>>;
  let contractPersonsRepository: jest.Mocked<Repository<ContractPerson>>;
  let personsService: jest.Mocked<PersonsService>;
  let invoiceService: jest.Mocked<InvoiceService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractAffiliationService,
        {
          provide: getRepositoryToken(Contract),
          useValue: {
            update: jest.fn(),
            manager: {
              transaction: jest.fn(),
            },
          },
        },
        {
          provide: getRepositoryToken(ContractPerson),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest.fn(),
            manager: {
              transaction: jest.fn(),
            },
          },
        },
        {
          provide: PersonsService,
          useValue: {
            create: jest.fn(),
          },
        },
        {
          provide: InvoiceService,
          useValue: {
            removeAffiliateLineFromActiveInvoice: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ContractAffiliationService>(ContractAffiliationService);
    contractsRepository = module.get(getRepositoryToken(Contract));
    contractPersonsRepository = module.get(getRepositoryToken(ContractPerson));
    personsService = module.get(PersonsService);
    invoiceService = module.get(InvoiceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addBeneficiary', () => {
    it('should delegate to personsService.create with contractId', async () => {
      const dto: CreateBeneficiaryDto = {
        name: 'Maria',
        typeIdentityCard: TypeIdentityCard.V,
        identityCard: '12345678',
        role: PersonRole.AFILIADO,
        planId: 'plan-1',
        isBillingOwner: false,
        contractId: 'contract-1',
      };
      const mockCreated = { id: 'p-1', name: 'Maria' } as Person;
      personsService.create.mockResolvedValue(mockCreated);

      const res = await service.addBeneficiary('contract-1', dto);
      expect(personsService.create).toHaveBeenCalledWith({ ...dto, contractId: 'contract-1' });
      expect(res).toEqual(mockCreated);
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

      const mockManager = {
        getRepository: jest.fn().mockImplementation((target) => {
          if (target === AffiliationHistory) return mockHistoryRepo;
          if (target === ContractPerson) return mockCpRepo;
          if (target === Contract) return mockContractRepo;
          return {};
        }),
      };

      contractsRepository.manager.transaction = jest
        .fn()
        .mockImplementation(async (cb) => cb(mockManager as unknown as EntityManager));

      await service.removeAffiliate('cp-1');

      expect(mockHistoryRepo.save).toHaveBeenCalled();
      expect(mockCpRepo.softRemove).toHaveBeenCalledWith(mockCp);
      expect(invoiceService.removeAffiliateLineFromActiveInvoice).toHaveBeenCalledWith(
        'contract-1',
        'p-1',
        mockManager as unknown as EntityManager,
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
      contractPersonsRepository.find.mockResolvedValue([]);

      const mockEntityManager = {
        find: jest.fn().mockResolvedValue([]),
        save: jest.fn().mockResolvedValue(true),
      };

      contractPersonsRepository.manager.transaction = jest
        .fn()
        .mockImplementation(async (cb) => cb(mockEntityManager as unknown as EntityManager));

      await service.setContractTitular('contract-1', { contractPersonId: 'cp-1' });

      expect(mockEntityManager.save).toHaveBeenCalled();
      expect(contractsRepository.update).toHaveBeenCalled();
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

      const mockEntityManager = {
        update: jest.fn().mockResolvedValue(true),
        save: jest.fn().mockResolvedValue(true),
      };

      contractPersonsRepository.manager.transaction = jest
        .fn()
        .mockImplementation(async (cb) => cb(mockEntityManager as unknown as EntityManager));

      await service.setBillingOwner('contract-1', { contractPersonId: 'cp-1' });

      expect(mockEntityManager.update).toHaveBeenCalled();
      expect(mockTarget.isBillingOwner).toBe(true);
      expect(mockEntityManager.save).toHaveBeenCalledWith(ContractPerson, mockTarget);
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
