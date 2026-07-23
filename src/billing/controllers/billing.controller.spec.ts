import { Test, TestingModule } from '@nestjs/testing';
import { PdfService } from '../../pdf/services/pdf.service';
import { BillingController } from './billing.controller';
import { BillingService } from '../services/billing.service';

import { AwsService } from '../../aws/aws.service';
import { OcrService } from '../../ocr/ocr.service';

describe('BillingController', () => {
  let controller: BillingController;

  const mockBillingService = {
    createPayment: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [
        {
          provide: BillingService,
          useValue: mockBillingService,
        },
        {
          provide: PdfService,
          useValue: {},
        },
        {
          provide: AwsService,
          useValue: {},
        },
        {
          provide: OcrService,
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<BillingController>(BillingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('analyzeReceipt', () => {
    const mockAwsService = { uploadFile: jest.fn() };
    const mockOcrService = { extractReceiptData: jest.fn() };

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        controllers: [BillingController],
        providers: [
          { provide: BillingService, useValue: mockBillingService },
          { provide: PdfService, useValue: {} },
          { provide: AwsService, useValue: mockAwsService },
          { provide: OcrService, useValue: mockOcrService },
        ],
      }).compile();

      controller = module.get<BillingController>(BillingController);
    });

    it('should assign amountBs when currency is BS', async () => {
      const mockFile = { buffer: Buffer.from('test') } as Express.Multer.File;
      mockAwsService.uploadFile.mockResolvedValue('http://s3/test.jpg');
      mockOcrService.extractReceiptData.mockResolvedValue({
        monto: 500,
        referencia: '123456',
        moneda: 'Bs',
        fecha: '22/07/2026',
        nombreBanco: 'Mercantil',
      });

      const result = await controller.analyzeReceipt(mockFile);

      expect(result.amountBs).toBe(500);
      expect(result.amount).toBeNull();
      expect(result.referenceNumber).toBe('123456');
    });

    it('should assign amountBs when currency is VES (legacy)', async () => {
      const mockFile = { buffer: Buffer.from('test') } as Express.Multer.File;
      mockAwsService.uploadFile.mockResolvedValue('http://s3/test.jpg');
      mockOcrService.extractReceiptData.mockResolvedValue({
        monto: 300,
        referencia: '654321',
        moneda: 'VES',
        fecha: '22/07/2026',
        nombreBanco: 'Banesco',
      });

      const result = await controller.analyzeReceipt(mockFile);

      expect(result.amountBs).toBe(300);
      expect(result.amount).toBeNull();
    });

    it('should assign amount when currency is USD', async () => {
      const mockFile = { buffer: Buffer.from('test') } as Express.Multer.File;
      mockAwsService.uploadFile.mockResolvedValue('http://s3/test.jpg');
      mockOcrService.extractReceiptData.mockResolvedValue({
        monto: 100,
        referencia: 'WFCT123',
        moneda: 'USD',
        fecha: '22/07/2026',
        nombreBanco: 'Wells Fargo',
      });

      const result = await controller.analyzeReceipt(mockFile);

      expect(result.amount).toBe(100);
      expect(result.amountBs).toBeNull();
      expect(result.paymentMethod).toBe('ZELLE');
    });
  });
});
