import { Test, TestingModule } from '@nestjs/testing';
import { ReceiptAnalysisService } from './receipt-analysis.service';
import { AwsService } from '../../../aws/aws.service';
import { OcrService } from '../../../ocr/ocr.service';

describe('ReceiptAnalysisService', () => {
  let service: ReceiptAnalysisService;

  const mockAwsService = { uploadFile: jest.fn() };
  const mockOcrService = { extractReceiptData: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReceiptAnalysisService,
        { provide: AwsService, useValue: mockAwsService },
        { provide: OcrService, useValue: mockOcrService },
      ],
    }).compile();

    service = module.get<ReceiptAnalysisService>(ReceiptAnalysisService);
    jest.clearAllMocks();
  });

  describe('analyzeReceipt', () => {
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

      const result = await service.analyzeReceipt(mockFile);

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

      const result = await service.analyzeReceipt(mockFile);

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

      const result = await service.analyzeReceipt(mockFile);

      expect(result.amount).toBe(100);
      expect(result.amountBs).toBeNull();
      expect(result.paymentMethod).toBe('ZELLE');
      expect('rawOcr' in result).toBe(false);
    });

    it('should update originalname extension when format changes to image/jpeg and preserve on fallback', async () => {
      // Valid 1x1 transparent PNG
      const validPngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      );
      const mockFile = {
        buffer: validPngBuffer,
        originalname: 'receipt.png',
        mimetype: 'image/png',
      } as Express.Multer.File;
      mockAwsService.uploadFile.mockResolvedValue('http://s3/receipt.jpg');
      mockOcrService.extractReceiptData.mockResolvedValue({
        monto: 100,
        referencia: '123456',
        moneda: 'Bs',
        fecha: '22/07/2026',
        nombreBanco: 'Mercantil',
      });

      await service.analyzeReceipt(mockFile);

      expect(mockAwsService.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({
          originalname: 'receipt.jpg',
          mimetype: 'image/jpeg',
        }),
      );

      // Corrupt PNG falls back without changing format -> preserves originalname
      mockAwsService.uploadFile.mockClear();
      const corruptFile = {
        buffer: Buffer.from('corrupt-png-bytes'),
        originalname: 'receipt.png',
        mimetype: 'image/png',
      } as Express.Multer.File;

      await service.analyzeReceipt(corruptFile);

      expect(mockAwsService.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({
          originalname: 'receipt.png',
          mimetype: 'image/png',
        }),
      );
    });

    it('should throw BadRequestException if file is undefined', async () => {
      await expect(
        service.analyzeReceipt(undefined as unknown as Express.Multer.File),
      ).rejects.toThrow('Se requiere un archivo de comprobante.');
    });
  });
});
