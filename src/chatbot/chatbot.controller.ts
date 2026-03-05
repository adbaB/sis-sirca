import { Controller, Post, Body, Req, Res, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { ChatbotService } from './chatbot.service';

@Controller('chatbot')
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Post('webhook')
  async handleWebhook(
    @Req() request: Request,
    @Res() response: Response,
    @Body() body: any,
  ) {
    // Twilio sends form-data content by default.
    const twimlResponse = await this.chatbotService.handleIncomingMessage(body);

    response.set('Content-Type', 'text/xml');
    response.status(HttpStatus.OK).send(twimlResponse);
  }
}
