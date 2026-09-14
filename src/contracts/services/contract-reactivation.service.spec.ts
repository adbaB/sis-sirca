import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ContractReactivationService } from './contract-reactivation.service';
import { Contract, ContractStatus } from '../entities/contract.entity';
import { Invoice, InvoiceStatus } from '../../billing/invoices/entities/invoice.entity';
import { Payment, PaymentStatus } from '../../billing/payments/entities/payment.entity';
import { Role } from '../../roles/entities/role.entity';
import { OVERRIDE_REACTIVATION_PERMISSION } from '../constants/contract.constants';
import type { JwtPayload } from '../../auth/guards/auth.guard';

describe('ContractReactivationService', () => {
  let service: ContractReactivationService;
  let mockEntityManager: Partial<EntityManager>;
  let mockContractRepo: Partial<Repository<Contract>>;
  let mockInvoiceRepo: Partial<Repository<Invoice>>;
  let mockRoleRepo: Partial<Repository<Role>>;

  beforeEach(async () => {
    mockContractRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((c) => Promise.resolve(c)),
    };

    mockInvoiceRepo = {
      find: jest.fn(),
      count: jest.fn(),
    };

    mockRoleRepo = {
      findOne: jest.fn(),
    };

    mockEntityManager = {
      getRepository: jest.fn().mockImplementation((entity) => {
        if (entity === Contract) return mockContractRepo;
        if (entity === Invoice) return mockInvoiceRepo;
        if (entity === Role) return mockRoleRepo;
        return {};
      }),
      find: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractReactivationService,
        {
          provide: DataSource,
          useValue: {
            manager: mockEntityManager,
          },
        },
      ],
    }).compile();

    service = module.get<ContractReactivationService>(ContractReactivationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('syncReactivationEligibility', () => {
    it('should return null if contract is not found', async () => {
      (mockContractRepo.findOne as jest.Mock).mockResolvedValue(null);

      const result = await service.syncReactivationEligibility('c-1');
      expect(result).toBeNull();
    });

    it('should return null if contract is not SUSPENDED', async () => {
      (mockContractRepo.findOne as jest.Mock).mockResolvedValue({
        id: 'c-1',
        status: ContractStatus.ACTIVE,
      });

      const result = await service.syncReactivationEligibility('c-1');
      expect(result).toBeNull();
    });

    it('should clear reactivationEligibleAt and return null if contract has no invoices', async () => {
      const contract = {
        id: 'c-1',
        status: ContractStatus.SUSPENDED,
        reactivationEligibleAt: new Date(),
      };
      (mockContractRepo.findOne as jest.Mock).mockResolvedValue(contract);
      (mockEntityManager.find as jest.Mock).mockResolvedValue([]);

      const result = await service.syncReactivationEligibility('c-1');
      expect(result).toBeNull();
      expect(contract.reactivationEligibleAt).toBeNull();
      expect(mockContractRepo.save).toHaveBeenCalledWith(contract);
    });

    it('should clear reactivationEligibleAt and return null if contract has overdue debt not covered', async () => {
      const contract = {
        id: 'c-1',
        status: ContractStatus.SUSPENDED,
        reactivationEligibleAt: new Date(),
      };
      const overdueInvoice = {
        id: 'inv-1',
        status: InvoiceStatus.PENDING,
        dueDate: '2020-01-01',
        totalAmount: 100,
        paidAmount: 0,
        retentionAmount: 0,
        payments: [],
      } as unknown as Invoice;

      (mockContractRepo.findOne as jest.Mock).mockResolvedValue(contract);
      (mockEntityManager.find as jest.Mock).mockResolvedValue([overdueInvoice]);

      const result = await service.syncReactivationEligibility('c-1');
      expect(result).toBeNull();
      expect(contract.reactivationEligibleAt).toBeNull();
      expect(mockContractRepo.save).toHaveBeenCalledWith(contract);
    });

    it('should set reactivationEligibleAt to 7 days from latest payment operationDate when debt covered', async () => {
      const contract = {
        id: 'c-1',
        status: ContractStatus.SUSPENDED,
        reactivationEligibleAt: null,
      };
      const overdueInvoice = {
        id: 'inv-1',
        status: InvoiceStatus.PENDING,
        dueDate: '2020-01-01',
        totalAmount: 100,
        paidAmount: 0,
        retentionAmount: 0,
        payments: [
          {
            id: 'pay-1',
            status: PaymentStatus.PROCESSING,
            amount: 100,
            operationDate: '2026-08-01',
            deletedAt: null,
          } as unknown as Payment,
        ],
      } as unknown as Invoice;

      (mockContractRepo.findOne as jest.Mock).mockResolvedValue(contract);
      (mockEntityManager.find as jest.Mock).mockResolvedValue([overdueInvoice]);

      const result = await service.syncReactivationEligibility('c-1');
      expect(result).toBeInstanceOf(Date);
      expect(mockContractRepo.save).toHaveBeenCalledWith(contract);
    });
  });

  describe('validateReactivationEligibility', () => {
    const suspendedContract = {
      id: 'c-1',
      code: 'SIR-001',
      status: ContractStatus.SUSPENDED,
      reactivationEligibleAt: new Date('2020-01-01'), // Cooldown expired in past
    } as Contract;

    it('should pass without error if contract has no overdue debt and cooldown has expired', async () => {
      (mockInvoiceRepo.find as jest.Mock).mockResolvedValue([]);

      await expect(
        service.validateReactivationEligibility(suspendedContract),
      ).resolves.not.toThrow();
    });

    it('should throw BadRequestException if contract has overdue debt and user has no override permission', async () => {
      const overdueInvoice = {
        id: 'inv-1',
        status: InvoiceStatus.PENDING,
        dueDate: '2020-01-01',
        totalAmount: 100,
        paidAmount: 0,
        retentionAmount: 0,
        payments: [],
      } as unknown as Invoice;

      (mockInvoiceRepo.find as jest.Mock).mockResolvedValue([overdueInvoice]);

      await expect(service.validateReactivationEligibility(suspendedContract)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if cooldown is still active and user has no override permission', async () => {
      const contractInCooldown = {
        ...suspendedContract,
        reactivationEligibleAt: new Date('2099-01-01'),
      } as Contract;

      (mockInvoiceRepo.find as jest.Mock).mockResolvedValue([]);

      await expect(service.validateReactivationEligibility(contractInCooldown)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if user has override permission but fails to provide reason', async () => {
      const contractInCooldown = {
        ...suspendedContract,
        reactivationEligibleAt: new Date('2099-01-01'),
      } as Contract;

      (mockInvoiceRepo.find as jest.Mock).mockResolvedValue([]);
      (mockRoleRepo.findOne as jest.Mock).mockResolvedValue({
        id: 'role-admin',
        permissions: [{ name: OVERRIDE_REACTIVATION_PERMISSION }],
      });

      const user = { userId: 'u-1', roleId: 'role-admin' } as unknown as JwtPayload;

      await expect(
        service.validateReactivationEligibility(contractInCooldown, { reason: '' }, user),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow bypass if user has override permission and provides a valid reason', async () => {
      const contractInCooldown = {
        ...suspendedContract,
        reactivationEligibleAt: new Date('2099-01-01'),
      } as Contract;

      (mockInvoiceRepo.find as jest.Mock).mockResolvedValue([]);
      (mockRoleRepo.findOne as jest.Mock).mockResolvedValue({
        id: 'role-admin',
        permissions: [{ name: OVERRIDE_REACTIVATION_PERMISSION }],
      });

      const user = { userId: 'u-1', roleId: 'role-admin' } as unknown as JwtPayload;

      await expect(
        service.validateReactivationEligibility(
          contractInCooldown,
          { reason: 'Excepción autorizada por gerencia médica' },
          user,
        ),
      ).resolves.not.toThrow();
    });
  });
});
