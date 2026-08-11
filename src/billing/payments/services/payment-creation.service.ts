import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryRunner, Repository } from 'typeorm';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { Payment, PaymentOrigin, PaymentStatus } from '../entities/payment.entity';
import { Invoice, InvoiceStatus } from '../../invoices/entities/invoice.entity';
import { ExchangeRate } from '../../../exchange-rate/entities/Exchange-rate.entity';
import { ExchangeRateService } from '../../../exchange-rate/services/exchange-rate.service';
import { InvoiceService } from '../../invoices/services/invoice.service';
import { SurplusService } from './surplus.service';
import { PaymentSplit, TransactionResult } from '../interfaces/payment.interface';
import {
  parseDateToCaracas,
  getCaracasTodayJSDate,
  formatToISODateString,
} from '../../../common/utils/date.util';
import { resolveQueryRunner } from '../../../common/context/request-context';
import { Transactional } from '../../../common/decorators/transactional.decorator';
import { validateAmounts, resolveAmountUsd, round2 } from '../utils/payment-calculator.util';

/**
 * Servicio especializado en la creación transaccional de pagos.
 *
 * Se encarga de validar montos, bloquear pesimísticamente facturas en orden determinista
 * para evitar deadlocks, resolver la tasa de cambio aplicable, imputar abonos a una o
 * múltiples facturas y generar excedentes/saldos a favor según corresponda.
 */
@Injectable()
export class PaymentCreationService {
  private readonly logger = new Logger(PaymentCreationService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly dataSource: DataSource,
    private readonly exchangeRateService: ExchangeRateService,
    private readonly invoiceService: InvoiceService,
    private readonly surplusService: SurplusService,
  ) {}

  /**
   * Punto de entrada principal para registrar y abonar un pago en la base de datos.
   * Ejecutado dentro del contexto de una transacción mediante `@Transactional()`.
   *
   * @param createPaymentDto - DTO con la información enviada del pago.
   * @param externalQueryRunner - Instancia opcional de QueryRunner en caso de transacciones externas.
   * @returns Promesa con el resultado estructurado {@link TransactionResult}.
   * @throws BadRequestException Si los montos o formatos de fecha son inválidos.
   */
  @Transactional()
  async createPayment(
    createPaymentDto: CreatePaymentDto,
    externalQueryRunner?: QueryRunner,
  ): Promise<TransactionResult> {
    const amount = createPaymentDto.amount ? Number(createPaymentDto.amount) : 0;
    const amountExtracted = createPaymentDto.amountExtracted
      ? Number(createPaymentDto.amountExtracted)
      : 0;

    validateAmounts(createPaymentDto, amount, amountExtracted);

    const queryRunner = resolveQueryRunner(externalQueryRunner, this.dataSource);

    return this.executePaymentTransaction(createPaymentDto, amount, amountExtracted, queryRunner);
  }

  /**
   * Resuelve la fecha de pago del recibo a partir de la cadena proporcionada en el DTO (en zona horaria Caracas).
   * Si no se especifica una fecha, retorna la fecha actual de Caracas.
   *
   * @param dto - DTO de creación del pago.
   * @returns Objeto `Date` válido.
   * @throws BadRequestException Si el formato de la fecha es inválido.
   */
  private resolvePaymentDate(dto: CreatePaymentDto): Date {
    if (dto.datePaymentReceipt) {
      const isZelle = dto.paymentMethod?.toLowerCase() === 'zelle';
      const dt = parseDateToCaracas(dto.datePaymentReceipt, isZelle);
      if (!dt.isValid) {
        throw new BadRequestException('Formato de fecha de recibo inválido');
      }
      return dt.toJSDate();
    }
    return getCaracasTodayJSDate();
  }

  /**
   * Obtiene las facturas objetivo aplicando un bloqueo de escritura pesimista (`pessimistic_write`)
   * con ordenamiento determinista de los IDs para prevenir deadlocks en transacciones concurrentes.
   * Valida además que ninguna factura esté cancelada ni pagada.
   *
   * @param queryRunner - Instancia activa de QueryRunner.
   * @param invoiceIds - Arreglo de IDs de facturas a consultar y bloquear.
   * @returns Lista de facturas ordenadas cronológicamente por su mes de facturación (`billingMonth`).
   * @throws NotFoundException Si alguna factura especificada no existe.
   * @throws BadRequestException Si alguna factura está en estado CANCELLED o PAID.
   */
  private async fetchAndValidateInvoices(
    queryRunner: QueryRunner,
    invoiceIds: string[],
  ): Promise<Invoice[]> {
    if (invoiceIds.length === 0) {
      throw new BadRequestException('Se debe especificar al menos una factura.');
    }

    // Sort IDs alphabetically to guarantee deterministic lock acquisition order across concurrent transactions
    const sortedIds = [...invoiceIds].sort();

    const invoices = await queryRunner.manager
      .createQueryBuilder(Invoice, 'invoice')
      .setQueryRunner(queryRunner)
      .innerJoinAndSelect('invoice.contract', 'contract')
      .where('invoice.id IN (:...ids)', { ids: sortedIds })
      .setLock('pessimistic_write')
      .getMany();

    const uniqueIds = Array.from(new Set(invoiceIds));
    if (invoices.length !== uniqueIds.length) {
      throw new NotFoundException(
        'Algunas de las facturas especificadas no existen o no pudieron ser encontradas.',
      );
    }

    for (const invoice of invoices) {
      if (invoice.status === InvoiceStatus.CANCELLED) {
        throw new BadRequestException(
          `La factura con ID ${invoice.id} está cancelada y no puede recibir pagos.`,
        );
      }
      if (invoice.status === InvoiceStatus.PAID) {
        throw new BadRequestException(
          `La factura con ID ${invoice.id} ya está completamente pagada.`,
        );
      }
    }

    // Sort invoices chronologically by billingMonth
    return invoices.sort((a, b) => a.billingMonth.localeCompare(b.billingMonth));
  }

  /**
   * Executes the database operations within the active transaction:
   * fetches invoices, computes amounts, persists payment(s) and optional surplus,
   * recalculates invoice status, and returns a typed result.
   */
  private async executePaymentTransaction(
    dto: CreatePaymentDto,
    amount: number,
    amountExtracted: number,
    queryRunner: QueryRunner,
  ): Promise<TransactionResult> {
    // Resolve payment date and exchange rate BEFORE starting DB operations
    const paymentDate = this.resolvePaymentDate(dto);
    const operationDate = getCaracasTodayJSDate();
    const exchangeRate = await this.getExchangeRateOrThrow(paymentDate, operationDate);

    // Normalize invoiceIds
    const rawInvoiceIds =
      dto.invoiceIds && dto.invoiceIds.length > 0
        ? dto.invoiceIds
        : dto.invoiceId
          ? [dto.invoiceId]
          : [];

    // Fetch all invoices with deterministic pessimistic lock order
    const invoices = await this.fetchAndValidateInvoices(queryRunner, rawInvoiceIds);

    // Resolve total payment amount in USD and Bs
    const totalAmountUsd = resolveAmountUsd(dto, amount, exchangeRate.rateUsd);
    const isZelle = dto.paymentMethod.toLowerCase() === 'zelle';
    const totalAmountBs = !isZelle ? round2(amountExtracted) : 0;

    let remainingUsd = totalAmountUsd;
    let remainingBs = totalAmountBs;

    const savedPayments: Payment[] = [];
    let surplusId: string | null = null;
    let surplusAmountUsd: number | null = null;
    let surplusAmountBs: number | null = null;

    for (let i = 0; i < invoices.length; i++) {
      const invoice = invoices[i];

      if (remainingUsd <= 0 && remainingBs <= 0) {
        break;
      }

      const isLastInvoice = i === invoices.length - 1;

      const invoiceUnpaidAmount = round2(
        Math.max(
          0,
          Number(invoice.totalAmount) -
            Number(invoice.retentionAmount || 0) -
            Number(invoice.paidAmount),
        ),
      );

      if (invoiceUnpaidAmount <= 0 && !isLastInvoice) {
        continue;
      }

      let appliedUsd: number;
      let appliedBs: number;

      if (isLastInvoice) {
        if (remainingUsd > invoiceUnpaidAmount) {
          appliedUsd = invoiceUnpaidAmount;
          surplusAmountUsd = round2(remainingUsd - invoiceUnpaidAmount);
          if (!isZelle) {
            surplusAmountBs = round2(surplusAmountUsd * exchangeRate.rateUsd);
            appliedBs = Math.max(0, round2(remainingBs - surplusAmountBs));
          } else {
            appliedBs = 0;
          }
        } else {
          appliedUsd = remainingUsd;
          appliedBs = remainingBs;
        }
      } else {
        appliedUsd = round2(Math.min(remainingUsd, invoiceUnpaidAmount));
        if (!isZelle) {
          appliedBs = round2(Math.min(remainingBs, appliedUsd * exchangeRate.rateUsd));
        } else {
          appliedBs = 0;
        }
      }

      const split: PaymentSplit = {
        paymentAmountUsd: appliedUsd,
        paymentAmountBs: appliedBs,
        surplusAmountUsd,
        surplusAmountBs,
      };

      const savedPayment = await this.persistPayment(queryRunner, dto, invoice, split, paymentDate);
      savedPayments.push(savedPayment);

      if (isLastInvoice && (surplusAmountUsd || surplusAmountBs)) {
        surplusId = await this.surplusService.persistSurplus(
          queryRunner,
          invoice,
          savedPayment,
          paymentDate,
          surplusAmountUsd,
          surplusAmountBs,
        );
      }

      remainingUsd = round2(remainingUsd - appliedUsd);
      remainingBs = round2(remainingBs - appliedBs);
    }

    for (const invId of rawInvoiceIds) {
      await this.invoiceService.recalculateInvoicePaidAmount(invId, queryRunner);
    }

    const totalInvoiceDebtUsd = round2(
      invoices.reduce(
        (sum, inv) =>
          sum +
          Math.max(
            0,
            Number(inv.totalAmount) - Number(inv.retentionAmount || 0) - Number(inv.paidAmount),
          ),
        0,
      ),
    );

    const remainingUnpaidUsd = round2(Math.max(0, totalInvoiceDebtUsd - totalAmountUsd));
    const remainingUnpaidBs = round2(remainingUnpaidUsd * exchangeRate.rateUsd);

    return {
      savedPayment: savedPayments[0] || ({} as Payment),
      savedPayments,
      invoice: invoices[0],
      surplusId,
      surplusAmountUsd,
      surplusAmountBs,
      paymentDate,
      remainingUnpaidUsd,
      remainingUnpaidBs,
    };
  }

  private async getExchangeRateOrThrow(date: Date, fallbackDate?: Date): Promise<ExchangeRate> {
    let exchangeRate = await this.exchangeRateService.getExchangeRateByDate(date);
    if (
      !exchangeRate &&
      fallbackDate &&
      formatToISODateString(date) !== formatToISODateString(fallbackDate)
    ) {
      this.logger.warn(
        `Exchange rate not found for payment date ${formatToISODateString(
          date,
        )}. Attempting fallback to operation date ${formatToISODateString(fallbackDate)}.`,
      );
      exchangeRate = await this.exchangeRateService.getExchangeRateByDate(fallbackDate);
    }

    if (!exchangeRate) {
      const dateFormatted = formatToISODateString(date);
      throw new BadRequestException(
        `No se encontró la tasa de cambio para la fecha ${dateFormatted}.`,
      );
    }
    return exchangeRate;
  }

  private async persistPayment(
    queryRunner: QueryRunner,
    dto: CreatePaymentDto,
    invoice: Invoice,
    split: PaymentSplit,
    paymentDate: Date,
  ): Promise<Payment> {
    const operationDate = getCaracasTodayJSDate();

    const payment = queryRunner.manager.create(Payment, {
      paymentDate,
      operationDate,
      origin: dto.origin || PaymentOrigin.WEB,
      status: PaymentStatus.PROCESSING,
      invoice,
      person: dto.personId ? { id: dto.personId } : null,
      referenceNumber: dto.referenceNumber,
      amount: split.paymentAmountUsd,
      amountBs: split.paymentAmountBs,
      paymentMethod: dto.paymentMethod,
      url: dto.url,
      metadata: dto.metadata ?? null,
    }) as Payment;

    return queryRunner.manager.save(payment);
  }
}
