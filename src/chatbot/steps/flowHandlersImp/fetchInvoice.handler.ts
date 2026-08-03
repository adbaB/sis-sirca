import { Injectable } from '@nestjs/common';
import { TypeIdentityCard } from '../../../persons/entities/person.entity';
import {
  FetchInvoicesData,
  FlowDecryptedPayload,
  FlowResponse,
} from '../../interfaces/flow.interface';
import { FlowActionHandler } from '../flow-handler.interface';
import { InvoiceService } from '../../../billing/invoices/services/invoice.service';

@Injectable()
export class FetchInvoiceHandler implements FlowActionHandler {
  constructor(private readonly invoiceService: InvoiceService) {}

  canHandle(payload: FlowDecryptedPayload): boolean {
    const dataAction = payload.data?.action;
    return (
      dataAction === 'fetch_invoices' || (!dataAction && payload.screen === 'SCREEN_IDENTIFICATION')
    );
  }
  async handle(data: Record<string, unknown>): Promise<FlowResponse> {
    const { doc_number, doc_type } = data as unknown as FetchInvoicesData;

    const invoices = await this.invoiceService.findPendingInvoicesByIdentityCard(
      doc_number,
      doc_type as TypeIdentityCard,
    );
    if (!invoices || invoices.length === 0) {
      return {
        screen: 'SCREEN_IDENTIFICATION',
        data: {
          error: true,
          error_message: 'No se encontraron facturas pendientes para este documento.',
        },
      };
    }

    const mappedInvoices = invoices.map((inv) => ({
      id: inv.id,
      title: `Factura ${inv.billingMonth}`,
      description: `Contrato ${inv.contract?.code} - Monto: ${(Number(inv.totalAmount) - Number(inv.paidAmount)).toFixed(2)}$`,
    }));

    return {
      screen: 'SCREEN_INVOICES',
      data: {
        invoices: mappedInvoices,
        doc_type: doc_type,
        doc_number: doc_number,
      },
    };
  }
}
