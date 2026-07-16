import { Injectable } from '@nestjs/common';
import { IStepHandler } from '../step-handler.interface';
import { Steps } from '../../enums/steps.enum';
import { UserState } from '../../interfaces/userState.interface';
import { MetaMessage } from '../../interfaces/webhook.interface';
import { MetaWhatsappService } from '../../services/meta-whatsapp.service';
import { ChatbotStateService } from '../../services/chatbot-state.service';

@Injectable()
export class AwaitingFlowInteractionStep implements IStepHandler {
  constructor(
    private readonly metaWhatsappService: MetaWhatsappService,
    private readonly stateService: ChatbotStateService,
  ) {}

  canHandle(step: Steps): boolean {
    return step === Steps.AWAITING_FLOW_INTERACTION;
  }
  async execute(phone: string, message: MetaMessage, state: UserState): Promise<void> {
    const text = message.text?.body?.trim() || '';
    if (text) {
      state.step = Steps.AWAITING_DOC_INFO_MANUAL;
      await this.stateService.setState(phone, state);

      await this.metaWhatsappService.sendMessage(
        phone,
        'Parece que tuviste problemas con el formulario. Continuaremos con el proceso por aquí.\n\nPor favor, ingresa tu tipo y número de documento (Ejemplo: V-1234567).',
      );
    }
  }
}
