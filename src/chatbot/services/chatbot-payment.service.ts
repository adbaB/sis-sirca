import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DateTime } from 'luxon';
import { BillingService } from '../../billing/services/billing.service';
import { PersonsService } from '../../persons/services/persons.service';
import { MetaWhatsappService } from './meta-whatsapp.service';
import { ChatbotStateService } from './chatbot-state.service';
import { UserState } from '../interfaces/userState.interface';

@Injectable()
export class ChatbotPaymentService {
  private readonly logger = new Logger(ChatbotPaymentService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly billingService: BillingService,
    private readonly personsService: PersonsService,
    private readonly metaWhatsappService: MetaWhatsappService,
    private readonly stateService: ChatbotStateService,
  ) {}

  async processPaymentForInvoices(
    fromNumber: string,
    state: UserState,
    referenceNumber: string,
    extractedAmount: number | undefined,
  ): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();

    let isTransactionActive = false;
    let paymentsCreated = 0;
    let personId: string | undefined;

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();
      isTransactionActive = true;

      const paymentMethod = state.payment_method || 'transferencia';
      const receiptUrl = state.extracted_data?.receiptUrl as string | undefined;
      const datePaymentReceipt = DateTime.now().setZone('America/Caracas').toISODate() ?? undefined;
      const hasAmount = typeof extractedAmount === 'number' && !isNaN(extractedAmount);

      // Build OCR metadata to persist alongside the payment (exclude receiptUrl which has its own column)
      let ocrMetadata: Record<string, unknown> | undefined;
      if (state.extracted_data) {
        const ocrFields = { ...state.extracted_data };
        delete ocrFields.receiptUrl;
        if (Object.keys(ocrFields).length > 0) {
          ocrMetadata = ocrFields;
        }
      }

      if (state.identity_card && state.type_identity_card) {
        try {
          const person = await this.personsService.findByIdentityCard(
            state.identity_card,
            state.type_identity_card,
          );
          if (person) {
            personId = person.id;
          }
        } catch {
          this.logger.warn(
            `Error looking up person for ${state.type_identity_card}-${state.identity_card}`,
          );
        }
      }

      if (state.selected_invoices_details && state.selected_invoices_details.length > 0) {
        const totalExpectedUsd =
          state.selected_invoices_details.reduce((sum, inv) => sum + inv.amount, 0) || 1;

        for (const invoice of state.selected_invoices_details) {
          const weight = invoice.amount / totalExpectedUsd;

          let amount = invoice.amount;
          let currentAmountExtracted: number | undefined;

          if (paymentMethod === 'zelle') {
            amount = hasAmount ? extractedAmount * weight : invoice.amount;
          } else {
            currentAmountExtracted = hasAmount ? extractedAmount * weight : undefined;
          }

          await this.billingService.createPayment(
            {
              invoiceId: invoice.id,
              amount: amount,
              amountExtracted: currentAmountExtracted,
              paymentMethod,
              referenceNumber,
              url: receiptUrl,
              personId,
              datePaymentReceipt,
              metadata: ocrMetadata,
            },
            queryRunner,
          );
          paymentsCreated++;
        }
      } else if (state.selected_invoices && state.selected_invoices.length > 0) {
        const invoicesList = Array.isArray(state.selected_invoices)
          ? state.selected_invoices
          : String(state.selected_invoices)
              .split(',')
              .map((id) => id.trim());

        const invoices = await this.billingService.findInvoicesByIds(invoicesList);
        const fallbackTotalUsd =
          invoices.reduce(
            (sum, inv) => sum + (Number(inv.totalAmount) - Number(inv.paidAmount)),
            0,
          ) || 1;

        for (const invoice of invoices) {
          const pendingUsd = Number(invoice.totalAmount) - Number(invoice.paidAmount);
          const weight = pendingUsd / fallbackTotalUsd;

          let amount = pendingUsd;
          let currentAmountExtracted: number | undefined;

          if (paymentMethod === 'zelle') {
            amount = hasAmount ? extractedAmount * weight : pendingUsd;
          } else {
            currentAmountExtracted = hasAmount ? extractedAmount * weight : undefined;
          }

          await this.billingService.createPayment(
            {
              invoiceId: invoice.id,
              amount: amount,
              amountExtracted: currentAmountExtracted,
              paymentMethod,
              referenceNumber,
              url: receiptUrl,
              personId,
              datePaymentReceipt,
              metadata: ocrMetadata,
            },
            queryRunner,
          );
          paymentsCreated++;
        }
      }

      if (paymentsCreated === 0) {
        this.logger.warn(`No payments created for ${fromNumber} - no invoices found in state`);
      }

      await queryRunner.commitTransaction();
      isTransactionActive = false;
    } catch (e) {
      if (isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      this.logger.error(
        `Error saving payment for ${fromNumber} after ${paymentsCreated} successful invoice payments. Transaction rolled back.`,
        e,
      );
      await this.metaWhatsappService.sendMessage(
        fromNumber,
        '¡Oh, no! Tuve un inconveniente al intentar guardar los datos de tu pago. 😰\n\nPor favor, contacta a nuestro equipo Administrativo para solucionarlo de inmediato. ¡Lamentamos las molestias!',
      );
      return;
    } finally {
      await queryRunner.release();
    }

    try {
      await this.stateService.clearState(fromNumber);
      await this.metaWhatsappService.sendMessage(
        fromNumber,
        '¡Excelente noticia! 🎉 Tu pago ha sido registrado con éxito.\n\nYa notifiqué a nuestro equipo administrativo para que lo validen. ¡Gracias por confiar en SIRCA! Estás en buenas manos. ✨',
      );
    } catch (notificationError) {
      this.logger.error('Error sending post-payment notifications', notificationError);
    }
  }
}
