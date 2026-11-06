import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import config from '../config/configurations';
import {
  OcrService,
  resizeReceiptImage,
  isPdfDocument,
  MAX_OCR_IMAGE_DIMENSION,
} from './ocr.service';

vi.mock('openai');

const mockSharpInstance = {
  autoOrient: vi.fn().mockReturnThis(),
  resize: vi.fn().mockReturnThis(),
  flatten: vi.fn().mockReturnThis(),
  jpeg: vi.fn().mockReturnThis(),
  toBuffer: vi.fn().mockImplementation(function (this: { _input: Buffer }) {
    return Promise.resolve(this._input);
  }),
};

const mockSharpFn = vi.fn((input: Buffer) => ({ ...mockSharpInstance, _input: input }));

vi.mock('sharp', () => ({
  default: (...args: [Buffer]) => mockSharpFn(...args),
}));

describe('OcrService', () => {
  let service: OcrService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OcrService,
        {
          provide: config.KEY,
          useValue: {
            openrouter: { apiKey: 'test-api-key' },
            env: 'test',
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
      // Mock OpenAI chat completions create
      const mockChatCompletionsCreate = jest.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                monto: 100,
                referencia: '12345',
                beneficiario: 'Pedro Perez',
                bancoDestino: 'Banco de Venezuela',
                fecha: '10/10/2023',
                origen: 'Banesco',
                moneda: 'BS',
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

      expect(mockChatCompletionsCreate).toHaveBeenCalledTimes(1);

      const promptCallArg = mockChatCompletionsCreate.mock.calls[0][0];
      expect(promptCallArg.model).toBe('anthropic/claude-sonnet-5.5');
      expect(promptCallArg.reasoning).toEqual({ effort: 'low' });
      expect(promptCallArg.messages[1].content[0].cache_control).toEqual({
        type: 'ephemeral',
      });
      // Assert that openrouter / openai receives the image directly
      expect(promptCallArg.messages[1].content[1].image_url.url).toContain(
        'base64,ZHVtbXkgaW1hZ2UgYnVmZmVy',
      );
      expect(result).toEqual({
        monto: 100,
        referencia: '12345',
        beneficiario: 'Pedro Perez',
        bancoDestino: 'Banco de Venezuela',
        fecha: '10/10/2023',
        origen: 'Banesco',
        descripcion: 'Pago de seguro',
        nombreBanco: 'Banesco',
        moneda: 'BS',
        esZelle: null,
      });
    });

    it('should extract Zelle receipt data correctly', async () => {
      const mockChatCompletionsCreate = jest.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                monto: 50,
                referencia: 'WFCT128RS4V9',
                beneficiario: 'Platinum Club Corp',
                bancoDestino: null,
                fecha: '05/10/2026',
                origen: 'Wells Fargo',
                moneda: 'USD',
                descripcion: 'Payment',
                nombreBanco: 'Wells Fargo',
                esZelle: true,
              }),
            },
          },
        ],
      });

      const openAiInstance = service['openai'];
      openAiInstance.chat = {
        completions: {
          create: mockChatCompletionsCreate,
        },
      } as unknown as typeof openAiInstance.chat;

      const buffer = Buffer.from('dummy zelle image');
      const result = await service.extractReceiptData(buffer);

      expect(result).toEqual({
        monto: 50,
        referencia: 'WFCT128RS4V9',
        beneficiario: 'Platinum Club Corp',
        bancoDestino: null,
        fecha: '05/10/2026',
        origen: 'Wells Fargo',
        moneda: 'USD',
        descripcion: 'Payment',
        nombreBanco: 'Wells Fargo',
        esZelle: true,
      });
    });

    it('should extract data correctly from PDF buffer and send file payload', async () => {
      const mockChatCompletionsCreate = jest.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                monto: 199608.64,
                referencia: '102653088',
                beneficiario: 'Salud Integral El Rosario',
                bancoDestino: 'Banco Nacional de Crédito',
                fecha: '03/11/2026',
                origen: 'Banco Nacional de Crédito',
                moneda: 'Bs',
                descripcion: 'Pago Gisela Melendez y flia',
                nombreBanco: 'Banco Nacional de Crédito',
                esZelle: false,
              }),
            },
          },
        ],
      });

      const openAiInstance = service['openai'];
      openAiInstance.chat = {
        completions: {
          create: mockChatCompletionsCreate,
        },
      } as unknown as typeof openAiInstance.chat;

      const pdfBuffer = Buffer.from('%PDF-1.4 dummy pdf content');
      const result = await service.extractReceiptData(pdfBuffer);

      expect(mockChatCompletionsCreate).toHaveBeenCalledTimes(1);
      const callArgs = mockChatCompletionsCreate.mock.calls[0][0];
      expect(callArgs.model).toBe('anthropic/claude-sonnet-5.5');
      expect(callArgs.messages[1].content[1].type).toBe('file');
      expect(callArgs.messages[1].content[1].file.filename).toBe('comprobante.pdf');
      expect(callArgs.messages[1].content[1].file.file_data).toContain(
        'data:application/pdf;base64,',
      );
      expect(result.monto).toBe(199608.64);
      expect(result.referencia).toBe('102653088');
    });

    it('should extract data correctly from PDF URL and normalize formatted Venezuelan amount string', async () => {
      const mockChatCompletionsCreate = jest.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                monto: '199.608,64',
                referencia: '102653088',
                beneficiario: 'Salud Integral El Rosario',
                bancoDestino: 'Banco Nacional de Crédito',
                fecha: '03/11/2026',
                origen: 'Banco Nacional de Crédito',
                moneda: 'Bs',
                descripcion: 'Transferencia',
                nombreBanco: 'Banco Nacional de Crédito',
                esZelle: false,
              }),
            },
          },
        ],
      });

      const openAiInstance = service['openai'];
      openAiInstance.chat = {
        completions: {
          create: mockChatCompletionsCreate,
        },
      } as unknown as typeof openAiInstance.chat;

      const pdfUrl = 'https://s3.amazonaws.com/receipts/comprobante.pdf';
      const result = await service.extractReceiptData(pdfUrl, 'application/pdf');

      expect(mockChatCompletionsCreate).toHaveBeenCalledTimes(1);
      const callArgs = mockChatCompletionsCreate.mock.calls[0][0];
      expect(callArgs.messages[1].content[1].type).toBe('file');
      expect(callArgs.messages[1].content[1].file.file_data).toBe(pdfUrl);
      // Normalized from "199.608,64" string to number 199608.64
      expect(result.monto).toBe(199608.64);
    });

    it('should throw error if OCR fails', async () => {
      const buffer = Buffer.from('dummy image buffer');
      await expect(service.extractReceiptData(buffer)).rejects.toThrow(
        'Failed to extract receipt data',
      );
    });
  });

  describe('resizeReceiptImage', () => {
    it('should have MAX_OCR_IMAGE_DIMENSION set to 1568', () => {
      expect(MAX_OCR_IMAGE_DIMENSION).toBe(1568);
    });

    it('should call sharp with autoOrient, max 1568 dimension, flatten, and jpeg', async () => {
      const buffer = Buffer.from('image bytes');
      const result = await resizeReceiptImage(buffer, 'image/png');

      expect(mockSharpFn).toHaveBeenCalledWith(buffer);
      expect(mockSharpInstance.autoOrient).toHaveBeenCalled();
      expect(mockSharpInstance.resize).toHaveBeenCalledWith({
        width: 1568,
        height: 1568,
        fit: 'inside',
        withoutEnlargement: true,
      });
      expect(mockSharpInstance.flatten).toHaveBeenCalledWith({ background: '#ffffff' });
      expect(mockSharpInstance.jpeg).toHaveBeenCalledWith({ quality: 90 });
      expect(result.mimeType).toBe('image/jpeg');
    });

    it('should not resize if the document is a PDF', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4 dummy pdf');
      const result = await resizeReceiptImage(pdfBuffer, 'application/pdf');

      expect(result.buffer).toBe(pdfBuffer);
      expect(result.mimeType).toBe('application/pdf');
    });

    it('should return original buffer if sharp throws', async () => {
      mockSharpFn.mockImplementationOnce(() => {
        throw new Error('Corrupt image');
      });

      const corruptBuffer = Buffer.from('corrupt');
      const result = await resizeReceiptImage(corruptBuffer, 'image/jpeg');

      expect(result.buffer).toBe(corruptBuffer);
      expect(result.mimeType).toBe('image/jpeg');
    });
  });

  describe('isPdfDocument', () => {
    it('should identify PDF by mimeType', () => {
      expect(isPdfDocument('https://example.com/file', 'application/pdf')).toBe(true);
    });

    it('should identify PDF by URL extension', () => {
      expect(isPdfDocument('https://example.com/file.pdf')).toBe(true);
      expect(isPdfDocument('https://example.com/file.jpg')).toBe(false);
    });

    it('should identify PDF by magic bytes in buffer', () => {
      expect(isPdfDocument(Buffer.from('%PDF-1.5 test'))).toBe(true);
      expect(isPdfDocument(Buffer.from('not a pdf'))).toBe(false);
    });
  });
});
