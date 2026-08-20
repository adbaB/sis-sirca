import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { InvoiceCalculationService } from '../services/invoice-calculation.service';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { InvoiceQueryRepository } from '../repositories/invoice-query.repository';
import { ExchangeRateService } from '../../../exchange-rate/services/exchange-rate.service';
import { ExchangeRate } from '../../../exchange-rate/entities/Exchange-rate.entity';
import { Contract } from 'src/contracts/entities/contract.entity';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-1',
    billingMonth: '2025-01',
    totalAmount: 100,
    paidAmount: 0,
    baseAmount: 100,
    retentionAmount: 0,
    retentionPercentage: 0,
    status: InvoiceStatus.PENDING,
    contract: { id: 'contract-1', retentionPercentage: 0 } as unknown as Invoice['contract'],
    lines: [],
    payments: [],
    issueDate: new Date(),
    dueDate: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  } as Invoice;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('InvoiceCalculationService', () => {
  let service: InvoiceCalculationService;
  let invoiceRepo: jest.Mocked<Repository<Invoice>>;
  let queryRepo: jest.Mocked<InvoiceQueryRepository>;
  let exchangeRateService: jest.Mocked<ExchangeRateService>;

  beforeEach(async () => {
    const mockInvoiceRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const mockQueryRepo = {
      sumBaseLines: jest.fn(),
      sumAdditionalLines: jest.fn(),
      sumCompletedPayments: jest.fn(),
    };

    const mockExchangeRateService = {
      getExchangeRateByDate: jest.fn(),
    };

    const mockDataSource = {
      manager: {} as EntityManager,
      getRepository: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoiceCalculationService,
        {
          provide: getRepositoryToken(Invoice),
          useValue: mockInvoiceRepo,
        },
        {
          provide: InvoiceQueryRepository,
          useValue: mockQueryRepo,
        },
        {
          provide: ExchangeRateService,
          useValue: mockExchangeRateService,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<InvoiceCalculationService>(InvoiceCalculationService);
    invoiceRepo = module.get(getRepositoryToken(Invoice));
    queryRepo = module.get(InvoiceQueryRepository);
    exchangeRateService = module.get(ExchangeRateService);
  });

  // ─── recalculateInvoicePaidAmount ────────────────────────────────────────────

  describe('recalculateInvoicePaidAmount', () => {
    it('marca la factura como PAID cuando paidAmount >= amountDue', async () => {
      const invoice = makeInvoice({ totalAmount: 100, paidAmount: 0, retentionAmount: 0 });
      invoiceRepo.findOne.mockResolvedValue(invoice);
      queryRepo.sumCompletedPayments.mockResolvedValue(100);
      invoiceRepo.save.mockResolvedValue({ ...invoice, status: InvoiceStatus.PAID });

      await service.recalculateInvoicePaidAmount('inv-1');

      expect(invoiceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          paidAmount: 100,
          status: InvoiceStatus.PAID,
        }),
      );
    });

    it('marca la factura como PARTIAL cuando 0 < paidAmount < totalAmount', async () => {
      const invoice = makeInvoice({ totalAmount: 100, paidAmount: 0, retentionAmount: 0 });
      invoiceRepo.findOne.mockResolvedValue(invoice);
      queryRepo.sumCompletedPayments.mockResolvedValue(50);

      await service.recalculateInvoicePaidAmount('inv-1');

      expect(invoiceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          paidAmount: 50,
          status: InvoiceStatus.PARTIAL,
        }),
      );
    });

    it('marca la factura como PENDING cuando no hay pagos', async () => {
      const invoice = makeInvoice({ totalAmount: 100, paidAmount: 0, retentionAmount: 0 });
      invoiceRepo.findOne.mockResolvedValue(invoice);
      queryRepo.sumCompletedPayments.mockResolvedValue(0);

      await service.recalculateInvoicePaidAmount('inv-1');

      expect(invoiceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          paidAmount: 0,
          status: InvoiceStatus.PENDING,
        }),
      );
    });

    it('limita paidAmount al totalAmount (previene overpayment en BD)', async () => {
      const invoice = makeInvoice({ totalAmount: 100, paidAmount: 0, retentionAmount: 0 });
      invoiceRepo.findOne.mockResolvedValue(invoice);
      queryRepo.sumCompletedPayments.mockResolvedValue(150); // más de lo que debe

      await service.recalculateInvoicePaidAmount('inv-1');

      expect(invoiceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ paidAmount: 100 }), // capped
      );
    });

    it('no lanza error si la factura no existe (solo log de advertencia)', async () => {
      invoiceRepo.findOne.mockResolvedValue(null);

      await expect(service.recalculateInvoicePaidAmount('inv-999')).resolves.toBeUndefined();
      expect(invoiceRepo.save).not.toHaveBeenCalled();
    });

    it('usa el EntityManager provisto si se pasa como parámetro', async () => {
      const mockManager = {
        getRepository: jest.fn().mockReturnValue(invoiceRepo),
      } as unknown as EntityManager;

      const invoice = makeInvoice();
      invoiceRepo.findOne.mockResolvedValue(invoice);
      queryRepo.sumCompletedPayments.mockResolvedValue(0);

      await service.recalculateInvoicePaidAmount('inv-1', mockManager);

      expect(mockManager.getRepository).toHaveBeenCalledWith(Invoice);
    });
  });

  // ─── calculateAmountByInvoicesIds ────────────────────────────────────────────

  describe('calculateAmountByInvoicesIds', () => {
    it('retorna 0 cuando no se pasan ids', async () => {
      const result = await service.calculateAmountByInvoicesIds([], 'efectivo');
      expect(result).toBe(0);
    });

    it('retorna suma de (totalAmount - paidAmount) para método efectivo', async () => {
      const mockQb = {
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest
          .fn()
          .mockResolvedValue([
            makeInvoice({ totalAmount: 100, paidAmount: 30 }),
            makeInvoice({ id: 'inv-2', totalAmount: 200, paidAmount: 50 }),
          ]),
      };
      invoiceRepo.createQueryBuilder = jest.fn().mockReturnValue(mockQb);

      const result = await service.calculateAmountByInvoicesIds(['inv-1', 'inv-2'], 'efectivo');

      expect(result).toBe(220); // (100-30) + (200-50)
    });

    it('convierte a Bs cuando el método es transferencia', async () => {
      const mockQb = {
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([makeInvoice({ totalAmount: 100, paidAmount: 0 })]),
      };
      invoiceRepo.createQueryBuilder = jest.fn().mockReturnValue(mockQb);
      exchangeRateService.getExchangeRateByDate.mockResolvedValue({
        rateUsd: 40,
      } as unknown as ExchangeRate);

      const result = await service.calculateAmountByInvoicesIds(['inv-1'], 'transferencia');

      expect(result).toBe(4000); // 100 * 40
    });

    it('lanza BadRequestException si no hay tasa de cambio para transferencia', async () => {
      const mockQb = {
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([makeInvoice({ totalAmount: 100, paidAmount: 0 })]),
      };
      invoiceRepo.createQueryBuilder = jest.fn().mockReturnValue(mockQb);
      exchangeRateService.getExchangeRateByDate.mockResolvedValue(null);

      await expect(service.calculateAmountByInvoicesIds(['inv-1'], 'pago_movil')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── recalculateInvoiceAmountFromContract ──────────────────────────────────

  describe('recalculateInvoiceAmountFromContract', () => {
    it('lanza NotFoundException si la factura no existe', async () => {
      const mockManager = {
        getRepository: jest.fn().mockReturnValue({
          findOne: jest.fn().mockResolvedValue(null),
        }),
      } as unknown as EntityManager;

      await expect(
        service.recalculateInvoiceAmountFromContract('inv-999', mockManager),
      ).rejects.toThrow();
    });

    it('lanza BadRequestException si la factura está en estado PAID', async () => {
      const invoice = makeInvoice({ status: InvoiceStatus.PAID });
      const mockManager = {
        getRepository: jest.fn().mockReturnValue({
          findOne: jest.fn().mockResolvedValue(invoice),
        }),
      } as unknown as EntityManager;

      await expect(
        service.recalculateInvoiceAmountFromContract('inv-1', mockManager),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si la factura está en estado CANCELLED', async () => {
      const invoice = makeInvoice({ status: InvoiceStatus.CANCELLED });
      const mockManager = {
        getRepository: jest.fn().mockReturnValue({
          findOne: jest.fn().mockResolvedValue(invoice),
        }),
      } as unknown as EntityManager;

      await expect(
        service.recalculateInvoiceAmountFromContract('inv-1', mockManager),
      ).rejects.toThrow(BadRequestException);
    });

    it('sincroniza las líneas con el nuevo plan y recalcula montos en factura PENDING', async () => {
      const oldPlan = { id: 'plan-1', name: 'Plan Bronce', amount: 30 };
      const newPlan = { id: 'plan-2', name: 'Plan Oro', amount: 50 };
      const person = { id: 'person-1', name: 'Juan Perez', status: 'ACTIVE' };

      const contractPerson = {
        id: 'cp-1',
        role: 'AFILIADO',
        person,
        plan: newPlan,
        deletedAt: null,
      };

      const line = {
        id: 'line-1',
        category: 'MENSUALIDAD',
        description: 'Juan Perez - Plan Bronce',
        amount: 30,
        person,
        plan: oldPlan,
        deletedAt: null,
      };

      const invoice = makeInvoice({
        status: InvoiceStatus.PENDING,
        baseAmount: 30,
        totalAmount: 30,
        contract: { id: 'contract-1', retentionPercentage: 0 } as unknown as Contract,
      });

      const mockInvoiceRepo = {
        findOne: jest
          .fn()
          .mockResolvedValueOnce(invoice)
          .mockResolvedValueOnce(invoice)
          .mockResolvedValueOnce({
            ...invoice,
            baseAmount: 50,
            totalAmount: 50,
            lines: [line],
          }),
        save: jest.fn().mockResolvedValue(invoice),
      };

      const mockLineRepo = {
        find: jest.fn().mockResolvedValue([line]),
        save: jest.fn().mockImplementation(async (l) => l),
      };

      const mockCpRepo = {
        find: jest.fn().mockResolvedValue([contractPerson]),
      };

      const mockManager = {
        getRepository: jest.fn().mockImplementation((entity) => {
          if (entity.name === 'Invoice' || entity === Invoice) return mockInvoiceRepo;
          if (entity.name === 'InvoiceLine') return mockLineRepo;
          return mockCpRepo;
        }),
      } as unknown as EntityManager;

      queryRepo.sumBaseLines.mockResolvedValue(50);
      queryRepo.sumAdditionalLines.mockResolvedValue(0);
      queryRepo.sumCompletedPayments.mockResolvedValue(0);

      const result = await service.recalculateInvoiceAmountFromContract('inv-1', mockManager);

      expect(mockLineRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 50,
          description: 'Juan Perez - Plan Oro',
          plan: newPlan,
        }),
      );
      expect(mockInvoiceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          baseAmount: 50,
          totalAmount: 50,
        }),
      );
      expect(result).toBeDefined();
    });
  });
});
