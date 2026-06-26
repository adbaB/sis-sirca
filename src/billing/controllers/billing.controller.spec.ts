import { Test, TestingModule } from '@nestjs/testing';
import { PdfService } from '../../pdf/services/pdf.service';
import { BillingController } from './billing.controller';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { BillingService } from '../services/billing.service';

import { AwsService } from '../../aws/aws.service';
import { OcrService } from '../../ocr/ocr.service';

describe('BillingController', () => {
  let controller: BillingController;
  let service: BillingService;

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
    service = module.get<BillingService>(BillingService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createPayment', () => {
    it('should call BillingService.createPayment with correct parameters', async () => {
      // Arrange
      const createPaymentDto: CreatePaymentDto = {
        invoiceId: 'inv-123',
        amount: 100,
        paymentMethod: 'CASH',
        referenceNumber: 'REF123',
      };

      const expectedResult = { id: 'payment-1', ...createPaymentDto };
      mockBillingService.createPayment.mockResolvedValue(expectedResult);

      // Act
      const result = await controller.createPayment(createPaymentDto);

      // Assert
      expect(service.createPayment).toHaveBeenCalledWith(createPaymentDto);
      expect(result).toEqual(expectedResult);
    });
  });
});
