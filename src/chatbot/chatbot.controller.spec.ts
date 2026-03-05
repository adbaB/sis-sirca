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

  describe('handleWebhook', () => {
    it('should return twiml response and set content-type', async () => {
      const mockRequest = {} as Request;
      const mockResponse = {
        set: jest.fn(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      } as unknown as Response;
      const body = { From: '+123', Body: 'Hola' };
      const twimlResponse = '<Response><Message>Hola</Message></Response>';

      mockChatbotService.handleIncomingMessage.mockResolvedValue(twimlResponse);

      await controller.handleWebhook(mockRequest, mockResponse, body);

      expect(service.handleIncomingMessage).toHaveBeenCalledWith(body);
      expect(mockResponse.set).toHaveBeenCalledWith('Content-Type', 'text/xml');
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.send).toHaveBeenCalledWith(twimlResponse);
    });
  });
});
