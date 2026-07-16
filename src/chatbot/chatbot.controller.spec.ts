import { Test, TestingModule } from '@nestjs/testing';
import { Request, Response } from 'express';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './services/chatbot.service';
import config from '../config/configurations';
import { MetaFlowService } from './services/meta-flow.service';

describe('ChatbotController', () => {
  let controller: ChatbotController;
  let service: ChatbotService;
  let metaFlowService: MetaFlowService;

  const mockChatbotService = {
    handleIncomingMessage: jest.fn(),
  };

  const mockMetaFlowService = {
    handleEncryptedFlowDataExchange: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatbotController],
      providers: [
        {
          provide: ChatbotService,
          useValue: mockChatbotService,
        },
        {
          provide: MetaFlowService,
          useValue: mockMetaFlowService,
        },
        {
          provide: config.KEY,
          useValue: {
            meta: {
              verifyToken: 'test_token',
            },
          },
        },
      ],
    }).compile();

    controller = module.get<ChatbotController>(ChatbotController);
    service = module.get<ChatbotService>(ChatbotService);
    metaFlowService = module.get<MetaFlowService>(MetaFlowService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('verifyWebhook', () => {
    it('should return challenge when token is valid', () => {
      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      } as unknown as Response;

      controller.verifyWebhook('subscribe', 'test_token', '12345', mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.send).toHaveBeenCalledWith('12345');
    });

    it('should return forbidden when token is invalid', () => {
      const mockResponse = {
        sendStatus: jest.fn(),
      } as unknown as Response;

      controller.verifyWebhook('subscribe', 'wrong_token', '12345', mockResponse);

      expect(mockResponse.sendStatus).toHaveBeenCalledWith(403);
    });

    it('should return bad request when params are missing', () => {
      const mockResponse = {
        sendStatus: jest.fn(),
      } as unknown as Response;

      controller.verifyWebhook(undefined, undefined, undefined, mockResponse);

      expect(mockResponse.sendStatus).toHaveBeenCalledWith(400);
    });
  });

  describe('handleWebhook', () => {
    it('should send 200 OK immediately and call service', async () => {
      const mockRequest = {} as Request;
      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      } as unknown as Response;
      const body = { entry: [] };

      mockChatbotService.handleIncomingMessage.mockResolvedValue(undefined);

      await controller.handleWebhook(mockRequest, mockResponse, body);

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.send).toHaveBeenCalledWith('EVENT_RECEIVED');
      expect(service.handleIncomingMessage).toHaveBeenCalledWith(body);
    });
  });

  describe('handleFlowEndpoint', () => {
    it('should send 200 OK and encrypted response on success', async () => {
      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      } as unknown as Response;
      const body = {
        encrypted_aes_key: 'key',
        encrypted_flow_data: 'data',
        initial_vector: 'iv',
      };

      mockMetaFlowService.handleEncryptedFlowDataExchange.mockResolvedValue('encrypted_payload');

      await controller.handleFlowEndpoint(body, mockResponse);

      expect(metaFlowService.handleEncryptedFlowDataExchange).toHaveBeenCalledWith(body);
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.send).toHaveBeenCalledWith('encrypted_payload');
    });

    it('should send 500 error on service exception', async () => {
      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      } as unknown as Response;
      const body = {
        encrypted_aes_key: 'key',
        encrypted_flow_data: 'data',
        initial_vector: 'iv',
      };

      mockMetaFlowService.handleEncryptedFlowDataExchange.mockRejectedValue(
        new Error('Decrypt error'),
      );

      await controller.handleFlowEndpoint(body, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.send).toHaveBeenCalledWith('Error processing secure flow request.');
    });
  });
});
