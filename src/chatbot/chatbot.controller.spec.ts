import { Test, TestingModule } from '@nestjs/testing';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { Request, Response } from 'express';

describe('ChatbotController', () => {
  let controller: ChatbotController;
  let service: ChatbotService;

  const mockChatbotService = {
    handleIncomingMessage: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatbotController],
      providers: [
        {
          provide: ChatbotService,
          useValue: mockChatbotService,
        },
      ],
    }).compile();

    controller = module.get<ChatbotController>(ChatbotController);
    service = module.get<ChatbotService>(ChatbotService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('verifyWebhook', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv, META_VERIFY_TOKEN: 'test_token' };
    });

    afterAll(() => {
      process.env = originalEnv;
    });

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
});
