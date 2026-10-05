import { Injectable } from '@nestjs/common';
import { IStepHandler } from '../step-handler.interface';
import { Steps } from '../../enums/steps.enum';
import { UserState } from '../../interfaces/userState.interface';
import { MetaMessage } from '../../interfaces/webhook.interface';
import { MetaWhatsappService } from '../../services/meta-whatsapp.service';
import { ChatbotStateService } from '../../services/chatbot-state.service';

@Injectable()
export class AwaitingZelleHolderStep implements IStepHandler {
  constructor(
    private readonly metaWhatsappService: MetaWhatsappService,
    private readonly stateService: ChatbotStateService,
  ) {}

  canHandle(step: Steps): boolean {
    return step === Steps.AWAITING_ZELLE_HOLDER;
  }

  async execute(phone: string, message: MetaMessage, state: UserState): Promise<void> {
    const text = (message.text?.body || '').trim();

    // Validación: al menos dos componentes con letras (nombre y apellido) y mínimo 3 caracteres
    const nameParts = text.split(/\s+/).filter((part) => /[a-zA-ZáéíóúÁÉÍÓÚñÑ]/.test(part));
    if (!text || text.length < 3 || nameParts.length < 2) {
      await this.metaWhatsappService.sendMessage(
        phone,
        'Por favor, ingresa un nombre y apellido válido para el titular de la cuenta Zelle (ejemplo: Juan Pérez).',
      );
      return;
    }

    state.zelle_holder_name = text;
    if (!state.extracted_data) {
      state.extracted_data = {};
    }
    state.extracted_data.titularZelle = text;

    const ref = (state.extracted_data?.referencia as string) || 'No detectada';
    const monto =
      state.extracted_data?.monto != null
        ? state.extracted_data.monto
        : state.total_amount || 'No detectado';
    const moneda = (state.extracted_data?.moneda as string) || '$';

    const buttons = [
      { type: 'reply', reply: { id: 'datos_correctos', title: 'Sí, son correctos' } },
      {
        type: 'reply',
        reply: { id: 'datos_incorrectos', title: 'Ingreso manual' },
      },
    ];

    await this.metaWhatsappService.sendInteractiveMessage(
      phone,
      `He revisado tu comprobante y esto es lo que encontré: ✨\n\n📝 *Referencia:* ${ref}\n💰 *Monto:* ${monto}${moneda}\n👤 *Titular Zelle:* ${text}\n\n¿Me confirmas si los datos están correctos para continuar? 👍`,
      buttons,
    );

    state.step = Steps.AWAITING_CONFIRMATION;
    await this.stateService.setState(phone, state);
  }
}
