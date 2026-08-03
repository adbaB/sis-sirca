import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { InvoiceLineService } from '../services/invoice-line.service';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { InvoiceLine } from '../entities/invoice-line.entity';
import { InvoiceLineCategory } from '../enums/invoice-line-category.enum';
import { InvoiceQueryRepository } from '../repositories/invoice-query.repository';
import { InvoiceCalculationService } from '../services/invoice-calculation.service';
import { requestContextStorage } from '../../../common/context/request-context';

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
    contract: { id: 'contract-1' } as unknown as Invoice['contract'],
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

function makeInvoiceLine(overrides: Partial<InvoiceLine> = {}): InvoiceLine {
  return {
    id: 'line-1',
    category: InvoiceLineCategory.COMISION,
    description: 'Comisión del asesor',
    amount: 20,
    quantity: 1,
    isProjectable: false,
    deletedAt: null,
    ...overrides,
  } as InvoiceLine;
}

interface MockQueryRunner {
  isTransactionActive: boolean;
  connect: jest.Mock;
  startTransaction: jest.Mock;
  commitTransaction: jest.Mock;
  rollbackTransaction: jest.Mock;
  release: jest.Mock;
  manager: {
    getRepository: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softRemove: jest.Mock;
  };
}

/**
 * Ejecuta una función dentro de un contexto ALS simulado con un QueryRunner mock.
 * Permite testear métodos @Transactional que llaman a getQueryRunner() sin BD real.
 */
async function withContext<T>(mockQr: unknown, fn: () => Promise<T>): Promise<T> {
  return requestContextStorage.run(
    {
      queryRunner: mockQr as unknown as QueryRunner,
      requestId: 'test-context',
      startTime: Date.now(),
    },
    fn,
  );
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('InvoiceLineService', () => {
  let service: InvoiceLineService;
  let invoiceRepo: { findOne: jest.Mock; save: jest.Mock };
  let invoiceLineRepo: { findOne: jest.Mock; softRemove: jest.Mock; save: jest.Mock };
  let queryRepo: jest.Mocked<InvoiceQueryRepository>;
  let mockQr: MockQueryRunner;

  beforeEach(async () => {
    const mockInvoiceRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    };

    const mockInvoiceLineRepo = {
      findOne: jest.fn(),
      softRemove: jest.fn().mockResolvedValue({}),
      save: jest.fn().mockResolvedValue({}),
    };

    const mockQueryRepo: Partial<InvoiceQueryRepository> = {
      sumBaseLines: jest.fn().mockResolvedValue(0),
      sumAdditionalLines: jest.fn().mockResolvedValue(0),
      sumCompletedPayments: jest.fn().mockResolvedValue(0),
    };

    const mockCalculationService: Partial<InvoiceCalculationService> = {
      recalculateInvoicePaidAmount: jest.fn().mockResolvedValue(undefined),
    };

    const mockDataSource = {
      manager: {},
      getRepository: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoiceLineService,
        { provide: getRepositoryToken(Invoice), useValue: mockInvoiceRepo },
        { provide: getRepositoryToken(InvoiceLine), useValue: mockInvoiceLineRepo },
        { provide: DataSource, useValue: mockDataSource },
        { provide: InvoiceQueryRepository, useValue: mockQueryRepo },
        { provide: InvoiceCalculationService, useValue: mockCalculationService },
      ],
    }).compile();

    service = module.get<InvoiceLineService>(InvoiceLineService);
    invoiceRepo = module.get(getRepositoryToken(Invoice));
    invoiceLineRepo = module.get(getRepositoryToken(InvoiceLine));
    queryRepo = module.get(InvoiceQueryRepository) as jest.Mocked<InvoiceQueryRepository>;

    // Mock de QueryRunner que simula el contexto transaccional
    mockQr = {
      isTransactionActive: false,
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockImplementation(() => {
        mockQr.isTransactionActive = true;
        return Promise.resolve();
      }),
      commitTransaction: jest.fn().mockImplementation(() => {
        mockQr.isTransactionActive = false;
        return Promise.resolve();
      }),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {
        getRepository: jest.fn().mockImplementation((entity: { name?: string }) => {
          const name = entity?.name ?? String(entity);
          if (name === 'Invoice') return invoiceRepo;
          if (name === 'InvoiceLine') return invoiceLineRepo;
          return { findOne: jest.fn(), save: jest.fn(), softRemove: jest.fn() };
        }),
        findOne: jest.fn(),
        create: jest.fn().mockReturnValue({}),
        save: jest.fn().mockResolvedValue({}),
        softRemove: jest.fn().mockResolvedValue({}),
      },
    };
  });

  // ─── addAdditionalCharge ────────────────────────────────────────────────────

  describe('addAdditionalCharge', () => {
    it('lanza BadRequestException si la categoría es MENSUALIDAD (validación pre-QR)', async () => {
      // Esta validación ocurre ANTES de getQueryRunner(), no necesita contexto
      invoiceRepo.findOne.mockResolvedValue(makeInvoice());

      await expect(
        service.addAdditionalCharge('inv-1', {
          // @ts-expect-error — prueba de la validación en runtime
          category: InvoiceLineCategory.MENSUALIDAD,
          description: 'Test',
          amount: 10,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza NotFoundException si la factura no existe (validación pre-QR)', async () => {
      // Esta validación ocurre ANTES de getQueryRunner(), no necesita contexto
      invoiceRepo.findOne.mockResolvedValue(null);

      await expect(
        service.addAdditionalCharge('inv-999', {
          category: InvoiceLineCategory.COMISION,
          description: 'Comisión',
          amount: 10,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('lanza BadRequestException si la factura está CANCELADA (validación pre-QR)', async () => {
      // Esta validación ocurre ANTES de getQueryRunner(), no necesita contexto
      invoiceRepo.findOne.mockResolvedValue(makeInvoice({ status: InvoiceStatus.CANCELLED }));

      await expect(
        service.addAdditionalCharge('inv-1', {
          category: InvoiceLineCategory.COMISION,
          description: 'Comisión',
          amount: 10,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('recalcula totalAmount = baseAmount + adicionales al agregar cargo', async () => {
      const invoice = makeInvoice({ baseAmount: 100, totalAmount: 100 });

      // La pre-validación usa invoiceRepository.findOne directamente
      invoiceRepo.findOne
        .mockResolvedValueOnce(invoice) // pre-check (validación pre-QR)
        .mockResolvedValueOnce(invoice) // lock pessimistic dentro de la tx
        .mockResolvedValueOnce({ ...invoice, lines: [{}] }); // reload relaciones

      invoiceLineRepo.save.mockResolvedValue({});
      queryRepo.sumAdditionalLines.mockResolvedValue(20);

      await withContext(mockQr, () =>
        service.addAdditionalCharge('inv-1', {
          category: InvoiceLineCategory.COMISION,
          description: 'Comisión',
          amount: 20,
        }),
      );

      expect(invoiceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ totalAmount: 120 }), // 100 base + 20 adicional
      );
    });
  });

  // ─── removeAdditionalCharge ─────────────────────────────────────────────────

  describe('removeAdditionalCharge', () => {
    it('lanza NotFoundException si la factura no existe (validación pre-QR)', async () => {
      // Esta validación ocurre ANTES de getQueryRunner(), no necesita contexto
      invoiceRepo.findOne.mockResolvedValue(null);

      await expect(service.removeAdditionalCharge('inv-999', 'line-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza NotFoundException si la línea no existe en la factura', async () => {
      const invoice = makeInvoice();
      invoiceRepo.findOne.mockResolvedValue(invoice);
      mockQr.manager.findOne.mockResolvedValue(null);

      let caught: Error | null = null;
      await withContext(mockQr, () => service.removeAdditionalCharge('inv-1', 'line-999')).catch(
        (e) => {
          caught = e;
        },
      );

      expect(caught).toBeInstanceOf(NotFoundException);
    });

    it('lanza BadRequestException al intentar eliminar una línea MENSUALIDAD', async () => {
      const invoice = makeInvoice();
      invoiceRepo.findOne.mockResolvedValue(invoice);
      mockQr.manager.findOne.mockResolvedValue(
        makeInvoiceLine({ category: InvoiceLineCategory.MENSUALIDAD }),
      );

      let caught: Error | null = null;
      await withContext(mockQr, () => service.removeAdditionalCharge('inv-1', 'line-1')).catch(
        (e) => {
          caught = e;
        },
      );

      expect(caught).toBeInstanceOf(BadRequestException);
    });

    it('hace soft-delete de la línea y recalcula totalAmount al baseAmount', async () => {
      const invoice = makeInvoice({ baseAmount: 100, totalAmount: 120, paidAmount: 0 });
      invoiceRepo.findOne
        .mockResolvedValueOnce(invoice) // pre-check (validación pre-QR)
        .mockResolvedValueOnce(invoice) // lock pessimistic dentro de la tx
        .mockResolvedValueOnce({ ...invoice, lines: [] }); // reload

      mockQr.manager.findOne.mockResolvedValue(makeInvoiceLine());
      mockQr.manager.softRemove.mockResolvedValue({});
      queryRepo.sumAdditionalLines.mockResolvedValue(0); // sin cargos tras eliminar

      await withContext(mockQr, () => service.removeAdditionalCharge('inv-1', 'line-1'));

      expect(mockQr.manager.softRemove).toHaveBeenCalled();
      expect(invoiceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ totalAmount: 100 }), // vuelve al baseAmount
      );
    });
  });
});
