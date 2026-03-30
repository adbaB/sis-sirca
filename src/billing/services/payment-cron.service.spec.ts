import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Payment, PaymentStatus } from '../entities/payment.entity';
import { GoogleSheetsService } from '../../google/services/google-sheets.service';
import { PaymentCronService } from './payment-cron.service';
import { BillingService } from './billing.service';

describe('PaymentCronService', () => {
  let service: PaymentCronService;

  const mockPaymentRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const mockGoogleSheetsService = {
    readRows: jest.fn(),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  const mockBillingService = {
    recalculateInvoicePaidAmount: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentCronService,
        { provide: getRepositoryToken(Payment), useValue: mockPaymentRepository },
        { provide: GoogleSheetsService, useValue: mockGoogleSheetsService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: BillingService, useValue: mockBillingService },
      ],
    }).compile();

    service = module.get<PaymentCronService>(PaymentCronService);
    jest.clearAllMocks();
  });

  const makeRow = (referencia: string, estado: string): string[] => [
    '01/01/2026',
    '12:00:00',
    referencia,
    '100',
    '360',
    'http://url',
    estado,
  ];

  const makePayment = (status: PaymentStatus): Payment =>
    ({
      id: 'payment-uuid',
      referenceNumber: 'REF-001',
      status,
      invoice: { id: 'invoice-uuid' },
    }) as unknown as Payment;

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should do nothing when the sheet is empty', async () => {
    mockGoogleSheetsService.readRows.mockResolvedValue([]);
    await service.checkPaymentStatusTransitions();
    expect(mockPaymentRepository.findOne).not.toHaveBeenCalled();
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    expect(mockBillingService.recalculateInvoicePaidAmount).not.toHaveBeenCalled();
  });

  it('should skip "Pendiente" rows without querying the DB', async () => {
    mockGoogleSheetsService.readRows.mockResolvedValue([makeRow('REF-001', 'Pendiente')]);
    await service.checkPaymentStatusTransitions();
    expect(mockPaymentRepository.findOne).not.toHaveBeenCalled();
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    expect(mockBillingService.recalculateInvoicePaidAmount).not.toHaveBeenCalled();
  });

  it('should log a warning and skip rows with an unknown status', async () => {
    mockGoogleSheetsService.readRows.mockResolvedValue([makeRow('REF-001', 'EnRevisión')]);
    const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation(() => {});
    await service.checkPaymentStatusTransitions();
    expect(mockPaymentRepository.findOne).not.toHaveBeenCalled();
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('EnRevisión'));
    warnSpy.mockRestore();
  });

  it('should skip and warn when no Payment record matches the reference', async () => {
    mockGoogleSheetsService.readRows.mockResolvedValue([makeRow('REF-999', 'Aprobado')]);
    mockPaymentRepository.findOne.mockResolvedValue(null);
    const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation(() => {});
    await service.checkPaymentStatusTransitions();
    expect(mockPaymentRepository.save).not.toHaveBeenCalled();
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    expect(mockBillingService.recalculateInvoicePaidAmount).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('REF-999'));
    warnSpy.mockRestore();
  });

  // ── Aprobado ────────────────────────────────────────────────────────────────

  it('should persist COMPLETED, recalculate invoice, and emit payment.approved', async () => {
    const payment = makePayment(PaymentStatus.PROCESSING);
    mockGoogleSheetsService.readRows.mockResolvedValue([makeRow('REF-001', 'Aprobado')]);
    mockPaymentRepository.findOne.mockResolvedValue(payment);
    mockPaymentRepository.save.mockResolvedValue(undefined);
    mockBillingService.recalculateInvoicePaidAmount.mockResolvedValue(undefined);

    await service.checkPaymentStatusTransitions();

    expect(payment.status).toBe(PaymentStatus.COMPLETED);
    expect(mockPaymentRepository.save).toHaveBeenCalledWith(payment);
    expect(mockBillingService.recalculateInvoicePaidAmount).toHaveBeenCalledWith('invoice-uuid');
    expect(mockEventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'payment.approved',
      expect.objectContaining({ reference: 'REF-001' }),
    );
  });

  it('should skip without emitting when payment is already COMPLETED in the DB', async () => {
    mockGoogleSheetsService.readRows.mockResolvedValue([makeRow('REF-001', 'Aprobado')]);
    mockPaymentRepository.findOne.mockResolvedValue(makePayment(PaymentStatus.COMPLETED));
    await service.checkPaymentStatusTransitions();
    expect(mockPaymentRepository.save).not.toHaveBeenCalled();
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    expect(mockBillingService.recalculateInvoicePaidAmount).not.toHaveBeenCalled();
  });

  // ── Rechazado ───────────────────────────────────────────────────────────────

  it('should persist REJECTED, recalculate invoice, and emit payment.rejected', async () => {
    const payment = makePayment(PaymentStatus.PROCESSING);
    mockGoogleSheetsService.readRows.mockResolvedValue([makeRow('REF-001', 'Rechazado')]);
    mockPaymentRepository.findOne.mockResolvedValue(payment);
    mockPaymentRepository.save.mockResolvedValue(undefined);
    mockBillingService.recalculateInvoicePaidAmount.mockResolvedValue(undefined);

    await service.checkPaymentStatusTransitions();

    expect(payment.status).toBe(PaymentStatus.REJECTED);
    expect(mockPaymentRepository.save).toHaveBeenCalledWith(payment);
    expect(mockBillingService.recalculateInvoicePaidAmount).toHaveBeenCalledWith('invoice-uuid');
    expect(mockEventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'payment.rejected',
      expect.objectContaining({ reference: 'REF-001' }),
    );
  });

  it('should skip without emitting when payment is already REJECTED in the DB', async () => {
    mockGoogleSheetsService.readRows.mockResolvedValue([makeRow('REF-001', 'Rechazado')]);
    mockPaymentRepository.findOne.mockResolvedValue(makePayment(PaymentStatus.REJECTED));
    await service.checkPaymentStatusTransitions();
    expect(mockPaymentRepository.save).not.toHaveBeenCalled();
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    expect(mockBillingService.recalculateInvoicePaidAmount).not.toHaveBeenCalled();
  });

  // ── Mixed batch ─────────────────────────────────────────────────────────────

  it('should process only new transitions and recalculate each affected invoice', async () => {
    mockGoogleSheetsService.readRows.mockResolvedValue([
      makeRow('REF-001', 'Aprobado'), // new transition
      makeRow('REF-002', 'Rechazado'), // already rejected in DB
      makeRow('REF-003', 'Pendiente'), // initial state, skip
      makeRow('REF-004', 'Rechazado'), // new transition
    ]);

    mockPaymentRepository.findOne
      .mockResolvedValueOnce(makePayment(PaymentStatus.PROCESSING)) // REF-001
      .mockResolvedValueOnce(makePayment(PaymentStatus.REJECTED)) // REF-002
      .mockResolvedValueOnce(makePayment(PaymentStatus.PROCESSING)); // REF-004

    mockPaymentRepository.save.mockResolvedValue(undefined);
    mockBillingService.recalculateInvoicePaidAmount.mockResolvedValue(undefined);

    await service.checkPaymentStatusTransitions();

    expect(mockPaymentRepository.save).toHaveBeenCalledTimes(2);
    expect(mockBillingService.recalculateInvoicePaidAmount).toHaveBeenCalledTimes(2);
    expect(mockEventEmitter.emit).toHaveBeenCalledTimes(2);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'payment.approved',
      expect.objectContaining({ reference: 'REF-001' }),
    );
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'payment.rejected',
      expect.objectContaining({ reference: 'REF-004' }),
    );
  });
});
