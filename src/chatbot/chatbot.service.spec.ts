import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { AwsService } from '../aws/aws.service';
import { EmailService } from '../email/email.service';
import { ChatbotService } from './chatbot.service';
import { OcrService } from '../ocr/ocr.service';
import { BillingService } from '../billing/services/billing.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ChatbotService', () => {
  let service: ChatbotService;
  // let awsService: AwsService;
  // let emailService: EmailService;

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockAwsService = {
    uploadFile: jest.fn(),
  };

  const mockEmailService = {
    sendPaymentConfirmation: jest.fn(),
  };

  const mockOcrService = {
    extractReceiptData: jest.fn(),
  };

  const mockBillingService = {
    createPayment: jest.fn(),
    findPendingInvoicesByIdentityCard: jest.fn(),
    findInvoicesByIds: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatbotService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: AwsService, useValue: mockAwsService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: OcrService, useValue: mockOcrService },
        { provide: BillingService, useValue: mockBillingService },
      ],
    }).compile();

    service = module.get<ChatbotService>(ChatbotService);
    // awsService = module.get<AwsService>(AwsService);
    // emailService = module.get<EmailService>(EmailService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleIncomingMessage', () => {
    beforeEach(() => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'META_ACCESS_TOKEN') return 'token';
        if (key === 'META_PHONE_NUMBER_ID') return 'phoneid';
        return null;
      });
      mockedAxios.post.mockResolvedValue({});
    });

    const createMetaMessage = (from: string, text: string) => ({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from,
                    text: { body: text },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const createMetaMediaMessage = (from: string, mediaId: string, mimeType: string) => ({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from,
                    image: { id: mediaId, mime_type: mimeType },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const createNfmReplyMessage = (from: string, responseJson: string) => ({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from,
                    interactive: {
                      type: 'nfm_reply',
                      nfm_reply: {
                        response_json: responseJson,
                        body: '',
                        name: 'flow',
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    it('should initialize conversation with main menu buttons', async () => {
      await service.handleIncomingMessage(createMetaMessage('123', 'hola'));

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v18.0/phoneid/messages',
        expect.objectContaining({
          to: '123',
          type: 'interactive',
          interactive: expect.objectContaining({
            type: 'button',
            body: expect.objectContaining({
              text: expect.stringContaining('¿En qué puedo ayudarte hoy?'),
            }),
            action: expect.objectContaining({
              buttons: expect.arrayContaining([
                expect.objectContaining({ reply: expect.objectContaining({ id: 'info_planes' }) }),
                expect.objectContaining({
                  reply: expect.objectContaining({ id: 'realizar_pago' }),
                }),
              ]),
            }),
          }),
        }),
        expect.any(Object),
      );
    });

    const createButtonReplyMessage = (from: string, id: string) => ({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from,
                    interactive: {
                      type: 'button_reply',
                      button_reply: {
                        id,
                        title: 'button',
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    it('should respond with info_planes', async () => {
      await service.handleIncomingMessage(createMetaMessage('123', 'hola'));
      await service.handleIncomingMessage(createButtonReplyMessage('123', 'info_planes'));

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v18.0/phoneid/messages',
        expect.objectContaining({
          to: '123',
          text: { body: expect.stringContaining('asesor comercial') },
        }),
        expect.any(Object),
      );
    });

    it('should open flow on realizar_pago', async () => {
      await service.handleIncomingMessage(createMetaMessage('123', 'hola'));
      await service.handleIncomingMessage(createButtonReplyMessage('123', 'realizar_pago'));

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v18.0/phoneid/messages',
        expect.objectContaining({
          to: '123',
          type: 'interactive',
          interactive: expect.objectContaining({
            type: 'flow',
            action: expect.objectContaining({ name: 'flow' }),
          }),
        }),
        expect.any(Object),
      );
    });

    it('should process media capture after flow completion', async () => {
      await service.handleIncomingMessage(createMetaMessage('123', 'hola'));
      await service.handleIncomingMessage(
        createNfmReplyMessage(
          '123',
          JSON.stringify({
            selected_invoices: ['inv1'],
            payment_method: 'zelle',
            total_amount: '100.00',
          }),
        ),
      );

      mockedAxios.get
        .mockResolvedValueOnce({ data: { url: 'https://media.url/123' } }) // First get for URL
        .mockResolvedValueOnce({ data: Buffer.from('test') }); // Second get for Buffer

      mockAwsService.uploadFile.mockResolvedValue('http://s3.aws.com/comprobante.jpg');
      mockOcrService.extractReceiptData.mockResolvedValue({
        referencia: '123456',
        monto: '100',
        nombreBanco: 'Banesco',
      });

      await service.handleIncomingMessage(createMetaMediaMessage('123', 'media123', 'image/jpeg'));

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://graph.facebook.com/v18.0/media123',
        expect.any(Object),
      );
      expect(mockedAxios.get).toHaveBeenCalledWith('https://media.url/123', expect.any(Object));

      expect(mockAwsService.uploadFile).toHaveBeenCalled();
      expect(mockOcrService.extractReceiptData).toHaveBeenCalled();
    });
  });
});
