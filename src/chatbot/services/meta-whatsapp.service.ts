import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';

import config from '../../config/configurations';
import axios from 'axios';
import * as crypto from 'crypto';
import {
  MetaTemplateComponent,
  MetaTemplateParameter,
  MetaTemplatePayload,
  MetaTemplateVariables,
} from '../interfaces/meta-template.interface';

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

  private formatAxiosError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const statusText = error.response?.statusText;
      const data = error.response?.data;
      const dataStr = data
        ? typeof data === 'object'
          ? JSON.stringify(data)
          : String(data)
        : error.message;
      return `[HTTP ${status ?? 'N/A'}${statusText ? ` ${statusText}` : ''}] Details: ${dataStr}`;
    }
    return error instanceof Error ? error.message : String(error);
  }

  private sanitizeRecipientPhone(phone: string): string {
    return phone ? phone.replace(/\D/g, '') : '';
  }

  public async sendMessage(to: string, text: string): Promise<void> {
    const accessToken = this.configService.meta.accessToken;
    const phoneNumberId = this.configService.meta.phoneNumberId;

    if (!accessToken || !phoneNumberId) {
      throw new Error('Missing Meta access token or phone number ID in configuration.');
    }

    const cleanTo = this.sanitizeRecipientPhone(to);
    if (!cleanTo) {
      throw new Error(`Invalid recipient phone number: "${to}"`);
    }

    try {
      await axios.post(
        this.baseUrl,
        {
          messaging_product: 'whatsapp',
          to: cleanTo,
          text: { body: text },
        },
        {
          headers: this.getHeaders(),
          timeout: 15000,
        },
      );
    } catch (error) {
      const details = this.formatAxiosError(error);
      this.logger.error(
        `Error sending message to ${to} (${cleanTo}): ${details}`,
        error instanceof Error ? error.stack : undefined,
      );
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

    const cleanTo = this.sanitizeRecipientPhone(to);
    if (!cleanTo) {
      throw new Error(`Invalid recipient phone number: "${to}"`);
    }

    try {
      await axios.post(
        this.baseUrl,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanTo,
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
      const details = this.formatAxiosError(error);
      this.logger.error(
        `Error sending interactive message to ${to} (${cleanTo}): ${details}`,
        error instanceof Error ? error.stack : undefined,
      );
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

    const cleanTo = this.sanitizeRecipientPhone(to);
    if (!cleanTo) {
      this.logger.error(`Invalid recipient phone number for flow message: "${to}"`);
      return null;
    }

    try {
      const response = await axios.post(
        this.baseUrl,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanTo,
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
      const details = this.formatAxiosError(error);
      this.logger.error(
        `Error sending flow message to ${to} (${cleanTo}): ${details}`,
        error instanceof Error ? error.stack : undefined,
      );
      return null;
    }
  }

  public async sendTemplateMessage(
    to: string,
    templateName: string,
    variables: MetaTemplateVariables = {},
    languageCode?: string,
    flowToken?: string,
  ): Promise<void> {
    const accessToken = this.configService.meta.accessToken;
    const phoneNumberId = this.configService.meta.phoneNumberId;

    if (!accessToken || !phoneNumberId) {
      throw new Error('Missing Meta access token or phone number ID in configuration.');
    }

    const cleanTo = this.sanitizeRecipientPhone(to);
    if (!cleanTo) {
      throw new Error(`Invalid recipient phone number: "${to}"`);
    }

    const resolvedLanguageCode = languageCode || this.configService.meta.templateLanguage || 'es';

    const parameters: MetaTemplateParameter[] = Object.entries(variables).map(([key, value]) => ({
      type: 'text',
      parameter_name: key,
      text: String(value),
    }));

    const components: MetaTemplateComponent[] =
      parameters.length > 0 ? [{ type: 'body', parameters }] : [];

    if (flowToken) {
      components.push({
        type: 'button',
        sub_type: 'flow',
        index: '0',
        parameters: [
          {
            type: 'action',
            action: {
              flow_token: flowToken,
              flow_action_data: {
                screen: 'SCREEN_IDENTIFICATION',
              },
            },
          },
        ],
      });
    }

    const templatePayload: MetaTemplatePayload = {
      name: templateName,
      language: {
        code: resolvedLanguageCode,
      },
    };

    if (components.length > 0) {
      templatePayload.components = components;
    }

    const requestBody = {
      messaging_product: 'whatsapp',
      to: cleanTo,
      type: 'template',
      template: templatePayload,
    };

    try {
      await axios.post(this.baseUrl, requestBody, {
        headers: this.getHeaders(),
        timeout: 15000,
      });
    } catch (error) {
      const errorDetails = this.formatAxiosError(error);
      this.logger.error(
        `Error sending template "${templateName}" (${resolvedLanguageCode}) to ${to} (${cleanTo}): ${errorDetails}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
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
