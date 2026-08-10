import { Test, TestingModule } from '@nestjs/testing';
import { PaymentBillingController } from './payments-billing.controller';
import { PaymentService } from '../services/payment.service';
import { ReceiptAnalysisService } from '../services/receipt-analysis.service';

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

  const mockReceiptAnalysisService = {
    analyzeReceipt: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentBillingController],
      providers: [
        { provide: PaymentService, useValue: mockPaymentService },
        { provide: ReceiptAnalysisService, useValue: mockReceiptAnalysisService },
      ],
    }).compile();

    controller = module.get<PaymentBillingController>(PaymentBillingController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
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
