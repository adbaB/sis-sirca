import { Test, TestingModule } from '@nestjs/testing';
import { ChatbotService } from './chatbot.service';
import { ConfigService } from '@nestjs/config';
import { AwsService } from '../aws/aws.service';
import { EmailService } from '../email/email.service';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ChatbotService', () => {
  let service: ChatbotService;
  let awsService: AwsService;
  let emailService: EmailService;

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockAwsService = {
    uploadFile: jest.fn(),
  };

  const mockEmailService = {
    sendPaymentConfirmation: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatbotService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: AwsService, useValue: mockAwsService },
        { provide: EmailService, useValue: mockEmailService },
      ],
    }).compile();

    service = module.get<ChatbotService>(ChatbotService);
    awsService = module.get<AwsService>(AwsService);
    emailService = module.get<EmailService>(EmailService);
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
      entry: [{
        changes: [{
          value: {
            messages: [{
              from,
              text: { body: text },
            }],
          },
        }],
      }],
    });

    const createMetaMediaMessage = (from: string, mediaId: string, mimeType: string) => ({
      entry: [{
        changes: [{
          value: {
            messages: [{
              from,
              image: { id: mediaId, mime_type: mimeType },
            }],
          },
        }],
      }],
    });

    it('should initialize conversation with Hola', async () => {
      await service.handleIncomingMessage(createMetaMessage('123', 'hola'));

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v18.0/phoneid/messages',
        expect.objectContaining({
          to: '123',
          text: { body: expect.stringContaining('Soy Elena') },
        }),
        expect.any(Object)
      );
    });

    it('should ask for email after receiving name', async () => {
      // First message to set state to AWAITING_NAME
      await service.handleIncomingMessage(createMetaMessage('123', 'hola'));

      await service.handleIncomingMessage(createMetaMessage('123', 'Juan Perez'));

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v18.0/phoneid/messages',
        expect.objectContaining({
          to: '123',
          text: { body: expect.stringContaining('Gracias Juan Perez') },
        }),
        expect.any(Object)
      );
    });

    it('should validate email and ask for receipt', async () => {
      await service.handleIncomingMessage(createMetaMessage('123', 'hola'));
      await service.handleIncomingMessage(createMetaMessage('123', 'Juan Perez'));

      await service.handleIncomingMessage(createMetaMessage('123', 'invalidemail'));
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v18.0/phoneid/messages',
        expect.objectContaining({
          to: '123',
          text: { body: expect.stringContaining('correo electrónico válido') },
        }),
        expect.any(Object)
      );

      await service.handleIncomingMessage(createMetaMessage('123', 'juan@test.com'));
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v18.0/phoneid/messages',
        expect.objectContaining({
          to: '123',
          text: { body: expect.stringContaining('envíame una imagen o foto') },
        }),
        expect.any(Object)
      );
    });

    it('should process media correctly', async () => {
      await service.handleIncomingMessage(createMetaMessage('123', 'hola'));
      await service.handleIncomingMessage(createMetaMessage('123', 'Juan Perez'));
      await service.handleIncomingMessage(createMetaMessage('123', 'juan@test.com'));

      mockedAxios.get
        .mockResolvedValueOnce({ data: { url: 'https://media.url/123' } }) // First get for URL
        .mockResolvedValueOnce({ data: Buffer.from('test') }); // Second get for Buffer

      mockAwsService.uploadFile.mockResolvedValue('http://s3.aws.com/comprobante.jpg');

      await service.handleIncomingMessage(createMetaMediaMessage('123', 'media123', 'image/jpeg'));

      expect(mockedAxios.get).toHaveBeenCalledWith('https://graph.facebook.com/v18.0/media123', expect.any(Object));
      expect(mockedAxios.get).toHaveBeenCalledWith('https://media.url/123', expect.any(Object));

      expect(mockAwsService.uploadFile).toHaveBeenCalled();
      expect(mockEmailService.sendPaymentConfirmation).toHaveBeenCalledWith(
        'juan@test.com',
        { name: 'Juan Perez', email: 'juan@test.com', phone: '123' },
        'http://s3.aws.com/comprobante.jpg'
      );

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v18.0/phoneid/messages',
        expect.objectContaining({
          to: '123',
          text: { body: expect.stringContaining('procesado con éxito') },
        }),
        expect.any(Object)
      );
    });
  });
});
