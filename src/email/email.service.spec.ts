import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { InternalServerErrorException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { SubmitPaymentDto } from '../payments/dto/submit-payment.dto';

jest.mock('nodemailer');

describe('EmailService', () => {
  let service: EmailService;

  const mockSendMail = jest.fn();

  const mockConfigService = {
    get: jest.fn((key) => {
      const config = {
        SMTP_HOST: 'smtp.test.com',
        SMTP_PORT: 587,
        SMTP_SECURE: false,
        SMTP_USER: 'test@test.com',
        SMTP_PASS: 'password',
        SMTP_FROM: 'noreply@sirca.com',
      };
      return config[key as keyof typeof config];
    }),
  };

  beforeEach(async () => {
    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: mockSendMail,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendPaymentConfirmation', () => {
    it('should successfully send an email', async () => {
      mockSendMail.mockResolvedValueOnce({ messageId: '12345' });

      const userInfo: SubmitPaymentDto = {
        name: 'Test Customer',
        email: 'test@customer.com',
      };
      const receiptUrl = 'https://link.to/receipt';

      await service.sendPaymentConfirmation('recipient@test.com', userInfo, receiptUrl);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'noreply@sirca.com',
          to: 'recipient@test.com',
          subject: 'Confirmación de Pago - SIRCA Seguros',
          html: expect.stringContaining(receiptUrl),
        }),
      );
    });

    it('should throw InternalServerErrorException on mail failure', async () => {
      mockSendMail.mockRejectedValue(new Error('SMTP Error'));

      const userInfo: SubmitPaymentDto = {
        name: 'Test Customer',
        email: 'test@customer.com',
      };

      await expect(
        service.sendPaymentConfirmation('recipient@test.com', userInfo, 'url'),
      ).rejects.toThrow(InternalServerErrorException);

      await expect(
        service.sendPaymentConfirmation('recipient@test.com', userInfo, 'url'),
      ).rejects.toThrow('Failed to send email: SMTP Error');
    });
  });
});
