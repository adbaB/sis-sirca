import { Injectable, Logger } from '@nestjs/common';
import { QueryRunner, EntityManager } from 'typeorm';
import { Invoice } from '../invoices/entities/invoice.entity';
import { Payment } from '../entities/payment.entity';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { InvoiceService } from '../invoices/services/invoice.service';
import { PaymentService } from '../payment/services/payment.service';
import { TypeIdentityCard } from '../../persons/entities/person.entity';
import { CreateAdditionalChargeDto } from '../dto/create-additional-charge.dto';
import { PdfService } from '../../pdf/services/pdf.service';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly paymentService: PaymentService,
  ) {}

  // ---------------------------------------------------------------------------
  // Payment Delegations
  // ---------------------------------------------------------------------------

  async createPayment(createPaymentDto: CreatePaymentDto, externalQueryRunner?: QueryRunner) {
    return this.paymentService.createPayment(createPaymentDto, externalQueryRunner);
  }

  async findPayments(
    page: number,
    limit: number,
    status?: string,
    search?: string,
    month?: number,
    year?: number,
  ) {
    return this.paymentService.findPayments(page, limit, status, search, month, year);
  }

  async countPendingPayments(): Promise<number> {
    return this.paymentService.countPendingPayments();
  }

  async approvePayment(id: string): Promise<Payment> {
    return this.paymentService.approvePayment(id);
  }

  async rejectPayment(id: string, reason: string): Promise<Payment> {
    return this.paymentService.rejectPayment(id, reason);
  }

  async updatePaymentDate(id: string, newDateStr: string): Promise<Payment> {
    return this.paymentService.updatePaymentDate(id, newDateStr);
  }

  // ---------------------------------------------------------------------------
  // Invoice Delegations
  // ---------------------------------------------------------------------------

  async findInvoicesByIds(ids: string[]): Promise<Invoice[]> {
    return this.invoiceService.findInvoicesByIds(ids);
  }

  async findPendingInvoicesByIdentityCard(
    identityCard: string,
    typeIdentityCard: TypeIdentityCard,
  ) {
    return this.invoiceService.findPendingInvoicesByIdentityCard(identityCard, typeIdentityCard);
  }

  async calculateAmountByInvoicesIds(ids: string[], paymentMethod: string): Promise<number> {
    return this.invoiceService.calculateAmountByInvoicesIds(ids, paymentMethod);
  }

  async recalculateInvoicePaidAmount(
    invoiceId: string,
    queryRunnerOrManager?: QueryRunner | EntityManager,
  ): Promise<void> {
    return this.invoiceService.recalculateInvoicePaidAmount(invoiceId, queryRunnerOrManager);
  }

  async recalculateInvoiceAmountFromContract(invoiceId: string): Promise<Invoice> {
    return this.invoiceService.recalculateInvoiceAmountFromContract(invoiceId);
  }

  async generateInvoiceForContract(contractId: string, billingMonth?: string) {
    return this.invoiceService.generateInvoiceForContract(contractId, billingMonth);
  }

  async buildInvoicePdf(
    invoiceId: string,
    pdfService: PdfService,
  ): Promise<{ pdfBuffer: Buffer; filename: string }> {
    return this.invoiceService.buildInvoicePdf(invoiceId, pdfService);
  }

  async addAdditionalCharge(invoiceId: string, dto: CreateAdditionalChargeDto): Promise<Invoice> {
    return this.invoiceService.addAdditionalCharge(invoiceId, dto);
  }

  async removeAdditionalCharge(invoiceId: string, lineId: string): Promise<Invoice> {
    return this.invoiceService.removeAdditionalCharge(invoiceId, lineId);
  }

  async removeAffiliateLineFromActiveInvoice(
    contractId: string,
    personId: string,
    manager?: EntityManager,
  ) {
    return this.invoiceService.removeAffiliateLineFromActiveInvoice(contractId, personId, manager);
  }

  async updatePlanLineOnActiveInvoice(
    contractId: string,
    personId: string,
    newPlanId: string,
    newPlanAmount: number,
    newPlanName: string,
  ): Promise<void> {
    return this.invoiceService.updatePlanLineOnActiveInvoice(
      contractId,
      personId,
      newPlanId,
      newPlanAmount,
      newPlanName,
    );
  }
}
