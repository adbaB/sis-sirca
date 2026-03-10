import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SubmitPaymentDto } from './dto/submit-payment.dto';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let service: PaymentsService;

  const mockPaymentsService = {
    processPaymentReceipt: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        {
          provide: PaymentsService,
          useValue: mockPaymentsService,
        },
      ],
    }).compile();

    controller = module.get<PaymentsController>(PaymentsController);
    service = module.get<PaymentsService>(PaymentsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('submitPayment', () => {
    it('should throw BadRequestException if no file is provided', async () => {
      const dto: SubmitPaymentDto = { name: 'Test', email: 'test@example.com' };
      await expect(controller.submitPayment(null, dto)).rejects.toThrow(BadRequestException);
    });

    it('should call paymentsService.processPaymentReceipt with file and dto', async () => {
      const dto: SubmitPaymentDto = { name: 'Test', email: 'test@example.com' };
      const file = {
        originalname: 'test.png',
        buffer: Buffer.from('test'),
      } as Express.Multer.File;
      const result = { message: 'Success', receiptUrl: 'http://test.com' };

      mockPaymentsService.processPaymentReceipt.mockResolvedValue(result);

      const response = await controller.submitPayment(file, dto);

      expect(service.processPaymentReceipt).toHaveBeenCalledWith(dto, file);
      expect(response).toEqual(result);
    });
  });
});
