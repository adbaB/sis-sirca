import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OcrService } from './ocr.service';
import * as Tesseract from 'tesseract.js';

jest.mock('tesseract.js');
jest.mock('openai');

describe('OcrService', () => {
  let service: OcrService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OcrService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'config.openrouter.apiKey') {
                return 'test-api-key';
              }
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<OcrService>(OcrService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('extractReceiptData', () => {
    it('should extract data correctly from image buffer', async () => {
      // Mock Tesseract.recognize
      const mockRecognize = jest.spyOn(Tesseract, 'recognize').mockResolvedValue({
        data: { text: 'Recibo de pago 100 BS referencia 12345' },
      } as unknown as Tesseract.RecognizeResult);

      // Mock OpenAI chat completions create
      const mockChatCompletionsCreate = jest.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                monto: '100 BS',
                referencia: '12345',
                beneficiario: 'Pedro Perez',
                bancoDestino: 'Banco de Venezuela',
                fecha: '10/10/2023',
                origen: 'Banesco',
                descripcion: 'Pago de seguro',
                nombreBanco: 'Banesco',
              }),
            },
          },
        ],
      });

      // The service instantiates OpenAI inside constructor, we need to mock prototype
      const openAiInstance = service['openai'];
      openAiInstance.chat = {
        completions: {
          create: mockChatCompletionsCreate,
        },
      } as unknown as typeof openAiInstance.chat;

      const buffer = Buffer.from('dummy image buffer');
      const result = await service.extractReceiptData(buffer);

      expect(mockRecognize).toHaveBeenCalledWith(buffer, 'spa');
      expect(mockChatCompletionsCreate).toHaveBeenCalledTimes(1);

      const promptCallArg = mockChatCompletionsCreate.mock.calls[0][0];
      expect(promptCallArg.messages[1].content).toContain('Recibo de pago 100 BS referencia 12345');
      expect(result).toEqual({
        monto: '100 BS',
        referencia: '12345',
        beneficiario: 'Pedro Perez',
        bancoDestino: 'Banco de Venezuela',
        fecha: '10/10/2023',
        origen: 'Banesco',
        descripcion: 'Pago de seguro',
        nombreBanco: 'Banesco',
      });
    });

    it('should throw error if OCR fails', async () => {
      const buffer = Buffer.from('dummy image buffer');
      await expect(service.extractReceiptData(buffer)).rejects.toThrow(
        'Failed to extract receipt data',
      );
    });
  });
});
