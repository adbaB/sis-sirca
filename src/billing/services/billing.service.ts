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
import { DataSource, QueryRunner, Repository } from 'typeorm';

import { Contract, ContractStatus } from '../../contracts/entities/contract.entity';
import { ExchangeRate } from '../../exchange-rate/entities/Exchange-rate.entity';
import { ExchangeRateService } from '../../exchange-rate/services/exchange-rate.service';
import { PersonStatus, TypeIdentityCard } from '../../persons/entities/person.entity';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { InvoiceDetail } from '../entities/invoice-detail.entity';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { Payment, PaymentStatus } from '../entities/payment.entity';
import { Surplus, SurplusStatus } from '../entities/surplus.entity';
import { SurplusService } from './surplus.service';

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
        totalAmount: totalAmount,
        paidAmount: 0,
        status: InvoiceStatus.PENDING,
      });

      const savedInvoice = await invoiceRepo.save(invoice);

      const invoiceDetails = invoiceDetailsData.map((data) => {
        return queryRunner.manager.create(InvoiceDetail, {
          ...data,
          invoice: savedInvoice,
        });
      });

      await queryRunner.manager.save(invoiceDetails);

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
        relations: ['contract', 'details', 'payments'],
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

      const newTotalAmount = Number(contract.monthlyAmount);

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
        relations: ['contract', 'details', 'payments'],
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
}
