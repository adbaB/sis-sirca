import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, QueryRunner, Repository } from 'typeorm';
import { ContractPerson } from '../../../contracts/entities/contract-person.entity';
import { Contract, ContractStatus } from '../../../contracts/entities/contract.entity';
import { ExchangeRateService } from '../../../exchange-rate/services/exchange-rate.service';
import { Person, PersonStatus, TypeIdentityCard } from '../../../persons/entities/person.entity';
import { InvoiceLineCategory } from '../../enums/invoice-line-category.enum';
import { SurplusService } from '../../services/surplus.service';
import { InvoiceLine } from '../entities/invoice-line.entity';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { Payment, PaymentStatus } from '../../entities/payment.entity';
import {
  getBillingMonth,
  getCaracasNow,
  getCaracasTodayJSDate,
  formatDateES,
} from '../../../common/utils/date.util';
import { Surplus, SurplusStatus } from '../../entities/surplus.entity';
import { fetchReceiptAsBase64 } from '../../utils/image-fetcher.util';
import { Plan } from '../../../plans/entities/plan.entity';

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);
  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    @InjectRepository(InvoiceLine)
    private readonly invoiceLineRepository: Repository<InvoiceLine>,
    private readonly dataSource: DataSource,
    @Inject(forwardRef(() => SurplusService))
    private readonly surplusService: SurplusService,
    private readonly exchangeRateService: ExchangeRateService,
  ) {}

  /**
   * Fetches the invoice using a pessimistic write lock to prevent race
   * conditions, and throws a NotFoundException when absent.
   */
  async fetchInvoiceWithLock(queryRunner: QueryRunner, invoiceId: string): Promise<Invoice> {
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

  async findPendingInvoices(queryStr: string): Promise<Invoice[]> {
    const trimmedQuery = queryStr.trim();

    // 1. Try to search by contract code first
    const contract = await this.dataSource.getRepository(Contract).findOne({
      where: { code: trimmedQuery },
    });

    let contractIds: string[];

    if (contract) {
      contractIds = [contract.id];
    } else {
      // 2. If no contract found, search by identity card
      let type = 'V';
      let num = trimmedQuery;

      if (trimmedQuery.includes('-')) {
        const parts = trimmedQuery.split('-');
        type = parts[0].trim().toUpperCase();
        num = parts[1].trim();
      } else {
        const match = trimmedQuery.match(/^([VEPJGCvepjgc])(\d+)$/);
        if (match) {
          type = match[1].toUpperCase();
          num = match[2];
        }
      }

      const person = await this.dataSource.getRepository(Person).findOne({
        where: {
          identityCard: num,
          typeIdentityCard: type as TypeIdentityCard,
        },
      });

      if (!person) {
        throw new NotFoundException(
          `No se encontró contrato o persona con el criterio "${trimmedQuery}".`,
        );
      }

      // Find all contract ids where this person is linked (can be titular or beneficiary)
      const contractPersons = await this.dataSource.getRepository(ContractPerson).find({
        where: {
          person: { id: person.id },
        },
        relations: ['contract'],
      });

      if (contractPersons.length === 0) {
        return [];
      }

      contractIds = contractPersons.map((cp) => cp.contract.id);
    }

    // 3. Find pending or partial invoices for these contracts
    return this.invoiceRepository.find({
      where: {
        contract: { id: In(contractIds) },
        status: In([InvoiceStatus.PENDING, InvoiceStatus.PARTIAL]),
      },
      relations: ['contract', 'contract.contractPersons', 'contract.contractPersons.person'],
      order: {
        billingMonth: 'ASC',
      },
    });
  }

  // TODO : REFACTOR - El método findPendingInvoicesByIdentityCard es redundante, se puede usar findPendingInvoices con el formato adecuado de queryStr. Dejaré ambos por compatibilidad pero marcaré este como deprecated para eliminarlo en el futuro.
  /**
   *
   *@deprecated Usar {@link findPendingInvoices} con el formato de queryStr "TYPE-IDENTITYCARD" (ejemplo: "V-12345678")
   */
  async findPendingInvoicesByIdentityCard(
    identityCard: string,
    typeIdentityCard: TypeIdentityCard,
  ): Promise<Invoice[]> {
    return this.findPendingInvoices(`${typeIdentityCard}-${identityCard}`);
  }

  async findInvoicesByIds(ids: string[]): Promise<Invoice[]> {
    if (!ids || ids.length === 0) return [];
    return await this.invoiceRepository
      .createQueryBuilder('invoice')
      .innerJoinAndSelect('invoice.contract', 'contract')
      .where('invoice.id IN (:...ids)', { ids })
      .getMany();
  }

  async generateInvoiceForContract(
    contractId: string,
    billingMonthInput?: string,
    isAffiliation: boolean = false,
  ): Promise<Invoice> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let billingMonth = billingMonthInput;
    if (!billingMonth) {
      billingMonth = getBillingMonth();
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

      const now = getCaracasNow();
      const dueDate = now.plus({ days: 5 }).toJSDate();

      const retentionPercentage = Number(contract.retentionPercentage || 0);
      const retentionAmount = totalAmount * (retentionPercentage / 100);

      const invoice = invoiceRepo.create({
        contract: contract,
        billingMonth: billingMonth,
        issueDate: getCaracasTodayJSDate(),
        dueDate: dueDate,
        baseAmount: totalAmount,
        totalAmount: totalAmount,
        paidAmount: 0,
        status: InvoiceStatus.PENDING,
        retentionPercentage,
        retentionAmount,
      });

      const savedInvoice = await invoiceRepo.save(invoice);

      const invoiceLines = invoiceDetailsData.map((data) => {
        return queryRunner.manager.create(InvoiceLine, {
          invoice: savedInvoice,
          category: isAffiliation ? InvoiceLineCategory.INCLUSION : InvoiceLineCategory.MENSUALIDAD,
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

  async calculateAmountByInvoicesIds(ids: string[], paymentMethod: string): Promise<number> {
    if (!ids || ids.length === 0) return 0;

    const invoices = await this.findInvoicesByIds(ids);
    const totalAmount = invoices.reduce(
      (sum, inv) => sum + (Number(inv.totalAmount) - Number(inv.paidAmount)),
      0,
    );

    const normalizedMethod = paymentMethod ? paymentMethod.toLowerCase() : '';
    if (normalizedMethod === 'transferencia' || normalizedMethod === 'pago_movil') {
      const fechaVe = getCaracasTodayJSDate();
      const exchangeRate = await this.exchangeRateService.getExchangeRateByDate(fechaVe);

      if (!exchangeRate) {
        throw new BadRequestException('Exchange rate not found for date');
      }
      return totalAmount * exchangeRate.rateUsd;
    } else {
      return totalAmount;
    }
  }

  async recalculateInvoicePaidAmount(
    invoiceId: string,
    queryRunnerOrManager?: QueryRunner | EntityManager,
  ): Promise<void> {
    let invoiceRepo = this.invoiceRepository;
    let paymentRepo = this.dataSource.getRepository(Payment);

    if (queryRunnerOrManager) {
      if ('manager' in queryRunnerOrManager) {
        invoiceRepo = queryRunnerOrManager.manager.getRepository(Invoice);
        paymentRepo = queryRunnerOrManager.manager.getRepository(Payment);
      } else {
        invoiceRepo = queryRunnerOrManager.getRepository(Invoice);
        paymentRepo = queryRunnerOrManager.getRepository(Payment);
      }
    }

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
    const retentionAmount = Number(invoice.retentionAmount || 0);
    const amountDue = Math.max(0, totalAmount - retentionAmount);

    invoice.paidAmount = Math.min(newPaidAmount, totalAmount);

    if (newPaidAmount >= amountDue) {
      invoice.status = InvoiceStatus.PAID;
    } else if (newPaidAmount > 0) {
      invoice.status = InvoiceStatus.PARTIAL;
    } else {
      invoice.status = InvoiceStatus.PENDING;
    }

    await invoiceRepo.save(invoice);
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
      const calculatedTotal = newBaseAmount + additionalAmount;
      invoice.totalAmount = calculatedTotal;

      const retentionPercentage = Number(contract.retentionPercentage || 0);
      const retentionAmount = calculatedTotal * (retentionPercentage / 100);
      invoice.retentionPercentage = retentionPercentage;
      invoice.retentionAmount = retentionAmount;

      const amountDue = Math.max(0, calculatedTotal - retentionAmount);

      // Adjust paidAmount if it exceeds amountDue to avoid DB check constraint violations
      if (invoice.paidAmount > amountDue) {
        invoice.paidAmount = amountDue;
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
    const paymentRepo = manager
      ? manager.getRepository(Payment)
      : this.dataSource.getRepository(Payment);
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

    // Buscar y soft-delete la línea MENSUALIDAD o AFILIACION
    const mensualidadLine = await invoiceLineRepo.findOne({
      where: {
        invoice: { id: invoice.id },
        person: { id: personId },
        category: In([InvoiceLineCategory.MENSUALIDAD, InvoiceLineCategory.INCLUSION]),
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
    const calculatedTotal = baseAmount + Number(addlResult?.total ?? 0);

    // Gap 6: Check de surplus si queda excedente
    const paymentResult = await paymentRepo
      .createQueryBuilder('payment')
      .select('COALESCE(SUM(payment.amount), 0)', 'total')
      .where('payment.invoice_id = :invoiceId', { invoiceId: invoice.id })
      .andWhere('payment.status IN (:...statuses)', {
        statuses: [PaymentStatus.PROCESSING, PaymentStatus.COMPLETED],
      })
      .getRawOne<{ total: string }>();

    const totalPaymentsSum = Number(paymentResult?.total ?? 0);
    if (totalPaymentsSum > calculatedTotal && calculatedTotal >= 0) {
      const excessUsd = totalPaymentsSum - calculatedTotal;

      const lastPayment = await paymentRepo.findOne({
        where: {
          invoice: { id: invoice.id },
          status: In([PaymentStatus.PROCESSING, PaymentStatus.COMPLETED]),
        },
        order: { createdAt: 'DESC' },
      });

      await surplusRepo.save(
        surplusRepo.create({
          amountUsd: excessUsd,
          amountBs: null,
          date: getCaracasTodayJSDate(),
          payment: lastPayment,
          invoice: null,
          contract: invoice.contract,
          status: SurplusStatus.PENDING,
        }),
      );

      this.logger.log(
        `[billing] Surplus de $${excessUsd.toFixed(2)} generado por desafiliación en factura ${invoice.id}`,
      );
    }

    invoice.totalAmount = calculatedTotal;
    // Cap paidAmount to calculatedTotal to prevent DB constraint violation on save
    if (invoice.paidAmount > invoice.totalAmount) {
      invoice.paidAmount = invoice.totalAmount;
    }
    await invoiceRepo.save(invoice);

    // Gap 6: Recalcular status (PENDING/PARTIAL/PAID) y ajustar paidAmount
    await this.recalculateInvoicePaidAmount(invoice.id, manager);

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
    pdfService: import('../../../pdf/services/pdf.service').PdfService,
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

    const today = formatDateES(getCaracasNow(), 'dd/MM/yyyy');

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

    const planCounts: Record<string, number> = {};
    for (const member of members) {
      const planName = member.plan;
      planCounts[planName] = (planCounts[planName] || 0) + 1;
    }
    const planSummary = Object.entries(planCounts)
      .map(([planName, count]) => ({
        planName,
        count,
      }))
      .sort((a, b) => b.count - a.count);

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
        const retentionAmount = Number(invoice.retentionAmount || 0);
        const amountDue = Math.max(0, totalAmount - retentionAmount);
        const amountUnpaid = Math.max(0, amountDue - Number(invoice.paidAmount));

        const exchangeRate =
          amountBsRaw > 0 && amountUsd > 0 ? (amountBsRaw / amountUsd).toFixed(4) : null;

        // Download receipt image as base64 so Puppeteer can render it
        const receiptUrl = payment?.url
          ? await fetchReceiptAsBase64(payment.url, this.logger)
          : null;

        return {
          contractCode: contract.code,
          billingMonth: invoice.billingMonth,
          personName,
          identityCard,
          members,
          planSummary,
          additionalCharges,
          hasAdditionalCharges: additionalCharges.length > 0,
          today,
          paymentMethod: payment?.paymentMethod ?? '—',
          referenceNumber: payment?.referenceNumber ?? '',
          amountUsd: formatted.format(amountUsd),
          amountBs: amountBsRaw > 0 ? formatted.format(amountBsRaw) : null,
          exchangeRateUsdToBs: exchangeRate ? formatted.format(Number(exchangeRate)) : null,
          totalAmount: formatted.format(totalAmount),
          retentionPercentage: invoice.retentionPercentage
            ? formatted.format(Number(invoice.retentionPercentage))
            : null,
          retentionAmount: retentionAmount > 0 ? formatted.format(retentionAmount) : null,
          amountDue: formatted.format(amountDue),
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
}
