import { Injectable } from '@nestjs/common';
import { Steps } from '../../enums/steps.enum';
import { UserState } from '../../interfaces/userState.interface';
import { MetaMessage } from '../../interfaces/webhook.interface';
import { IStepHandler } from '../step-handler.interface';
import { ChatbotStateService } from '../../services/chatbot-state.service';
import { MetaWhatsappService } from '../../services/meta-whatsapp.service';

@Injectable()
export class AwaitingInvoiceSelectionManualStep implements IStepHandler {
  constructor(
    private readonly metaWhatsappService: MetaWhatsappService,
    private readonly stateService: ChatbotStateService,
  ) {}
  canHandle(step: Steps): boolean {
    return step === Steps.AWAITING_INVOICE_SELECTION_MANUAL;
  }
  async execute(phone: string, message: MetaMessage, state: UserState): Promise<void> {
    const text = message.text?.body?.trim() || '';
    if (!text) {
      await this.metaWhatsappService.sendMessage(
        phone,
        'Por favor, responde con los números de las facturas.',
      );
      return;
    }
    // Deduplicate the choices to prevent double-charging for the same invoice selection (e.g. "1, 1")
    const selections = [
      ...new Set(
        text
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n)),
      ),
    ];

    if (selections.length === 0 || !state.pending_invoices) {
      await this.metaWhatsappService.sendMessage(
        phone,
        'Selección inválida. Por favor, responde con los números de las facturas separados por comas.',
      );
      return;
    }

    const selectedInvoices: string[] = [];
    const selectedInvoicesDetails: Array<{ id: string; amount: number }> = [];
    let totalAmount = 0;

    for (const selection of selections) {
      const idx = selection - 1;
      if (idx >= 0 && idx < state.pending_invoices.length) {
        const inv = state.pending_invoices[idx];
        selectedInvoices.push(inv.id);
        selectedInvoicesDetails.push({ id: inv.id, amount: inv.amount });
        totalAmount += inv.amount;
      }
    }

    if (selectedInvoices.length === 0) {
      await this.metaWhatsappService.sendMessage(
        phone,
        'No ingresaste números de factura válidos. Inténtalo de nuevo.',
      );
      return;
    }

    state.step = Steps.AWAITING_PAYMENT_METHOD_MANUAL;
    state.selected_invoices = selectedInvoices;
    state.selected_invoices_details = selectedInvoicesDetails;
    state.total_amount = totalAmount.toFixed(2);
    await this.stateService.setState(phone, state);

    const buttons = [
      { type: 'reply', reply: { id: 'pm_transferencia', title: 'Transferencia' } },
      { type: 'reply', reply: { id: 'pm_pago_movil', title: 'Pago Móvil' } },
      { type: 'reply', reply: { id: 'pm_zelle', title: 'Zelle' } },
    ];

    await this.metaWhatsappService.sendInteractiveMessage(
      phone,
      `Has seleccionado ${selectedInvoices.length} factura(s).\nTotal a pagar: ${state.total_amount}\n\nSelecciona tu método de pago:`,
      buttons,
    );
  }
}
