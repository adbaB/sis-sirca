import { Injectable } from '@nestjs/common';
import {
  FetchPaymentData,
  FlowDecryptedPayload,
  FlowResponse,
} from '../../interfaces/flow.interface';
import { FlowActionHandler } from '../flow-handler.interface';
import { BillingService } from '../../../billing/services/billing.service';
import { TypeIdentityCard } from '../../../persons/entities/person.entity';

@Injectable()
export class FetchPaymentDetailHandler implements FlowActionHandler {
  constructor(private readonly billingService: BillingService) {}
  canHandle(payload: FlowDecryptedPayload): boolean {
    const dataAction = payload.data?.action;
    return (
      dataAction === 'fetch_payment_details' ||
      (!dataAction && payload.screen === 'SCREEN_PAYMENT_METHOD')
    );
  }
  async handle(data: Record<string, unknown>): Promise<FlowResponse> {
    const { payment_method, selected_invoices, doc_number, doc_type } =
      data as unknown as FetchPaymentData;

    if (!selected_invoices || selected_invoices.length === 0) {
      return {
        screen: 'SCREEN_INVOICES',
        data: {
          error: true,
          error_message: 'Debes seleccionar al menos una factura.',
        },
      };
    }

    // Security: Scope selected invoices to the supplied identity
    const userInvoices = await this.billingService.findPendingInvoicesByIdentityCard(
      doc_number,
      doc_type as TypeIdentityCard,
    );
    const validInvoiceIds = new Set((userInvoices || []).map((inv) => inv.id));
    for (const invId of selected_invoices) {
      if (!validInvoiceIds.has(invId)) {
        return {
          screen: 'SCREEN_INVOICES',
          data: {
            error: true,
            error_message: 'Una o más facturas seleccionadas no son válidas o no te pertenecen.',
          },
        };
      }
    }

    const totalAmount = await this.billingService.calculateAmountByInvoicesIds(
      selected_invoices,
      payment_method,
    );

    let paymentInfo = '';
    if (payment_method === 'transferencia') {
      paymentInfo =
        'Banco: Banco Nacional de Credito\nCuenta: 0191-0169-02-2100132011\nTitular: Salud Integral El Rosario C.A.\nRIF: J-501776385';
    } else if (payment_method === 'pago_movil') {
      paymentInfo = 'Banco: Banco Nacional de Credito\nTeléfono: 0412-7313398\nRIF: J-501776385';
    } else if (payment_method === 'zelle') {
      paymentInfo =
        'Zelle: platinumclubadmon2@gmail.com\nTitular: Platinum Club Corp\nCuenta Citi Bank: 9154165049\n';
    }

    return {
      screen: 'SCREEN_PAYMENT_DETAILS',
      data: {
        payment_info: paymentInfo,
        total_amount: `${totalAmount.toFixed(2)} ${payment_method === 'transferencia' || payment_method === 'pago_movil' ? 'Bs' : '$'}`,
        selected_invoices: selected_invoices,
        payment_method: payment_method,
        doc_type,
        doc_number,
      },
    };
  }
}
