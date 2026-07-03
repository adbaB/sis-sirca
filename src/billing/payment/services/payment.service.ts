import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreatePaymentDto } from '../../dto/create-payment.dto';
import { DataSource, QueryRunner, Repository } from 'typeorm';
import { PaymentSplit, TransactionResult } from '../interfaces/payment.interface';
import { Invoice, InvoiceStatus } from '../../invoices/entities/invoice.entity';
import { Payment, PaymentStatus } from '../../entities/payment.entity';
import { ExchangeRate } from '../../../exchange-rate/entities/Exchange-rate.entity';
import { ExchangeRateService } from '../../../exchange-rate/services/exchange-rate.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Surplus, SurplusStatus } from '../../entities/surplus.entity';
import { InvoiceService } from '../../invoices/services/invoice.service';
import { SurplusService } from '../../services/surplus.service';
import {
  parseDateToCaracas,
  getCaracasTodayJSDate,
  formatToISODateString,
} from '../../../common/utils/date.util';

@Injectable()
export class PaymentService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly dataSource: DataSource,
    private readonly exchangeRateService: ExchangeRateService,
    private readonly invoiceService: InvoiceService,
    private readonly surplusService: SurplusService,
  ) {}

  async createPayment(createPaymentDto: CreatePaymentDto, externalQueryRunner?: QueryRunner) {
    const amount = createPaymentDto.amount ? Number(createPaymentDto.amount) : 0;
    const amountExtracted = createPaymentDto.amountExtracted
      ? Number(createPaymentDto.amountExtracted)
      : 0;

    this.validateAmounts(createPaymentDto, amount, amountExtracted);

    const queryRunner = externalQueryRunner || this.dataSource.createQueryRunner();
    const result = await this.executePaymentTransaction(
      createPaymentDto,
      amount,
      amountExtracted,
      queryRunner,
      externalQueryRunner,
    );

    return result;
  }

  // Private helpers — createPayment
  // ---------------------------------------------------------------------------

  /**
   * Executes the database transaction: fetches the invoice, computes amounts,
   * persists the payment and optional surplus, recalculates invoice status,
   * and commits. All mutable state is scoped inside this method and returned
   * as a typed result — eliminating the need for shared mutable variables.
   */
  private async executePaymentTransaction(
    dto: CreatePaymentDto,
    amount: number,
    amountExtracted: number,
    queryRunner: QueryRunner,
    externalQueryRunner: QueryRunner | undefined,
  ): Promise<TransactionResult> {
    if (!externalQueryRunner) {
      await queryRunner.connect();
      await queryRunner.startTransaction();
    }

    try {
      let paymentDate = getCaracasTodayJSDate();
      if (dto.datePaymentReceipt) {
        const isZelle = dto.paymentMethod?.toLowerCase() === 'zelle';
        const dt = parseDateToCaracas(dto.datePaymentReceipt, isZelle);
        if (!dt.isValid) {
          throw new BadRequestException('Formato de fecha de recibo inválido');
        }
        paymentDate = dt.toJSDate();
      }

      const exchangeRate = await this.getExchangeRateOrThrow(paymentDate);

      // Normalize invoiceIds
      const invoiceIds =
        dto.invoiceIds && dto.invoiceIds.length > 0
          ? dto.invoiceIds
          : dto.invoiceId
            ? [dto.invoiceId]
            : [];

      if (invoiceIds.length === 0) {
        throw new BadRequestException('Se debe especificar al menos una factura.');
      }

      // Fetch all invoices with lock
      const invoices = await queryRunner.manager
        .createQueryBuilder(Invoice, 'invoice')
        .setQueryRunner(queryRunner)
        .innerJoinAndSelect('invoice.contract', 'contract')
        .where('invoice.id IN (:...ids)', { ids: invoiceIds })
        .setLock('pessimistic_write')
        .getMany();

      if (invoices.length !== invoiceIds.length) {
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
      invoices.sort((a, b) => a.billingMonth.localeCompare(b.billingMonth));

      // Resolve total payment amount in USD and Bs
      const totalAmountUsd = this.resolveAmountUsd(dto, amount, exchangeRate.rateUsd);
      const isZelle = dto.paymentMethod.toLowerCase() === 'zelle';
      const totalAmountBs = !isZelle ? amountExtracted : 0;

      let remainingUsd = totalAmountUsd;
      let remainingBs = totalAmountBs;

      const savedPayments: Payment[] = [];
      let surplusId: string | null = null;
      let surplusAmountUsd: number | null = null;
      let surplusAmountBs: number | null = null;

      for (let i = 0; i < invoices.length; i++) {
        const invoice = invoices[i];

        // Stop processing if the payment amount has been completely exhausted
        if (remainingUsd <= 0 && remainingBs <= 0) {
          break;
        }

        const isLastInvoice = i === invoices.length - 1;

        const invoiceUnpaidAmount = Math.max(
          0,
          Number(invoice.totalAmount) -
            Number(invoice.retentionAmount || 0) -
            Number(invoice.paidAmount),
        );

        if (invoiceUnpaidAmount <= 0 && !isLastInvoice) {
          // If invoice is already paid and not the last one, skip
          continue;
        }

        // Calculate how much we apply to this invoice
        let appliedUsd = 0;
        let appliedBs = 0;

        if (isLastInvoice) {
          // Last invoice gets whatever is left, and can generate surplus
          if (remainingUsd > invoiceUnpaidAmount) {
            appliedUsd = invoiceUnpaidAmount;
            surplusAmountUsd = remainingUsd - invoiceUnpaidAmount;
            if (!isZelle) {
              surplusAmountBs = surplusAmountUsd * exchangeRate.rateUsd;
              appliedBs = remainingBs - surplusAmountBs;
            } else {
              appliedBs = 0;
            }
          } else {
            appliedUsd = remainingUsd;
            appliedBs = remainingBs;
          }
        } else {
          // Non-last invoice gets capped to unpaid amount
          appliedUsd = Math.min(remainingUsd, invoiceUnpaidAmount);
          if (!isZelle) {
            appliedBs = Math.min(remainingBs, appliedUsd * exchangeRate.rateUsd);
          } else {
            appliedBs = 0;
          }
        }

        // Persist payment for this invoice
        const split = {
          paymentAmountUsd: appliedUsd,
          paymentAmountBs: appliedBs,
          surplusAmountUsd,
          surplusAmountBs,
        };

        const savedPayment = await this.persistPayment(
          queryRunner,
          dto,
          invoice,
          split,
          paymentDate,
        );
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

        // Reduce remaining amounts
        remainingUsd -= appliedUsd;
        remainingBs -= appliedBs;
      }

      // Recalculate all affected invoices
      for (const invId of invoiceIds) {
        await this.invoiceService.recalculateInvoicePaidAmount(invId, queryRunner);
      }

      if (!externalQueryRunner) {
        await queryRunner.commitTransaction();
      }

      // Calculate total unpaid debt of the invoices BEFORE this payment
      const totalInvoiceDebtUsd = invoices.reduce(
        (sum, inv) =>
          sum +
          Math.max(
            0,
            Number(inv.totalAmount) - Number(inv.retentionAmount || 0) - Number(inv.paidAmount),
          ),
        0,
      );

      // Remaining unpaid after applying totalAmountUsd
      const remainingUnpaidUsd = Math.max(0, totalInvoiceDebtUsd - totalAmountUsd);
      const remainingUnpaidBs = remainingUnpaidUsd * exchangeRate.rateUsd;

      return {
        savedPayment: savedPayments[0] || ({} as Payment),
        invoice: invoices[0],
        surplusId,
        surplusAmountUsd,
        surplusAmountBs,
        paymentDate,
        remainingUnpaidUsd,
        remainingUnpaidBs,
      };
    } catch (error) {
      if (!externalQueryRunner) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    } finally {
      if (!externalQueryRunner) {
        await queryRunner.release();
      }
    }
  }

  /** Validates that the incoming amounts are positive finite numbers. */
  private validateAmounts(dto: CreatePaymentDto, amount: number, amountExtracted: number): void {
    const isZelle = dto.paymentMethod.toLowerCase() === 'zelle';
    if (isZelle) {
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new BadRequestException('Payment amount must be greater than 0');
      }
    } else {
      if (!Number.isFinite(amountExtracted) || amountExtracted <= 0) {
        throw new BadRequestException('Payment amount Bs must be greater than 0');
      }
    }
  }

  private async getExchangeRateOrThrow(date: Date): Promise<ExchangeRate> {
    const exchangeRate = await this.exchangeRateService.getExchangeRateByDate(date);
    if (!exchangeRate) {
      const dateFormatted = formatToISODateString(date);
      throw new BadRequestException(
        `No se encontró la tasa de cambio para la fecha ${dateFormatted}.`,
      );
    }
    return exchangeRate;
  }

  /**
   * Converts the raw amount to USD.
   * For non-Zelle methods the extracted Bs amount is divided by the rate.
   */
  private resolveAmountUsd(dto: CreatePaymentDto, amount: number, rateUsd: number): number {
    const isZelle = dto.paymentMethod.toLowerCase() === 'zelle';
    if (!isZelle && dto.amountExtracted) {
      return dto.amountExtracted / rateUsd;
    }
    return amount;
  }

  /**
   * Determines how much of the payment applies to the invoice vs. becomes
   * surplus, and returns the capped payment amounts.
   */
  private computePaymentSplit(
    amountUsd: number,
    invoiceUnpaidAmount: number,
    amountExtracted: number,
    paymentMethod: string,
    rateUsd: number,
  ): PaymentSplit {
    let paymentAmountUsd = amountUsd;
    const isZelle = paymentMethod.toLowerCase() === 'zelle';
    let paymentAmountBs = !isZelle ? amountExtracted : 0;
    let surplusAmountUsd: number | null = null;
    let surplusAmountBs: number | null = null;

    if (amountUsd > invoiceUnpaidAmount) {
      const surplusUsd = amountUsd - invoiceUnpaidAmount;

      if (isZelle) {
        surplusAmountUsd = surplusUsd;
      } else {
        surplusAmountBs = surplusUsd * rateUsd;
      }

      // Cap the payment to exactly what the invoice needs.
      paymentAmountUsd = invoiceUnpaidAmount;
      paymentAmountBs = !isZelle ? amountExtracted - (surplusAmountBs ?? 0) : 0;
    }

    return { paymentAmountUsd, paymentAmountBs, surplusAmountUsd, surplusAmountBs };
  }

  /** Creates and persists a Payment entity within the active transaction. */
  private async persistPayment(
    queryRunner: QueryRunner,
    dto: CreatePaymentDto,
    invoice: Invoice,
    split: PaymentSplit,
    paymentDate: Date,
  ): Promise<Payment> {
    const payment = queryRunner.manager.create(Payment, {
      paymentDate,
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

  async findPayments(
    page = 1,
    limit = 10,
    status?: string,
    search?: string,
    month?: number,
    year?: number,
  ) {
    const parsedPage = typeof page === 'number' ? page : parseInt(String(page), 10);
    const parsedLimit = typeof limit === 'number' ? limit : parseInt(String(limit), 10);
    const sanitizedPage = isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
    const sanitizedLimit = isNaN(parsedLimit) || parsedLimit < 1 ? 10 : Math.min(parsedLimit, 100);

    const queryBuilder = this.paymentRepository
      .createQueryBuilder('payment')
      .leftJoinAndSelect('payment.person', 'person')
      .leftJoinAndSelect('payment.invoice', 'invoice')
      .leftJoinAndSelect('invoice.contract', 'contract')
      .leftJoinAndSelect('payment.surpluses', 'surpluses')
      .orderBy('payment.createdAt', 'DESC');

    if (status) {
      queryBuilder.andWhere('payment.status = :status', { status });
    }

    if (search) {
      queryBuilder.andWhere(
        '(payment.referenceNumber ILIKE :search OR person.identityCard ILIKE :search OR person.name ILIKE :search OR contract.code ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    if (year && month) {
      const formattedMonth = String(month).padStart(2, '0');
      queryBuilder.andWhere('invoice.billingMonth = :billingMonth', {
        billingMonth: `${year}-${formattedMonth}`,
      });
    } else if (year) {
      queryBuilder.andWhere('invoice.billingMonth LIKE :billingMonthPattern', {
        billingMonthPattern: `${year}-%`,
      });
    } else if (month) {
      const formattedMonth = String(month).padStart(2, '0');
      queryBuilder.andWhere('invoice.billingMonth LIKE :billingMonthPattern', {
        billingMonthPattern: `%-${formattedMonth}`,
      });
    }

    const [data, total] = await queryBuilder
      .skip((sanitizedPage - 1) * sanitizedLimit)
      .take(sanitizedLimit)
      .getManyAndCount();

    return {
      data,
      meta: {
        totalItems: total,
        itemCount: data.length,
        itemsPerPage: sanitizedLimit,
        totalPages: Math.ceil(total / sanitizedLimit),
        currentPage: sanitizedPage,
      },
    };
  }

  async countPendingPayments(): Promise<number> {
    return await this.paymentRepository.count({
      where: { status: PaymentStatus.PROCESSING },
    });
  }

  async approvePayment(id: string): Promise<Payment> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const paymentRepo = queryRunner.manager.getRepository(Payment);
      const surplusRepo = queryRunner.manager.getRepository(Surplus);

      const payment = await queryRunner.manager
        .createQueryBuilder(Payment, 'payment')
        .setQueryRunner(queryRunner)
        .innerJoinAndSelect('payment.invoice', 'invoice')
        .where('payment.id = :id', { id })
        .setLock('pessimistic_write')
        .getOne();

      if (!payment) {
        throw new NotFoundException(`Payment with ID ${id} not found`);
      }
      if (payment.status === PaymentStatus.COMPLETED) {
        throw new BadRequestException('El pago ya se encuentra aprobado.');
      }

      payment.status = PaymentStatus.COMPLETED;

      // Remove rejection reason from metadata if present
      const metadata = payment.metadata || {};
      if (metadata.rejectionReason) {
        delete metadata.rejectionReason;
      }
      payment.metadata = metadata;

      const saved = await paymentRepo.save(payment);

      // Find and restore associated surpluses (from cancelled to pending)
      const associatedSurpluses = await surplusRepo.find({
        where: { payment: { id: payment.id } },
      });

      for (const surplus of associatedSurpluses) {
        if (surplus.status === SurplusStatus.CANCELLED) {
          surplus.status = SurplusStatus.PENDING;
          await surplusRepo.save(surplus);
        }
      }

      if (payment.invoice) {
        await this.invoiceService.recalculateInvoicePaidAmount(payment.invoice.id, queryRunner);
      }

      await queryRunner.commitTransaction();
      return saved;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async rejectPayment(id: string, reason: string): Promise<Payment> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const paymentRepo = queryRunner.manager.getRepository(Payment);
      const surplusRepo = queryRunner.manager.getRepository(Surplus);

      const payment = await queryRunner.manager
        .createQueryBuilder(Payment, 'payment')
        .setQueryRunner(queryRunner)
        .innerJoinAndSelect('payment.invoice', 'invoice')
        .where('payment.id = :id', { id })
        .setLock('pessimistic_write')
        .getOne();

      if (!payment) {
        throw new NotFoundException(`Payment with ID ${id} not found`);
      }
      if (payment.status === PaymentStatus.REJECTED) {
        throw new BadRequestException('El pago ya se encuentra rechazado.');
      }

      payment.status = PaymentStatus.REJECTED;
      const metadata = payment.metadata || {};
      metadata.rejectionReason = reason;
      payment.metadata = metadata;

      const saved = await paymentRepo.save(payment);

      // Find and cancel associated surpluses
      const associatedSurpluses = await surplusRepo.find({
        where: { payment: { id: payment.id } },
      });

      for (const surplus of associatedSurpluses) {
        if (surplus.status === SurplusStatus.PENDING) {
          surplus.status = SurplusStatus.CANCELLED;
          await surplusRepo.save(surplus);
        }
      }

      if (payment.invoice) {
        await this.invoiceService.recalculateInvoicePaidAmount(payment.invoice.id, queryRunner);
      }

      await queryRunner.commitTransaction();
      return saved;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async updatePaymentDate(id: string, newDateStr: string): Promise<Payment> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const paymentRepo = queryRunner.manager.getRepository(Payment);
      const surplusRepo = queryRunner.manager.getRepository(Surplus);

      const payment = await queryRunner.manager
        .createQueryBuilder(Payment, 'payment')
        .setQueryRunner(queryRunner)
        .innerJoinAndSelect('payment.invoice', 'invoice')
        .where('payment.id = :id', { id })
        .setLock('pessimistic_write')
        .getOne();

      if (!payment) {
        throw new NotFoundException(`Pago con ID ${id} no encontrado`);
      }

      const dt = parseDateToCaracas(newDateStr);
      if (!dt.isValid) {
        throw new BadRequestException('Formato de fecha inválido');
      }
      const newDate = dt.toJSDate();

      let rateUsd = 1;
      const isZelle = payment.paymentMethod.toLowerCase() === 'zelle';
      if (!isZelle) {
        const exchangeRate = await this.exchangeRateService.getExchangeRateByDate(newDate);
        if (!exchangeRate) {
          throw new BadRequestException(
            'No se encontró tasa de cambio para la fecha especificada.',
          );
        }
        rateUsd = Number(exchangeRate.rateUsd);
      }

      // Obtener excedentes asociados y activos
      const associatedSurpluses = await surplusRepo.find({
        where: { payment: { id: payment.id } },
      });

      let totalBs = Number(payment.amountBs || 0);
      let totalUsd = Number(payment.amount || 0);

      const existingSurplus = associatedSurpluses.find((s) => s.status !== SurplusStatus.CANCELLED);
      if (existingSurplus) {
        totalBs += Number(existingSurplus.amountBs || 0);
        totalUsd += Number(existingSurplus.amountUsd || 0);
      }

      // Obtener factura bloqueada pesimistamente
      const invoice = await this.invoiceService.fetchInvoiceWithLock(
        queryRunner,
        payment.invoice.id,
      );

      // Recalcular saldo pendiente antes de este pago
      const invoiceUnpaidBefore = Math.max(
        0,
        Number(invoice.totalAmount) -
          Number(invoice.retentionAmount || 0) -
          (Number(invoice.paidAmount) - Number(payment.amount)),
      );

      let amountUsdInput = totalUsd;
      if (payment.paymentMethod.toLowerCase() !== 'zelle') {
        amountUsdInput = totalBs / rateUsd;
      }

      const split = this.computePaymentSplit(
        amountUsdInput,
        invoiceUnpaidBefore,
        totalBs,
        payment.paymentMethod,
        rateUsd,
      );

      payment.paymentDate = newDate;
      payment.amount = split.paymentAmountUsd;
      payment.amountBs = split.paymentAmountBs;

      const savedPayment = await paymentRepo.save(payment);

      const hasSurplus = split.surplusAmountUsd !== null || split.surplusAmountBs !== null;

      if (hasSurplus) {
        if (existingSurplus) {
          existingSurplus.amountUsd = split.surplusAmountUsd;
          existingSurplus.amountBs = split.surplusAmountBs;
          existingSurplus.date = newDate;
          existingSurplus.status = SurplusStatus.PENDING;
          await surplusRepo.save(existingSurplus);
        } else {
          await surplusRepo.save(
            surplusRepo.create({
              amountBs: split.surplusAmountBs,
              amountUsd: split.surplusAmountUsd,
              date: newDate,
              payment: savedPayment,
              invoice: null,
              contract: invoice.contract,
              status: SurplusStatus.PENDING,
            }),
          );
        }
      } else {
        if (existingSurplus) {
          existingSurplus.status = SurplusStatus.CANCELLED;
          existingSurplus.amountUsd = null;
          existingSurplus.amountBs = null;
          await surplusRepo.save(existingSurplus);
        }
      }

      await this.invoiceService.recalculateInvoicePaidAmount(invoice.id, queryRunner);

      await queryRunner.commitTransaction();

      const reloadedPayment = await this.paymentRepository.findOne({
        where: { id: savedPayment.id },
        relations: ['person', 'invoice', 'invoice.contract', 'surpluses'],
      });

      if (!reloadedPayment) {
        throw new NotFoundException(`Pago con ID ${savedPayment.id} no encontrado tras guardar`);
      }

      return reloadedPayment;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
