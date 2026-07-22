import { Inject, Injectable, Logger } from '@nestjs/common';
import config from '../../config/configurations';
import { ConfigType } from '@nestjs/config';
import { FlowsCryptoUtil } from '../utils/flows-crypto.util';
import {
  FlowDecryptedPayload,
  FlowEncryptedRequest,
  FlowResponse,
} from '../interfaces/flow.interface';
import { FlowActionHandler } from '../steps/flow-handler.interface';

@Injectable()
export class MetaFlowService {
  private readonly logger = new Logger(MetaFlowService.name);

  constructor(
    @Inject(config.KEY) private readonly configService: ConfigType<typeof config>,
    @Inject('FLOW_HANDLERS') private readonly flowHandlers: FlowActionHandler[],
  ) {}

  async handleEncryptedFlowDataExchange(body: FlowEncryptedRequest): Promise<string> {
    const privateKey = this.configService.meta.flowPrivateKey;
    const passphrase = this.configService.meta.flowPassphrase;

    if (!privateKey) {
      this.logger.warn(
        'META_FLOW_PRIVATE_KEY not set. Flow Data Exchange cannot decrypt payload securely.',
      );
      throw new Error('Server not configured for secure Flow exchange.');
    }

    const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;

    if (!encrypted_aes_key || !encrypted_flow_data || !initial_vector) {
      throw new Error('Missing encrypted data fields in request.');
    }

    try {
      const decryptedAesKey = FlowsCryptoUtil.decryptAesKey(
        encrypted_aes_key,
        privateKey,
        passphrase,
      );
      const decryptedPayload = FlowsCryptoUtil.decryptPayload(
        decryptedAesKey,
        encrypted_flow_data,
        initial_vector,
      );

      // Debug: Meta Flow Data Exchange a veces hace "checks" (handshake/health).
      // Logueamos lo mínimo para poder identificar la acción sin exponer payload completo.
      const action = (decryptedPayload as Record<string, unknown>)?.action as string | undefined;
      const data = ((decryptedPayload as Record<string, unknown>)?.data || {}) as Record<
        string,
        unknown
      >;
      const dataAction = data?.action as string | undefined;
      this.logger.log(
        `[FlowDataExchange] action=${action ?? 'undefined'} data.action=${dataAction ?? 'undefined'} dataKeys=${
          Object.keys(data).join(',') || 'none'
        }`,
      );

      const responseObj = await this.actionRouter(decryptedPayload);

      return FlowsCryptoUtil.encryptResponse(responseObj, decryptedAesKey, initial_vector);
    } catch (e) {
      this.logger.error('Error decrypting or encrypting flow data exchange:', e);
      throw e;
    }
  }

  async actionRouter(body: FlowDecryptedPayload): Promise<FlowResponse> {
    const action = body.action?.toUpperCase();

    // Respuesta esperada para tests/health checks del Flow (evita caer en "Acción no reconocida").
    if (['CHECK', 'PING', 'STATUS', 'VERIFICATION'].includes(action || '')) {
      return { screen: 'SCREEN_IDENTIFICATION', data: { status: 'active' } };
    }

    if (action === 'INIT') {
      return { screen: 'SCREEN_IDENTIFICATION', data: {} };
    }
    if (action === 'DATA_EXCHANGE') {
      const data = body.data || {};
      const dataAction = data.action;

      if (
        dataAction === 'fetch_invoices' ||
        (!dataAction && body.screen === 'SCREEN_IDENTIFICATION')
      ) {
        if (
          !data.doc_number ||
          !data.doc_type ||
          typeof data.doc_number !== 'string' ||
          typeof data.doc_type !== 'string'
        ) {
          return {
            screen: 'SCREEN_IDENTIFICATION',
            data: { error: true, error_message: 'Tipo y número de documento son requeridos.' },
          };
        }
      }

      if (
        dataAction === 'fetch_payment_details' ||
        (!dataAction && body.screen === 'SCREEN_PAYMENT_METHOD')
      ) {
        if (
          !data.payment_method ||
          typeof data.payment_method !== 'string' ||
          !['transferencia', 'pago_movil', 'zelle'].includes(data.payment_method)
        ) {
          return {
            screen: 'SCREEN_INVOICES',
            data: { error: true, error_message: 'Método de pago inválido.' },
          };
        }
        if (!Array.isArray(data.selected_invoices)) {
          return {
            screen: 'SCREEN_INVOICES',
            data: { error: true, error_message: 'Debe seleccionar al menos una factura válida.' },
          };
        }
      }

      for (const handler of this.flowHandlers) {
        if (handler.canHandle(body)) {
          return handler.handle(data);
        }
      }
    }

    return {
      screen: 'SCREEN_IDENTIFICATION',
      data: { error: true, error_message: 'Acción no reconocida.' },
    };
  }
}
