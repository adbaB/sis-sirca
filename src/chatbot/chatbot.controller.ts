import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ChatbotService } from './chatbot.service';
import { MetaSignatureGuard } from './guards/meta-signature.guard';

interface FlowEndpointBody {
  encrypted_aes_key: string;
  encrypted_flow_data: string;
  initial_vector: string;
}

@Controller('chatbot')
export class ChatbotController {
  private readonly logger = new Logger(ChatbotController.name);

  constructor(private readonly chatbotService: ChatbotService) {}

  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() response: Response,
  ) {
    const verifyToken = process.env.META_VERIFY_TOKEN;

    if (mode && token) {
      if (mode === 'subscribe' && token === verifyToken) {
        return response.status(HttpStatus.OK).send(challenge);
      } else {
        return response.sendStatus(HttpStatus.FORBIDDEN);
      }
    }
    return response.sendStatus(HttpStatus.BAD_REQUEST);
  }

  @Post('webhook')
  @UseGuards(MetaSignatureGuard)
  async handleWebhook(@Req() request: Request, @Res() response: Response, @Body() body: unknown) {
    // Acknowledge Meta immediately to avoid timeouts
    response.status(HttpStatus.OK).send('EVENT_RECEIVED');

    // Asynchronously handle the incoming message
    try {
      await this.chatbotService.handleIncomingMessage(body);
    } catch (error) {
      // Log the error but do not change the response sent to Meta
      this.logger.error('Error handling incoming message:', error);
    }
  }

  @Post('flow-endpoint')
  async handleFlowEndpoint(@Body() body: FlowEndpointBody, @Res() response: Response) {
    // Flow endpoints are decrypted and encrypted using the ChatbotService
    try {
      const encryptedResponse = await this.chatbotService.handleEncryptedFlowDataExchange(body);
      return response.status(HttpStatus.OK).send(encryptedResponse);
    } catch (error) {
      this.logger.error('Error in encrypted flow endpoint:', error);
      // Meta expects an encrypted response or a plain text error, not a JSON object
      return response
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .send('Error processing secure flow request.');
    }
  }
}
