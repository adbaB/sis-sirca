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
    it('should initialize conversation with Hola', async () => {
      const response = await service.handleIncomingMessage({ From: '123', Body: 'hola' });
      expect(response).toContain('Soy Elena');
      expect(response).toContain('tu nombre completo');
    });

    it('should ask for email after receiving name', async () => {
      // First message to set state to AWAITING_NAME
      await service.handleIncomingMessage({ From: '123', Body: 'hola' });

      const response = await service.handleIncomingMessage({ From: '123', Body: 'Juan Perez' });
      expect(response).toContain('Gracias Juan Perez');
      expect(response).toContain('correo electrónico');
    });

    it('should validate email and ask for receipt', async () => {
      await service.handleIncomingMessage({ From: '123', Body: 'hola' });
      await service.handleIncomingMessage({ From: '123', Body: 'Juan Perez' });

      const responseInvalid = await service.handleIncomingMessage({ From: '123', Body: 'invalidemail' });
      expect(responseInvalid).toContain('correo electrónico válido');

      const responseValid = await service.handleIncomingMessage({ From: '123', Body: 'juan@test.com' });
      expect(responseValid).toContain('envíame una imagen o foto de tu comprobante');
    });

    it('should process media correctly', async () => {
      await service.handleIncomingMessage({ From: '123', Body: 'hola' });
      await service.handleIncomingMessage({ From: '123', Body: 'Juan Perez' });
      await service.handleIncomingMessage({ From: '123', Body: 'juan@test.com' });

      mockedAxios.get.mockResolvedValue({ data: Buffer.from('test') });
      mockAwsService.uploadFile.mockResolvedValue('http://s3.aws.com/comprobante.jpg');

      const response = await service.handleIncomingMessage({
        From: '123',
        NumMedia: '1',
        MediaUrl0: 'http://twilio.com/media/1',
        MediaContentType0: 'image/jpeg',
      });

      expect(mockedAxios.get).toHaveBeenCalledWith('http://twilio.com/media/1', expect.any(Object));
      expect(mockAwsService.uploadFile).toHaveBeenCalled();
      expect(mockEmailService.sendPaymentConfirmation).toHaveBeenCalledWith(
        'juan@test.com',
        { name: 'Juan Perez', email: 'juan@test.com', phone: '123' },
        'http://s3.aws.com/comprobante.jpg'
      );
      expect(response).toContain('Comprobante recibido y procesado con éxito');
    });
  });
});
