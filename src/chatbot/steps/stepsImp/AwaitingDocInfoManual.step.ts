import { Injectable, Logger } from '@nestjs/common';
import { IStepHandler } from '../step-handler.interface';
import { Steps } from '../../enums/steps.enum';
import { UserState } from '../../interfaces/userState.interface';
import { MetaMessage } from '../../interfaces/webhook.interface';
import { MetaWhatsappService } from '../../services/meta-whatsapp.service';
import { ChatbotStateService } from '../../services/chatbot-state.service';
import { TypeIdentityCard } from '../../../persons/entities/person.entity';
import { BillingService } from '../../../billing/services/billing.service';

@Injectable()
export class AwaitingDocInfoManualStep implements IStepHandler {
  private readonly logger = new Logger(AwaitingDocInfoManualStep.name);
  constructor(
    private readonly metaWhatsappService: MetaWhatsappService,
    private readonly stateService: ChatbotStateService,
    private readonly billingService: BillingService,
  ) {}
  canHandle(step: Steps): boolean {
    return step === Steps.AWAITING_DOC_INFO_MANUAL;
  }
  async execute(phone: string, message: MetaMessage, state: UserState): Promise<void> {
    const text = message.text?.body?.trim() || '';
    if (!text) {
      await this.metaWhatsappService.sendMessage(
        phone,
        'Por favor, envía texto con tu tipo y número de documento.',
      );
      return;
    }
    const docMatch = text.match(/^([VvEeJjGg])[-]*(\d+)$/);
    if (!docMatch) {
      await this.metaWhatsappService.sendMessage(
        phone,
        'Formato inválido. Por favor ingresa el documento en este formato: V-1234567',
      );
      return;
    }

    const docType = docMatch[1].toUpperCase();
    const docNumber = docMatch[2];

    try {
      const invoices = await this.billingService.findPendingInvoicesByIdentityCard(
        docNumber,
        docType as TypeIdentityCard,
      );

      if (!invoices || invoices.length === 0) {
        await this.metaWhatsappService.sendMessage(
          phone,
          'No se encontraron facturas pendientes para este documento. Escribe "Hola" para reiniciar.',
        );
        await this.stateService.clearState(phone);
        return;
      }

      const pendingInvoices = invoices.map((inv) => ({
        id: inv.id,
        title: `Factura ${inv.billingMonth}`,
        description: `Contrato ${inv.contract?.code} - Monto: ${(Number(inv.totalAmount) - Number(inv.paidAmount)).toFixed(2)}`,
        amount: Number(inv.totalAmount) - Number(inv.paidAmount),
      }));

      state.step = Steps.AWAITING_INVOICE_SELECTION_MANUAL;
      state.pending_invoices = pendingInvoices;
      state.identity_card = docNumber;
      state.type_identity_card = docType as TypeIdentityCard;
      await this.stateService.setState(phone, state);

      let invoiceText = 'Hemos encontrado las siguientes facturas pendientes:\n\n';
      pendingInvoices.forEach((inv, index) => {
        invoiceText += `${index + 1}. ${inv.title} - ${inv.description}\n`;
      });
      invoiceText +=
        '\nPor favor, responde con los números de las facturas que deseas pagar, separados por comas (Ejemplo: 1, 2).';

      await this.metaWhatsappService.sendMessage(phone, invoiceText);
    } catch (error) {
      this.logger.error('Error fetching invoices manually', error);
      await this.metaWhatsappService.sendMessage(
        phone,
        'Hubo un error al buscar tus facturas. Inténtalo más tarde.',
      );
      await this.stateService.clearState(phone);
    }
  }
}
