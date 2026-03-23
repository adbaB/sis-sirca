import { Test, TestingModule } from '@nestjs/testing';
import { EmailService } from './email.service';
import { InternalServerErrorException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { SubmitPaymentDto } from '../payments/dto/submit-payment.dto';
import config from '../config/configurations';

jest.mock('nodemailer');

describe('EmailService', () => {
  let service: EmailService;

  const mockSendMail = jest.fn();

  beforeEach(async () => {
    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: mockSendMail,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: config.KEY,
          useValue: {
            smtp: {
              host: 'smtp.test.com',
              port: 587,
              secure: false,
              user: 'test@test.com',
              pass: 'password',
              from: 'noreply@sirca.com',
            },
          },
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
