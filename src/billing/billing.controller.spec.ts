import { Test, TestingModule } from '@nestjs/testing';
import { BillingController } from './billing.controller';
import { BillingService } from './services/billing.service';
import { CreatePaymentDto } from './dto/create-payment.dto';

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
        idempotencyKey: 'idem-key',
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
