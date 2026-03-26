import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { AwsService } from '../aws/aws.service';
import { EmailService } from '../email/email.service';
import { ChatbotService } from './chatbot.service';
import { OcrService } from '../ocr/ocr.service';
import { BillingService } from '../billing/services/billing.service';
import config from '../config/configurations';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ChatbotService', () => {
  let service: ChatbotService;
  // let awsService: AwsService;
  // let emailService: EmailService;

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
        {
          provide: config.KEY,
          useValue: {
            meta: {
              accessToken: 'token',
              phoneNumberId: 'phoneid',
              flowId: '123456789',
              appSecret: 'mockAppSecret',
              flowPrivateKey: 'mockFlowPrivateKey',
              flowPassphrase: 'mockPassphrase',
              verifyToken: 'mockVerifyToken',
            },
          },
        },
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
              text: expect.stringContaining('¿en qué puedo apoyarte hoy?'),
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

    it('should open flow and NOT offer manual payment proactively on realizar_pago if successful', async () => {
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

      expect(mockedAxios.post).not.toHaveBeenCalledWith(
        'https://graph.facebook.com/v18.0/phoneid/messages',
        expect.objectContaining({
          text: { body: expect.stringContaining('pago manual') },
        }),
        expect.any(Object),
      );
    });

    it('should initiate manual payment automatically if sendFlowMessage fails', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('Flow failed'));
      await service.handleIncomingMessage(createMetaMessage('123', 'hola'));
      mockedAxios.post.mockClear();
      mockedAxios.post.mockRejectedValueOnce(new Error('Flow failed')); // Reject flow message

      await service.handleIncomingMessage(createButtonReplyMessage('123', 'realizar_pago'));

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v18.0/phoneid/messages',
        expect.objectContaining({
          to: '123',
          text: { body: expect.stringContaining('tipo y número de documento') },
        }),
        expect.any(Object),
      );
    });

    it('should handle webhook failed statuses by initiating manual payment automatically', async () => {
      await service.handleIncomingMessage(createMetaMessage('123', 'hola'));
      await service.handleIncomingMessage(createButtonReplyMessage('123', 'realizar_pago'));

      const failedStatusMessage = {
        entry: [
          {
            changes: [
              {
                value: {
                  statuses: [
                    {
                      status: 'failed',
                      recipient_id: '123',
                      errors: [{ code: 130429, title: 'Rate limit hit' }],
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      await service.handleIncomingMessage(failedStatusMessage);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v18.0/phoneid/messages',
        expect.objectContaining({
          to: '123',
          text: { body: expect.stringContaining('tipo y número de documento') },
        }),
        expect.any(Object),
      );
    });

    it('should safely ignore failed webhooks for non-flow interactions', async () => {
      const failedStatusMessage = {
        entry: [
          {
            changes: [
              {
                value: {
                  statuses: [
                    {
                      status: 'failed',
                      recipient_id: '456',
                      errors: [{ code: 1, title: 'error' }],
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
      await service.handleIncomingMessage(failedStatusMessage);

      expect(mockedAxios.post).not.toHaveBeenCalledWith(
        'https://graph.facebook.com/v18.0/phoneid/messages',
        expect.objectContaining({
          to: '456',
        }),
        expect.any(Object),
      );
    });

    it('should handle manual payment flow successfully', async () => {
      // Setup state by failing the flow message to trigger the fallback state
      await service.handleIncomingMessage(createMetaMessage('123', 'hola'));
      mockedAxios.post.mockRejectedValueOnce(new Error('Flow failed'));
      await service.handleIncomingMessage(createButtonReplyMessage('123', 'realizar_pago'));

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v18.0/phoneid/messages',
        expect.objectContaining({
          to: '123',
          text: { body: expect.stringContaining('tipo y número de documento') },
        }),
        expect.any(Object),
      );

      mockBillingService.findPendingInvoicesByIdentityCard.mockResolvedValueOnce([
        {
          id: 'inv1',
          billingMonth: 'Jan 2024',
          totalAmount: '100',
          paidAmount: '0',
          contract: { code: 'CT-1' },
        },
        {
          id: 'inv2',
          billingMonth: 'Feb 2024',
          totalAmount: '50',
          paidAmount: '0',
          contract: { code: 'CT-2' },
        },
      ]);

      await service.handleIncomingMessage(createMetaMessage('123', 'V-1234567'));

      expect(mockBillingService.findPendingInvoicesByIdentityCard).toHaveBeenCalledWith(
        '1234567',
        'V',
      );
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v18.0/phoneid/messages',
        expect.objectContaining({
          to: '123',
          text: { body: expect.stringContaining('Contrato CT-1') },
        }),
        expect.any(Object),
      );

      await service.handleIncomingMessage(createMetaMessage('123', '1, 2'));

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v18.0/phoneid/messages',
        expect.objectContaining({
          to: '123',
          type: 'interactive',
          interactive: expect.objectContaining({
            type: 'button',
            body: expect.objectContaining({
              text: expect.stringContaining('Total a pagar: 150.00'),
            }),
            action: expect.objectContaining({
              buttons: expect.arrayContaining([
                expect.objectContaining({ reply: expect.objectContaining({ id: 'pm_zelle' }) }),
              ]),
            }),
          }),
        }),
        expect.any(Object),
      );

      await service.handleIncomingMessage(createButtonReplyMessage('123', 'pm_zelle'));

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v18.0/phoneid/messages',
        expect.objectContaining({
          to: '123',
          text: { body: expect.stringContaining('Zelle: platinumclubadmon2@gmail.com') },
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
        monto: 100,
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
