import { Test, TestingModule } from '@nestjs/testing';
import { PaymentBillingController } from './payments-billing.controller';
import { PaymentService } from '../services/payment.service';
import { SurplusService } from '../services/surplus.service';
import { ReceiptAnalysisService } from '../services/receipt-analysis.service';
import { SurplusStatus } from '../entities/surplus.entity';

describe('PaymentBillingController', () => {
  let controller: PaymentBillingController;

  const mockPaymentService = {
    createPayment: jest.fn(),
    findPayments: jest.fn(),
    countPendingPayments: jest.fn(),
    approvePayment: jest.fn(),
    rejectPayment: jest.fn(),
    updatePaymentDate: jest.fn(),
  };

  const mockSurplusService = {
    updateSurplusStatus: jest.fn(),
  };

  const mockReceiptAnalysisService = {
    analyzeReceipt: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentBillingController],
      providers: [
        { provide: PaymentService, useValue: mockPaymentService },
        { provide: SurplusService, useValue: mockSurplusService },
        { provide: ReceiptAnalysisService, useValue: mockReceiptAnalysisService },
      ],
    }).compile();

    controller = module.get<PaymentBillingController>(PaymentBillingController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('updateSurplusStatus', () => {
    it('should delegate updateSurplusStatus to SurplusService', async () => {
      const mockResult = { id: 's-1', status: SurplusStatus.REFUNDED };
      mockSurplusService.updateSurplusStatus.mockResolvedValue(mockResult);

      const dto = { status: SurplusStatus.REFUNDED, reason: 'Test reason' };
      const result = await controller.updateSurplusStatus('s-1', dto);

      expect(mockSurplusService.updateSurplusStatus).toHaveBeenCalledWith('s-1', dto);
      expect(result).toEqual(mockResult);
    });
  });

  describe('analyzeReceipt', () => {
    it('should delegate analyzeReceipt to ReceiptAnalysisService', async () => {
      const mockFile = { buffer: Buffer.from('test') } as Express.Multer.File;
      const mockResult = {
        referenceNumber: '123456',
        amount: null,
        amountBs: 500,
        paymentDate: '2026-07-22',
        operationDate: '2026-07-22',
        paymentMethod: 'PAGO_MOVIL',
        bank: 'Mercantil',
        url: 'http://s3/test.jpg',
        rawOcr: {},
      };
      mockReceiptAnalysisService.analyzeReceipt.mockResolvedValue(mockResult);

      const result = await controller.analyzeReceipt(mockFile);

      expect(mockReceiptAnalysisService.analyzeReceipt).toHaveBeenCalledWith(mockFile);
      expect(result).toEqual(mockResult);
    });
  });
});
