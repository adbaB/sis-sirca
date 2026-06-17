import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { DateTime } from 'luxon';
import { DataSource, EntityManager, In, IsNull, QueryRunner, Repository } from 'typeorm';

import { Contract, ContractStatus } from '../../contracts/entities/contract.entity';
import { ExchangeRate } from '../../exchange-rate/entities/Exchange-rate.entity';
import { ExchangeRateService } from '../../exchange-rate/services/exchange-rate.service';
import { Person, PersonStatus, TypeIdentityCard } from '../../persons/entities/person.entity';
import { Plan } from '../../plans/entities/plan.entity';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { InvoiceLine } from '../entities/invoice-line.entity';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { Payment, PaymentStatus } from '../entities/payment.entity';
import { Surplus, SurplusStatus } from '../entities/surplus.entity';
import { InvoiceLineCategory } from '../enums/invoice-line-category.enum';
import { SurplusService } from './surplus.service';
import { getBillingMonth } from '../utils/billing-month.util';

interface PaymentSplit {
  paymentAmountUsd: number;
  paymentAmountBs: number;
  surplusAmountUsd: number | null;
  surplusAmountBs: number | null;
}

interface TransactionResult {
  savedPayment: Payment;
  invoice: Invoice;
  surplusId: string | null;
  surplusAmountUsd: number | null;
  surplusAmountBs: number | null;
  paymentDate: Date;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    @InjectRepository(InvoiceLine)
    private readonly invoiceLineRepository: Repository<InvoiceLine>,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly dataSource: DataSource,
    private readonly exchangeRateService: ExchangeRateService,
    @Inject(forwardRef(() => SurplusService))
    private readonly surplusService: SurplusService,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async createPayment(createPaymentDto: CreatePaymentDto, externalQueryRunner?: QueryRunner) {
    const amount = Number(createPaymentDto.amount);
    const amountExtracted = Number(createPaymentDto.amountExtracted);
    this.validateAmounts(createPaymentDto, amount, amountExtracted);

    const queryRunner = externalQueryRunner || this.dataSource.createQueryRunner();
    const { savedPayment } = await this.executePaymentTransaction(
      createPaymentDto,
      amount,
      amountExtracted,
      queryRunner,
      externalQueryRunner,
    );

    return savedPayment;
  }

  // ---------------------------------------------------------------------------
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
      const invoice = await this.fetchInvoiceWithLock(queryRunner, dto.invoiceId);
      const exchangeRate = await this.getExchangeRateOrThrow();

      const amountUsd = this.resolveAmountUsd(dto, amount, exchangeRate.rateUsd);
      const invoiceUnpaidAmount = Math.max(
        0,
        Number(invoice.totalAmount) - Number(invoice.paidAmount),
      );

      const split = this.computePaymentSplit(
        amountUsd,
        invoiceUnpaidAmount,
        amountExtracted,
        dto.paymentMethod,
        exchangeRate.rateUsd,
      );

      const paymentDate = new Date();
      const savedPayment = await this.persistPayment(queryRunner, dto, invoice, split, paymentDate);
      const surplusId = await this.persistSurplus(
        queryRunner,
        invoice,
        savedPayment,
        paymentDate,
        split.surplusAmountUsd,
        split.surplusAmountBs,
      );

      // Recalculate invoice inside the transaction so a failure rolls back the payment too.
      await this.recalculateInvoicePaidAmount(dto.invoiceId, queryRunner);

      if (!externalQueryRunner) {
        await queryRunner.commitTransaction();
      }

      return {
        savedPayment,
        invoice,
        surplusId,
        surplusAmountUsd: split.surplusAmountUsd,
        surplusAmountBs: split.surplusAmountBs,
        paymentDate,
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
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Payment amount must be greater than 0');
    }
    if (dto.paymentMethod !== 'zelle') {
      if (!Number.isFinite(amountExtracted) || amountExtracted <= 0) {
        throw new BadRequestException('Payment amount Bs must be greater than 0');
      }
    }
  }

  /**
   * Fetches the invoice using a pessimistic write lock to prevent race
   * conditions, and throws a NotFoundException when absent.
   */
  private async fetchInvoiceWithLock(
    queryRunner: QueryRunner,
    invoiceId: string,
  ): Promise<Invoice> {
    const invoice = await queryRunner.manager
      .createQueryBuilder(Invoice, 'invoice')
      .setQueryRunner(queryRunner)
      .innerJoinAndSelect('invoice.contract', 'contract')
      .where('invoice.id = :id', { id: invoiceId })
      .setLock('pessimistic_write')
      .getOne();

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${invoiceId} not found`);
    }
    return invoice;
  }

  /** Fetches today's exchange rate for Venezuela or throws if unavailable. */
  private async getExchangeRateOrThrow(): Promise<ExchangeRate> {
    const fechaVe = DateTime.now().setZone('America/Caracas').toJSDate();
    const exchangeRate = await this.exchangeRateService.getExchangeRateByDate(fechaVe);
    if (!exchangeRate) {
      throw new BadRequestException('Exchange rate not found for date');
    }
    return exchangeRate;
  }

  /**
   * Converts the raw amount to USD.
   * For non-Zelle methods the extracted Bs amount is divided by the rate.
   */
  private resolveAmountUsd(dto: CreatePaymentDto, amount: number, rateUsd: number): number {
    if (dto.paymentMethod !== 'zelle' && dto.amountExtracted) {
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
    let paymentAmountBs = paymentMethod !== 'zelle' ? amountExtracted : 0;
    let surplusAmountUsd: number | null = null;
    let surplusAmountBs: number | null = null;

    if (amountUsd > invoiceUnpaidAmount) {
      const surplusUsd = amountUsd - invoiceUnpaidAmount;

      if (paymentMethod === 'zelle') {
        surplusAmountUsd = surplusUsd;
      } else {
        surplusAmountBs = surplusUsd * rateUsd;
      }

      // Cap the payment to exactly what the invoice needs.
      paymentAmountUsd = invoiceUnpaidAmount;
      paymentAmountBs = paymentMethod !== 'zelle' ? amountExtracted - (surplusAmountBs ?? 0) : 0;
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

  /**
   * Persists a Surplus record when the payment exceeds the invoice balance.
   * Returns the saved surplus ID, or null when no surplus exists.
   */
  private async persistSurplus(
    queryRunner: QueryRunner,
    invoice: Invoice,
    savedPayment: Payment,
    paymentDate: Date,
    surplusAmountUsd: number | null,
    surplusAmountBs: number | null,
  ): Promise<string | null> {
    if (surplusAmountUsd === null && surplusAmountBs === null) {
      return null;
    }
    const saved = await queryRunner.manager.save(
      queryRunner.manager.create(Surplus, {
        amountBs: surplusAmountBs,
        amountUsd: surplusAmountUsd,
        date: paymentDate,
        payment: savedPayment,
        invoice: null,
        contract: invoice.contract,
        status: SurplusStatus.PENDING,
      }),
    );
    return saved.id;
  }

  // ---------------------------------------------------------------------------
  // Other public methods
  // ---------------------------------------------------------------------------

  /**
   * Recalculates the invoice's paidAmount from the source of truth:
   * SUM of all non-rejected payments (PROCESSING + COMPLETED).
   * Then derives the invoice status accordingly.
   *
   * When called with a QueryRunner the operation executes within that transaction
   * so a failure rolls back the entire payment + recalculation atomically.
   */
  async recalculateInvoicePaidAmount(invoiceId: string, queryRunner?: QueryRunner): Promise<void> {
    const invoiceRepo = queryRunner
      ? queryRunner.manager.getRepository(Invoice)
      : this.invoiceRepository;
    const paymentRepo = queryRunner
      ? queryRunner.manager.getRepository(Payment)
      : this.paymentRepository;

    const invoice = await invoiceRepo.findOne({ where: { id: invoiceId } });

    if (!invoice) {
      this.logger.warn(`Cannot recalculate: Invoice ${invoiceId} not found.`);
      return;
    }

    const result = await paymentRepo
      .createQueryBuilder('payment')
      .select('COALESCE(SUM(payment.amount), 0)', 'total')
      .where('payment.invoice_id = :invoiceId', { invoiceId })
      .andWhere('payment.status IN (:...statuses)', {
        statuses: [PaymentStatus.PROCESSING, PaymentStatus.COMPLETED],
      })
      .getRawOne<{ total: string }>();

    const newPaidAmount = Number(result?.total ?? 0);
    const totalAmount = Number(invoice.totalAmount);

    invoice.paidAmount = Math.min(newPaidAmount, totalAmount);

    if (newPaidAmount >= totalAmount) {
      invoice.status = InvoiceStatus.PAID;
    } else if (newPaidAmount > 0) {
      invoice.status = InvoiceStatus.PARTIAL;
    } else {
      invoice.status = InvoiceStatus.PENDING;
    }

    await invoiceRepo.save(invoice);
  }

  async findPendingInvoicesByIdentityCard(
    identityCard: string,
    typeIdentityCard: TypeIdentityCard,
  ): Promise<Invoice[]> {
    return await this.invoiceRepository
      .createQueryBuilder('invoice')
      .innerJoinAndSelect('invoice.contract', 'contract')
      .innerJoin('contract.contractPersons', 'contractPerson')
      .innerJoin('contractPerson.person', 'person')
      .where('person.identityCard = :identityCard', { identityCard })
      .andWhere('person.typeIdentityCard = :typeIdentityCard', { typeIdentityCard })
      .andWhere('invoice.status IN (:...statuses)', {
        statuses: [InvoiceStatus.PENDING, InvoiceStatus.PARTIAL],
      })
      .getMany();
  }

  async findInvoicesByIds(ids: string[]): Promise<Invoice[]> {
    if (!ids || ids.length === 0) return [];
    return await this.invoiceRepository
      .createQueryBuilder('invoice')
      .innerJoinAndSelect('invoice.contract', 'contract')
      .where('invoice.id IN (:...ids)', { ids })
      .getMany();
  }

  async calculateAmountByInvoicesIds(ids: string[], paymentMethod: string): Promise<number> {
    if (!ids || ids.length === 0) return 0;

    const fechaVe = DateTime.now().setZone('America/Caracas').toJSDate();
    const exchangeRate = await this.exchangeRateService.getExchangeRateByDate(fechaVe);

    if (!exchangeRate) {
      throw new BadRequestException('Exchange rate not found for date');
    }

    const invoices = await this.findInvoicesByIds(ids);
    const totalAmount = invoices.reduce(
      (sum, inv) => sum + (Number(inv.totalAmount) - Number(inv.paidAmount)),
      0,
    );

    if (paymentMethod === 'transferencia' || paymentMethod === 'pago_movil') {
      return totalAmount * exchangeRate.rateUsd;
    } else {
      return totalAmount;
    }
  }

  async findPayments(
    page = 1,
    limit = 10,
    status?: string,
    search?: string,
    month?: number,
    year?: number,
  ) {
    const queryBuilder = this.paymentRepository
      .createQueryBuilder('payment')
      .leftJoinAndSelect('payment.person', 'person')
      .leftJoinAndSelect('payment.invoice', 'invoice')
      .leftJoinAndSelect('invoice.contract', 'contract')
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
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data,
      meta: {
        totalItems: total,
        itemCount: data.length,
        itemsPerPage: limit,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
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
        await this.recalculateInvoicePaidAmount(payment.invoice.id, queryRunner);
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
        await this.recalculateInvoicePaidAmount(payment.invoice.id, queryRunner);
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

      const dt = DateTime.fromISO(newDateStr, { zone: 'America/Caracas' });
      if (!dt.isValid) {
        throw new BadRequestException('Formato de fecha inválido');
      }
      const newDate = dt.toJSDate();

      const exchangeRate = await this.exchangeRateService.getExchangeRateByDate(newDate);
      if (!exchangeRate) {
        throw new BadRequestException('No se encontró tasa de cambio para la fecha especificada.');
      }

      const rateUsd = Number(exchangeRate.rateUsd);

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
      const invoice = await this.fetchInvoiceWithLock(queryRunner, payment.invoice.id);

      // Recalcular saldo pendiente antes de este pago
      const invoiceUnpaidBefore = Math.max(
        0,
        Number(invoice.totalAmount) - (Number(invoice.paidAmount) - Number(payment.amount)),
      );

      let amountUsdInput = totalUsd;
      if (payment.paymentMethod !== 'zelle') {
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

      await this.recalculateInvoicePaidAmount(invoice.id, queryRunner);

      await queryRunner.commitTransaction();

      const reloadedPayment = await this.paymentRepository.findOne({
        where: { id: savedPayment.id },
        relations: ['person', 'invoice', 'invoice.contract'],
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

  async generateInvoiceForContract(
    contractId: string,
    billingMonthInput?: string,
  ): Promise<Invoice> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let billingMonth = billingMonthInput;
    if (!billingMonth) {
      const nowVe = DateTime.now().setZone('America/Caracas');
      billingMonth = nowVe.toFormat('yyyy-MM');
    }

    try {
      const contractRepo = queryRunner.manager.getRepository(Contract);
      const invoiceRepo = queryRunner.manager.getRepository(Invoice);

      const contract = await contractRepo.findOne({
        where: { id: contractId },
        relations: ['contractPersons', 'contractPersons.person', 'contractPersons.person.plan'],
      });

      if (!contract) {
        throw new NotFoundException(`Contrato con ID ${contractId} no encontrado`);
      }

      if (contract.status !== ContractStatus.ACTIVE) {
        throw new BadRequestException('El contrato no está activo');
      }

      // Check if invoice already exists
      const existingInvoice = await invoiceRepo.findOne({
        where: {
          contract: { id: contract.id },
          billingMonth,
        },
      });

      if (existingInvoice) {
        throw new BadRequestException(
          `Ya existe una factura para este contrato en el mes ${billingMonth}`,
        );
      }

      const activeAfiliados =
        contract.contractPersons
          ?.filter((cp) => cp.role === 'AFILIADO' && cp.person?.status === PersonStatus.ACTIVE)
          .map((cp) => cp.person) || [];

      if (activeAfiliados.length === 0) {
        throw new BadRequestException('El contrato no tiene afiliados activos');
      }

      const invalidPerson = activeAfiliados.find(
        (p) => !p.plan || p.plan.amount === null || p.plan.amount === undefined,
      );
      if (invalidPerson) {
        throw new BadRequestException(
          `El afiliado ${invalidPerson.name} no tiene un plan de salud válido asignado`,
        );
      }

      let totalAmount = 0;
      const invoiceDetailsData = activeAfiliados.map((person) => {
        const amount = Number(person.plan.amount);
        totalAmount += amount;

        if (!Number.isFinite(amount) || amount < 0) {
          throw new BadRequestException(
            `El monto del plan del afiliado ${person.name} no es válido`,
          );
        }

        return {
          person: person,
          plan: person.plan,
          chargedAmount: amount,
        };
      });

      const now = new Date();
      const dueDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 5);

      const invoice = invoiceRepo.create({
        contract: contract,
        billingMonth: billingMonth,
        issueDate: new Date(),
        dueDate: dueDate,
        baseAmount: totalAmount,
        totalAmount: totalAmount,
        paidAmount: 0,
        status: InvoiceStatus.PENDING,
      });

      const savedInvoice = await invoiceRepo.save(invoice);

      const invoiceLines = invoiceDetailsData.map((data) => {
        return queryRunner.manager.create(InvoiceLine, {
          invoice: savedInvoice,
          category: InvoiceLineCategory.MENSUALIDAD,
          description: `${data.person.name} - ${data.plan.name}`,
          amount: data.chargedAmount,
          quantity: 1,
          person: data.person,
          plan: data.plan,
          isProjectable: true,
        });
      });

      await queryRunner.manager.save(invoiceLines);

      await queryRunner.commitTransaction();

      // Apply surpluses
      try {
        await this.surplusService.applyPendingSurplusesToInvoice(contract.id, savedInvoice.id);
      } catch (surplusError) {
        this.logger.error(
          `Error al aplicar excedentes al contrato ${contract.id} para la factura manual ${savedInvoice.id}`,
          surplusError,
        );
      }

      // Reload the invoice to get updated amounts/status/details
      return await this.invoiceRepository.findOne({
        where: { id: savedInvoice.id },
        relations: ['contract', 'lines', 'lines.person', 'lines.plan', 'payments'],
      });
    } catch (error: unknown) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      // Postgres unique constraint violation (contract_id, billing_month)
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw new BadRequestException(
          `Ya existe una factura para este contrato en el mes ${billingMonth}`,
        );
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async recalculateInvoiceAmountFromContract(invoiceId: string): Promise<Invoice> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const invoiceRepo = queryRunner.manager.getRepository(Invoice);

      const invoice = await invoiceRepo.findOne({
        where: { id: invoiceId },
        relations: ['contract'],
      });

      if (!invoice) {
        throw new NotFoundException(`Factura con ID ${invoiceId} no encontrada`);
      }

      if (invoice.status === InvoiceStatus.PAID || invoice.status === InvoiceStatus.CANCELLED) {
        throw new BadRequestException(
          'Solo las facturas pendientes o parciales pueden ser recalculadas.',
        );
      }

      const contract = invoice.contract;
      if (!contract) {
        throw new BadRequestException('La factura no tiene un contrato asociado');
      }

      const newBaseAmountResult = await queryRunner.manager
        .createQueryBuilder(InvoiceLine, 'line')
        .select('COALESCE(SUM(line.amount * line.quantity), 0)', 'total')
        .where('line.invoice_id = :invoiceId', { invoiceId: invoice.id })
        .andWhere('line.is_projectable = true')
        .andWhere('line.deleted_at IS NULL')
        .getRawOne<{ total: string }>();

      const newBaseAmount = Number(newBaseAmountResult?.total ?? 0);
      invoice.baseAmount = newBaseAmount;

      // Recalcular total: base + cargos adicionales (no proyectables)
      const additionalResult = await queryRunner.manager
        .createQueryBuilder(InvoiceLine, 'line')
        .select('COALESCE(SUM(line.amount * line.quantity), 0)', 'total')
        .where('line.invoice_id = :invoiceId', { invoiceId: invoice.id })
        .andWhere('line.is_projectable = false')
        .andWhere('line.deleted_at IS NULL')
        .getRawOne<{ total: string }>();

      const additionalAmount = Number(additionalResult?.total ?? 0);
      const newTotalAmount = newBaseAmount + additionalAmount;
      invoice.totalAmount = newTotalAmount;

      // Adjust paidAmount if it exceeds totalAmount to avoid DB check constraint violations
      if (invoice.paidAmount > newTotalAmount) {
        invoice.paidAmount = newTotalAmount;
      }

      // Save intermediate state in transaction
      await invoiceRepo.save(invoice);

      // Recalculate properly based on payments inside the transaction
      await this.recalculateInvoicePaidAmount(invoice.id, queryRunner);

      await queryRunner.commitTransaction();

      // Reload and return
      return await this.invoiceRepository.findOne({
        where: { id: invoice.id },
        relations: ['contract', 'lines', 'lines.person', 'lines.plan', 'payments'],
      });
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Additional Charges
  // ---------------------------------------------------------------------------

  async addAdditionalCharge(
    invoiceId: string,
    dto: {
      category: InvoiceLineCategory;
      description: string;
      amount: number;
      quantity?: number;
      personId?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<Invoice> {
    if (dto.category === InvoiceLineCategory.MENSUALIDAD) {
      throw new BadRequestException(
        'No se puede agregar una línea de tipo MENSUALIDAD como cargo adicional.',
      );
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const invoiceRepo = queryRunner.manager.getRepository(Invoice);

      const invoice = await invoiceRepo.findOne({
        where: { id: invoiceId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!invoice) {
        throw new NotFoundException(`Factura con ID ${invoiceId} no encontrada`);
      }

      if (invoice.status === InvoiceStatus.CANCELLED) {
        throw new BadRequestException('No se pueden agregar cargos a una factura cancelada.');
      }

      const line = queryRunner.manager.create(InvoiceLine, {
        invoice,
        category: dto.category,
        description: dto.description,
        amount: dto.amount,
        quantity: dto.quantity ?? 1,
        person: dto.personId ? Object.assign(new Person(), { id: dto.personId }) : null,
        isProjectable: false,
        metadata: dto.metadata ?? null,
      });

      await queryRunner.manager.save(line);

      // Recalcular totalAmount = baseAmount + SUM(líneas no proyectables activas)
      const additionalResult = await queryRunner.manager
        .createQueryBuilder(InvoiceLine, 'line')
        .select('COALESCE(SUM(line.amount * line.quantity), 0)', 'total')
        .where('line.invoice_id = :invoiceId', { invoiceId: invoice.id })
        .andWhere('line.is_projectable = false')
        .andWhere('line.deleted_at IS NULL')
        .getRawOne<{ total: string }>();

      const additionalAmount = Number(additionalResult?.total ?? 0);
      invoice.totalAmount = Number(invoice.baseAmount) + additionalAmount;

      // Si paidAmount < nuevo totalAmount ajustar status
      if (invoice.paidAmount < invoice.totalAmount) {
        if (invoice.paidAmount > 0) {
          invoice.status = InvoiceStatus.PARTIAL;
        } else {
          invoice.status = InvoiceStatus.PENDING;
        }
      }

      await invoiceRepo.save(invoice);
      await queryRunner.commitTransaction();

      return await this.invoiceRepository.findOne({
        where: { id: invoice.id },
        relations: ['contract', 'lines', 'lines.person', 'lines.plan', 'payments'],
      });
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async removeAdditionalCharge(invoiceId: string, lineId: string): Promise<Invoice> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const invoiceRepo = queryRunner.manager.getRepository(Invoice);

      const invoice = await invoiceRepo.findOne({
        where: { id: invoiceId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!invoice) {
        throw new NotFoundException(`Factura con ID ${invoiceId} no encontrada`);
      }

      const line = await queryRunner.manager.findOne(InvoiceLine, {
        where: { id: lineId, invoice: { id: invoiceId } },
      });

      if (!line) {
        throw new NotFoundException(`Línea con ID ${lineId} no encontrada en esta factura`);
      }

      if (line.category === InvoiceLineCategory.MENSUALIDAD) {
        throw new BadRequestException('No se puede eliminar una línea de tipo MENSUALIDAD.');
      }

      await queryRunner.manager.softRemove(line);

      // Recalcular totalAmount
      const additionalResult = await queryRunner.manager
        .createQueryBuilder(InvoiceLine, 'line')
        .select('COALESCE(SUM(line.amount * line.quantity), 0)', 'total')
        .where('line.invoice_id = :invoiceId', { invoiceId: invoice.id })
        .andWhere('line.is_projectable = false')
        .andWhere('line.deleted_at IS NULL')
        .getRawOne<{ total: string }>();

      const additionalAmount = Number(additionalResult?.total ?? 0);
      invoice.totalAmount = Number(invoice.baseAmount) + additionalAmount;

      if (invoice.paidAmount > invoice.totalAmount) {
        invoice.paidAmount = invoice.totalAmount;
      }

      // Recalcular status
      if (invoice.paidAmount >= invoice.totalAmount && invoice.totalAmount > 0) {
        invoice.status = InvoiceStatus.PAID;
      } else if (invoice.paidAmount > 0) {
        invoice.status = InvoiceStatus.PARTIAL;
      } else {
        invoice.status = InvoiceStatus.PENDING;
      }

      await invoiceRepo.save(invoice);
      await queryRunner.commitTransaction();

      return await this.invoiceRepository.findOne({
        where: { id: invoice.id },
        relations: ['contract', 'lines', 'lines.person', 'lines.plan', 'payments'],
      });
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Elimina (soft-delete) las líneas MENSUALIDAD e INCLUSION de un afiliado
   * en la factura activa del mes en curso y recalcula montos + status.
   * Si queda excedente (paidAmount > totalAmount), genera surplus.
   */
  async removeAffiliateLineFromActiveInvoice(
    contractId: string,
    personId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const invoiceRepo = manager ? manager.getRepository(Invoice) : this.invoiceRepository;
    const invoiceLineRepo = manager
      ? manager.getRepository(InvoiceLine)
      : this.invoiceLineRepository;
    const paymentRepo = manager ? manager.getRepository(Payment) : this.paymentRepository;
    const surplusRepo = manager
      ? manager.getRepository(Surplus)
      : this.dataSource.getRepository(Surplus);

    const billingMonth = getBillingMonth();

    // Buscar la factura activa más reciente (no filtra por mes calendario
    // porque el ciclo de facturación empieza el 25 y la factura puede ser del mes siguiente)
    const invoice = await invoiceRepo.findOne({
      where: {
        contract: { id: contractId },
        billingMonth,
        status: In([InvoiceStatus.PENDING, InvoiceStatus.PARTIAL]),
      },
      relations: ['contract'],
    });

    if (!invoice) return;

    // Buscar y soft-delete la línea MENSUALIDAD
    const mensualidadLine = await invoiceLineRepo.findOne({
      where: {
        invoice: { id: invoice.id },
        person: { id: personId },
        category: InvoiceLineCategory.MENSUALIDAD,
        deletedAt: IsNull(),
      },
    });

    if (mensualidadLine) {
      await invoiceLineRepo.softRemove(mensualidadLine);
    }

    // Gap 5: Buscar y soft-delete la línea INCLUSION del mismo mes
    const inclusionLine = await invoiceLineRepo.findOne({
      where: {
        invoice: { id: invoice.id },
        person: { id: personId },
        category: InvoiceLineCategory.INCLUSION,
        deletedAt: IsNull(),
      },
    });

    if (inclusionLine) {
      await invoiceLineRepo.softRemove(inclusionLine);
    }

    if (!mensualidadLine && !inclusionLine) return;

    // Recalcular baseAmount (mensualidades activas)
    const baseResult = await invoiceLineRepo
      .createQueryBuilder('il')
      .select('COALESCE(SUM(il.amount * il.quantity), 0)', 'base')
      .where('il.invoice_id = :invoiceId', { invoiceId: invoice.id })
      .andWhere('il.category = :cat', { cat: InvoiceLineCategory.MENSUALIDAD })
      .andWhere('il.deleted_at IS NULL')
      .getRawOne<{ base: string }>();

    // Recalcular cargos adicionales no-proyectables
    const addlResult = await invoiceLineRepo
      .createQueryBuilder('il')
      .select('COALESCE(SUM(il.amount * il.quantity), 0)', 'total')
      .where('il.invoice_id = :invoiceId', { invoiceId: invoice.id })
      .andWhere('il.is_projectable = false')
      .andWhere('il.deleted_at IS NULL')
      .getRawOne<{ total: string }>();

    const baseAmount = Number(baseResult?.base ?? 0);
    invoice.baseAmount = baseAmount;
    const newTotalAmount = baseAmount + Number(addlResult?.total ?? 0);

    // Gap 6: Check de surplus si queda excedente
    const paymentResult = await paymentRepo
      .createQueryBuilder('payment')
      .select('COALESCE(SUM(payment.amount), 0)', 'total')
      .where('payment.invoice_id = :invoiceId', { invoiceId: invoice.id })
      .andWhere('payment.status IN (:...statuses)', {
        statuses: [PaymentStatus.PROCESSING, PaymentStatus.COMPLETED],
      })
      .getRawOne<{ total: string }>();

    const sumOfPayments = Number(paymentResult?.total ?? 0);
    if (sumOfPayments > newTotalAmount && newTotalAmount >= 0) {
      const excessUsd = sumOfPayments - newTotalAmount;
      await surplusRepo.save(
        surplusRepo.create({
          amountUsd: excessUsd,
          amountBs: null,
          date: new Date(),
          payment: null,
          invoice: null,
          contract: invoice.contract,
          status: SurplusStatus.PENDING,
        }),
      );

      this.logger.log(
        `[billing] Surplus de $${excessUsd.toFixed(2)} generado por desafiliación en factura ${invoice.id}`,
      );
    }

    invoice.totalAmount = newTotalAmount;
    // Cap paidAmount to newTotalAmount to prevent DB constraint violation on save
    if (invoice.paidAmount > invoice.totalAmount) {
      invoice.paidAmount = invoice.totalAmount;
    }
    await invoiceRepo.save(invoice);

    // Gap 6: Recalcular status (PENDING/PARTIAL/PAID) y ajustar paidAmount
    await this.recalculateInvoicePaidAmount(invoice.id, manager?.queryRunner);

    this.logger.log(`[billing] Líneas removidas para persona ${personId} en factura ${invoice.id}`);
  }

  /**
   * Gap 2: Actualiza la línea MENSUALIDAD de un afiliado en la factura activa
   * cuando se cambia su plan.
   */
  async updatePlanLineOnActiveInvoice(
    contractId: string,
    personId: string,
    newPlanId: string,
    newPlanAmount: number,
    newPlanName: string,
  ): Promise<void> {
    const billingMonth = getBillingMonth();

    const invoice = await this.invoiceRepository.findOne({
      where: {
        contract: { id: contractId },
        billingMonth,
        status: In([InvoiceStatus.PENDING, InvoiceStatus.PARTIAL]),
      },
    });

    if (!invoice) return;

    const line = await this.invoiceLineRepository.findOne({
      where: {
        invoice: { id: invoice.id },
        person: { id: personId },
        category: InvoiceLineCategory.MENSUALIDAD,
        deletedAt: IsNull(),
      },
    });

    if (!line) return; // Afiliado mid-month sin MENSUALIDAD

    // Actualizar la línea con el nuevo plan/monto
    line.amount = newPlanAmount;
    line.plan = { id: newPlanId } as Plan;
    const personName = line.description.split(' - ')[0];
    line.description = `${personName} - ${newPlanName}`;
    await this.invoiceLineRepository.save(line);

    // Recalcular baseAmount
    const baseResult = await this.invoiceLineRepository
      .createQueryBuilder('il')
      .select('COALESCE(SUM(il.amount * il.quantity), 0)', 'base')
      .where('il.invoice_id = :invoiceId', { invoiceId: invoice.id })
      .andWhere('il.category = :cat', { cat: InvoiceLineCategory.MENSUALIDAD })
      .andWhere('il.deleted_at IS NULL')
      .getRawOne<{ base: string }>();

    const addlResult = await this.invoiceLineRepository
      .createQueryBuilder('il')
      .select('COALESCE(SUM(il.amount * il.quantity), 0)', 'total')
      .where('il.invoice_id = :invoiceId', { invoiceId: invoice.id })
      .andWhere('il.is_projectable = false')
      .andWhere('il.deleted_at IS NULL')
      .getRawOne<{ total: string }>();

    const baseAmount = Number(baseResult?.base ?? 0);
    invoice.baseAmount = baseAmount;
    invoice.totalAmount = baseAmount + Number(addlResult?.total ?? 0);

    if (invoice.paidAmount > invoice.totalAmount) {
      invoice.paidAmount = invoice.totalAmount;
    }
    await this.invoiceRepository.save(invoice);

    // Recalcular status
    await this.recalculateInvoicePaidAmount(invoice.id);

    this.logger.log(
      `[billing] Línea MENSUALIDAD actualizada (plan: ${newPlanName}, $${newPlanAmount}) para persona ${personId} en factura ${invoice.id}`,
    );
  }

  /**
   * Builds a PDF for a single invoice and returns the buffer + suggested filename.
   * Each COMPLETED payment becomes its own page showing the receipt image.
   * PdfService is passed as a parameter to avoid circular dependency.
   */
  async buildInvoicePdf(
    invoiceId: string,
    pdfService: import('../../pdf/services/pdf.service').PdfService,
  ): Promise<{ pdfBuffer: Buffer; filename: string }> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id: invoiceId },
      relations: [
        'contract',
        'contract.advisor',
        'contract.contractPersons',
        'contract.contractPersons.person',
        'contract.contractPersons.person.plan',
        'lines',
        'lines.person',
        'lines.plan',
        'payments',
      ],
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice "${invoiceId}" not found`);
    }

    const contract = invoice.contract;
    if (!contract) {
      throw new NotFoundException(`Invoice "${invoiceId}" has no associated contract`);
    }

    const today = new Date().toLocaleDateString('es-VE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'America/Caracas',
    });

    // Titular info
    const titularCp = contract.contractPersons?.find((cp) => cp.isBillingOwner);
    const titular = titularCp?.person;
    const personName = titular?.name ?? 'Sin titular';
    const identityCard = titular ? `${titular.typeIdentityCard}-${titular.identityCard}` : 'N/A';

    const CATEGORY_LABELS: Record<string, string> = {
      INCLUSION: 'Inclusión',
      COMISION: 'Comisión',
      RECOBRO: 'Recobro',
      IMPUESTO: 'Impuesto',
    };

    const allLines = invoice.lines ?? [];
    const members = allLines
      .filter((l) => l.category === InvoiceLineCategory.MENSUALIDAD)
      .map((l) => ({
        name: l.person?.name ?? 'N/A',
        identityCard: l.person ? `${l.person.typeIdentityCard}-${l.person.identityCard}` : 'N/A',
        plan: l.plan?.name ?? 'N/A',
        amountUsd: `$${Number(l.amount).toFixed(2)}`,
      }));

    const additionalCharges = allLines
      .filter((l) => l.category !== InvoiceLineCategory.MENSUALIDAD)
      .map((l) => ({
        category: CATEGORY_LABELS[l.category] ?? l.category,
        description: l.description,
        quantity: String(l.quantity ?? 1),
        unitAmount: `$${Number(l.amount).toFixed(2)}`,
        totalLine: `$${(Number(l.amount) * Number(l.quantity ?? 1)).toFixed(2)}`,
      }));

    const totalAmount = Number(invoice.totalAmount);
    const formatted = new Intl.NumberFormat('es-ES', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    // Sort payments newest first
    const completedPayments = (invoice.payments ?? [])
      .filter((p) => p.status === PaymentStatus.COMPLETED)
      .sort((a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime());

    // Build one page per COMPLETED payment (shows its receipt image)
    // If no completed payments exist, build a single summary page
    const pagesToRender = completedPayments.length > 0 ? completedPayments : [null];

    const invoicePages = await Promise.all(
      pagesToRender.map(async (payment) => {
        const amountUsd = payment ? Number(payment.amount) : Number(invoice.paidAmount);
        const amountBsRaw = payment ? Number(payment.amountBs ?? 0) : 0;
        const amountUnpaid = Math.max(0, totalAmount - Number(invoice.paidAmount));

        const exchangeRate =
          amountBsRaw > 0 && amountUsd > 0 ? (amountBsRaw / amountUsd).toFixed(4) : null;

        // Download receipt image as base64 so Puppeteer can render it
        const receiptUrl = payment?.url ? await this.fetchReceiptAsBase64(payment.url) : null;

        return {
          contractCode: contract.code,
          billingMonth: invoice.billingMonth,
          personName,
          identityCard,
          members,
          additionalCharges,
          hasAdditionalCharges: additionalCharges.length > 0,
          today,
          paymentMethod: payment?.paymentMethod ?? '—',
          referenceNumber: payment?.referenceNumber ?? '',
          amountUsd: formatted.format(amountUsd),
          amountBs: amountBsRaw > 0 ? formatted.format(amountBsRaw) : null,
          exchangeRateUsdToBs: exchangeRate ? formatted.format(Number(exchangeRate)) : null,
          totalAmount: formatted.format(totalAmount),
          amountUnpaid: formatted.format(amountUnpaid),
          date: today,
          advisor: contract.advisor?.name ?? 'Sin asesor',
          receiptUrl,
        };
      }),
    );

    const pdfBuffer = await pdfService.generatePdf('invoice', {
      invoices: invoicePages,
      logoBase64: null,
    });

    const filename = `factura-${contract.code}-${invoice.billingMonth}.pdf`;
    return { pdfBuffer, filename };
  }

  /**
   * Downloads an image from a URL and returns it as a data URI (base64).
   * Returns null on failure so the template renders without the image.
   */
  private async fetchReceiptAsBase64(url: string): Promise<string | null> {
    const result = await fetchSafeImage(url, this.logger);
    if (!result) return null;
    return `data:${result.contentType};base64,${result.base64}`;
  }
}

function isTrustedUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    const trustedHosts = ['s3.aws.com', 'amazonaws.com', 's3.amazonaws.com'];
    if (trustedHosts.includes(hostname)) {
      return true;
    }
    if (hostname.endsWith('.amazonaws.com')) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function fetchSafeImage(
  url: string,
  logger: { warn(msg: string): void },
): Promise<{ contentType: string; base64: string } | null> {
  if (!isTrustedUrl(url)) {
    logger.warn(`[SSRF Blocked] Attempted outbound request to untrusted URL: ${url}`);
    return null;
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000), // 5 seconds timeout
    });

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') ?? 'image/jpeg';

    if (!response.body) return null;
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let totalSize = 0;
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalSize += value.length;
        if (totalSize > MAX_SIZE) {
          await reader.cancel();
          logger.warn(`[Resource Exhaustion Blocked] Image size exceeded limit of 10MB: ${url}`);
          return null;
        }
        chunks.push(Buffer.from(value));
      }
    }

    const buffer = Buffer.concat(chunks);
    const base64 = buffer.toString('base64');
    return { contentType, base64 };
  } catch (err) {
    logger.warn(
      `[fetchSafeImage] Error fetching image: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
