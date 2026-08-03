import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { InvoiceGenerationService } from '../services/invoice-generation.service';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { Contract, ContractStatus } from '../../../contracts/entities/contract.entity';
import { INVOICE_CREATED } from '../events/invoice.events';
import { PersonStatus } from '../../../persons/entities/person.entity';
import { requestContextStorage } from '../../../common/context/request-context';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeContract(overrides: Record<string, unknown> = {}): Contract {
  return {
    id: 'contract-1',
    status: ContractStatus.ACTIVE,
    retentionPercentage: 0,
    contractPersons: [
      {
        role: 'AFILIADO',
        person: {
          id: 'person-1',
          name: 'Juan Pérez',
          status: PersonStatus.ACTIVE,
          plan: { id: 'plan-1', name: 'Plan Básico', amount: 50 },
        },
      },
    ],
    ...overrides,
  } as unknown as Contract;
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
    create: jest.Mock;
    save: jest.Mock;
  };
}

async function withContext<T>(mockQr: unknown, fn: () => Promise<T>): Promise<T> {
  return requestContextStorage.run(
    { queryRunner: mockQr as unknown as QueryRunner, requestId: 'test-gen', startTime: Date.now() },
    fn,
  );
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('InvoiceGenerationService', () => {
  let service: InvoiceGenerationService;
  let invoiceRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let contractRepo: { findOne: jest.Mock };
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let mockQr: MockQueryRunner;

  beforeEach(async () => {
    const savedInvoice = {
      id: 'inv-1',
      status: InvoiceStatus.PENDING,
      billingMonth: '2025-02',
    } as Invoice;

    const mockInvoiceRepo = {
      findOne: jest.fn(),
      create: jest.fn().mockReturnValue(savedInvoice),
      save: jest.fn().mockResolvedValue(savedInvoice),
    };

    const mockContractRepo = {
      findOne: jest.fn(),
    };

    const mockEventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoiceGenerationService,
        {
          provide: getRepositoryToken(Invoice),
          useValue: mockInvoiceRepo,
        },
        {
          provide: getRepositoryToken(Contract),
          useValue: mockContractRepo,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
      ],
    }).compile();

    service = module.get<InvoiceGenerationService>(InvoiceGenerationService);
    invoiceRepo = module.get(getRepositoryToken(Invoice));
    contractRepo = module.get(getRepositoryToken(Contract));
    eventEmitter = module.get(EventEmitter2) as jest.Mocked<EventEmitter2>;

    // QR mock que simula la transacción
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
          if (name === 'Contract') return contractRepo;
          return { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
        }),
        create: jest.fn().mockReturnValue({}),
        save: jest.fn().mockResolvedValue({}),
      },
    };
  });

  // ─── Validaciones (pre-QR — no necesitan contexto ALS) ───────────────────────

  describe('validaciones de entrada', () => {
    it('lanza NotFoundException si el contrato no existe', async () => {
      contractRepo.findOne.mockResolvedValue(null);

      await expect(service.generateInvoiceForContract('contract-not-found')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza BadRequestException si el contrato no está activo', async () => {
      contractRepo.findOne.mockResolvedValue(makeContract({ status: ContractStatus.INACTIVE }));

      await expect(service.generateInvoiceForContract('contract-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza BadRequestException si ya existe factura para ese mes', async () => {
      contractRepo.findOne.mockResolvedValue(makeContract());
      invoiceRepo.findOne.mockResolvedValue({ id: 'existing-inv' } as Invoice);

      await expect(service.generateInvoiceForContract('contract-1', '2025-02')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza BadRequestException si no hay afiliados activos', async () => {
      contractRepo.findOne.mockResolvedValue(makeContract({ contractPersons: [] }));
      invoiceRepo.findOne.mockResolvedValue(null);

      await expect(service.generateInvoiceForContract('contract-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza BadRequestException si un afiliado no tiene plan', async () => {
      contractRepo.findOne.mockResolvedValue(
        makeContract({
          contractPersons: [
            {
              role: 'AFILIADO',
              person: {
                id: 'p1',
                name: 'Sin Plan',
                status: PersonStatus.ACTIVE,
                plan: null,
              },
            },
          ],
        }),
      );
      invoiceRepo.findOne.mockResolvedValue(null);

      await expect(service.generateInvoiceForContract('contract-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── Flujo feliz (necesita contexto ALS para getQueryRunner()) ────────────────

  describe('emisión de evento invoice.created', () => {
    it('emite el evento INVOICE_CREATED tras el commit', async () => {
      const contract = makeContract();
      const savedInvoice = { id: 'inv-1', status: InvoiceStatus.PENDING } as Invoice;

      contractRepo.findOne.mockResolvedValue(contract);
      invoiceRepo.findOne.mockResolvedValueOnce(null); // sin factura previa
      invoiceRepo.create.mockReturnValue(savedInvoice);
      invoiceRepo.save.mockResolvedValue(savedInvoice);
      // Reload post-commit con relaciones
      invoiceRepo.findOne.mockResolvedValueOnce({ ...savedInvoice, lines: [], payments: [] });

      await withContext(mockQr, () => service.generateInvoiceForContract('contract-1', '2025-02'));

      // Esperar a que se procese el setImmediate() post-commit
      await new Promise((resolve) => setImmediate(resolve));

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        INVOICE_CREATED,
        expect.objectContaining({
          invoiceId: savedInvoice.id,
          contractId: contract.id,
        }),
      );
    });
  });
});
