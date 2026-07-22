import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';

import config from '../../config/configurations';
import axios from 'axios';
import * as crypto from 'crypto';

@Injectable()
export class MetaWhatsappService {
  private readonly logger = new Logger(MetaWhatsappService.name);

  constructor(@Inject(config.KEY) private readonly configService: ConfigType<typeof config>) {}

  private getHeaders() {
    return {
      Authorization: `Bearer ${this.configService.meta.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  private get baseUrl() {
    return `https://graph.facebook.com/v25.0/${this.configService.meta.phoneNumberId}/messages`;
  }

  public async sendMessage(to: string, text: string): Promise<void> {
    const accessToken = this.configService.meta.accessToken;
    const phoneNumberId = this.configService.meta.phoneNumberId;

    if (!accessToken || !phoneNumberId) {
      throw new Error('Missing Meta access token or phone number ID in configuration.');
    }

    try {
      await axios.post(
        this.baseUrl,
        {
          messaging_product: 'whatsapp',
          to,
          text: { body: text },
        },
        {
          headers: this.getHeaders(),
          timeout: 15000,
        },
      );
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.logger.error(`Error sending message to ${to}:`, error.response?.data || error.message);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Error sending message to ${to}:`, message);
      }
      throw error;
    }
  }

  public async sendInteractiveMessage(
    to: string,
    text: string,
    buttons: Array<{ type: string; reply: { id: string; title: string } }>,
  ): Promise<void> {
    const accessToken = this.configService.meta.accessToken;
    const phoneNumberId = this.configService.meta.phoneNumberId;

    if (!accessToken || !phoneNumberId) {
      throw new Error('Missing Meta access token or phone number ID in configuration.');
    }

    try {
      await axios.post(
        this.baseUrl,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text },
            action: { buttons },
          },
        },
        {
          headers: this.getHeaders(),
          timeout: 15000,
        },
      );
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.logger.error(
          `Error sending interactive message to ${to}:`,
          error.response?.data || error.message,
        );
      } else {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Error sending interactive message to ${to}:`, message);
      }
      throw error;
    }
  }

  public async sendFlowMessage(to: string, text: string): Promise<string | null> {
    const accessToken = this.configService.meta.accessToken;
    const phoneNumberId = this.configService.meta.phoneNumberId;
    const flowId = this.configService.meta.flowId;

    if (!accessToken || !phoneNumberId || !flowId) {
      this.logger.error('Missing Meta access token, phone number ID or flow ID in configuration.');
      return null;
    }

    try {
      const response = await axios.post(
        this.baseUrl,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'interactive',
          interactive: {
            type: 'flow',
            header: {
              type: 'text',
              text: 'Pago de Facturas',
            },
            body: {
              text,
            },
            footer: {
              text: 'Sirca Plan de salud',
            },
            action: {
              name: 'flow',
              parameters: {
                mode: this.configService.meta.flowMode,
                flow_message_version: '3',
                flow_token: crypto.randomUUID(),
                flow_id: flowId,
                flow_cta: 'Realizar pago',
                flow_action: 'navigate',
                flow_action_payload: {
                  screen: 'SCREEN_IDENTIFICATION',
                },
              },
            },
          },
        },
        {
          headers: this.getHeaders(),
          timeout: 15000,
        },
      );
      return response.data?.messages?.[0]?.id || null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.logger.error(
          `Error sending flow message to ${to}:`,
          error.response?.data || error.message,
        );
      } else {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Error sending flow message to ${to}:`, message);
      }
      return null;
    }
  }

  public async downloadMedia(mediaId: string): Promise<Buffer | null> {
    const mediaResponse = await axios.get(`https://graph.facebook.com/v25.0/${mediaId}`, {
      headers: this.getHeaders(),
    });
    const mediaUrl = mediaResponse.data.url;

    // 2. Download media buffer
    const response = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      headers: this.getHeaders(),
    });
    const buffer = Buffer.from(response.data, 'binary');
    return buffer;
  }
}
