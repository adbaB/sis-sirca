import { Test, TestingModule } from '@nestjs/testing';
import { EmailService } from './email.service';
import { InternalServerErrorException } from '@nestjs/common';
import { SESClient } from '@aws-sdk/client-ses';
import configurations from '../config/configurations';
import { SubmitPaymentDto } from '../payments/dto/submit-payment.dto';

jest.mock('@aws-sdk/client-ses', () => {
  return {
    SESClient: jest.fn(),
    SendEmailCommand: jest.fn((input) => ({ input })),
  };
});

describe('EmailService', () => {
  let service: EmailService;
  let sesClientSendMock: jest.Mock;

  const mockConfigService = {
    aws: {
      region: 'us-east-1',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      sesFromEmail: 'noreply@sirca.com',
    },
  };

  beforeEach(async () => {
    sesClientSendMock = jest.fn();
    (SESClient as jest.Mock).mockImplementation(() => ({
      send: sesClientSendMock,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: configurations.KEY,
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
      sesClientSendMock.mockResolvedValueOnce({ MessageId: '12345' });

      const userInfo: SubmitPaymentDto = {
        name: 'Test Customer',
        email: 'test@customer.com',
      };
      const receiptUrl = 'https://link.to/receipt';

      await service.sendPaymentConfirmation('recipient@test.com', userInfo, receiptUrl);

      expect(sesClientSendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Source: 'noreply@sirca.com',
            Destination: { ToAddresses: ['recipient@test.com'] },
          }),
        }),
      );
      const commandArgs = sesClientSendMock.mock.calls[0][0].input;
      expect(commandArgs.Message.Body.Html.Data).toContain(receiptUrl);
    });

    it('should throw InternalServerErrorException on mail failure', async () => {
      sesClientSendMock.mockRejectedValue(new Error('SES Error'));

      const userInfo: SubmitPaymentDto = {
        name: 'Test Customer',
        email: 'test@customer.com',
      };

      await expect(
        service.sendPaymentConfirmation('recipient@test.com', userInfo, 'url'),
      ).rejects.toThrow(InternalServerErrorException);

      await expect(
        service.sendPaymentConfirmation('recipient@test.com', userInfo, 'url'),
      ).rejects.toThrow('Failed to send email: SES Error');
    });
  });
});
