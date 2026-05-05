import { InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AwsService } from '../aws/aws.service';
import { EmailService } from '../email/email.service';
import { SubmitPaymentDto } from './dto/submit-payment.dto';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let awsService: AwsService;

  const mockAwsService = {
    uploadFile: jest.fn(),
  };

  const mockEmailService = {
    sendPaymentConfirmation: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: AwsService,
          useValue: mockAwsService,
        },
        {
          provide: EmailService,
          useValue: mockEmailService,
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    awsService = module.get<AwsService>(AwsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processPaymentReceipt', () => {
    it('should upload file and send email successfully', async () => {
      const dto: SubmitPaymentDto = { name: 'Test', email: 'test@example.com' };
      const file = { buffer: Buffer.from('test') } as Express.Multer.File;
      const receiptUrl = 'http://s3.amazonaws.com/receipts/test.png';

      mockAwsService.uploadFile.mockResolvedValue(receiptUrl);
      mockEmailService.sendPaymentConfirmation.mockResolvedValue(undefined);

      const result = await service.processPaymentReceipt(dto, file);

      expect(awsService.uploadFile).toHaveBeenCalledWith(file);
      expect(result).toEqual({
        message: 'Payment information collected successfully.',
        receiptUrl,
      });
    });

    it('should throw InternalServerErrorException if upload fails', async () => {
      const dto: SubmitPaymentDto = { name: 'Test', email: 'test@example.com' };
      const file = { buffer: Buffer.from('test') } as Express.Multer.File;

      mockAwsService.uploadFile.mockRejectedValue(new Error('S3 error'));

      await expect(service.processPaymentReceipt(dto, file)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
