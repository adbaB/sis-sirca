import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { InvoiceLine } from '../entities/invoice-line.entity';
import { InvoiceLineCategory } from '../enums/invoice-line-category.enum';
import { AddInvoiceLineInput } from '../dto/add-invoice-line.input';
import { InvoiceQueryRepository } from '../repositories/invoice-query.repository';
import { InvoiceCalculationService } from './invoice-calculation.service';
import { resolveInvoiceStatus } from '../helpers/invoice-status.helper';
import { Transactional } from '../../../common/decorators/transactional.decorator';
import { getQueryRunner, getQueryRunnerSafe } from '../../../common/context/request-context';
import { getBillingMonth, getCaracasTodayJSDate } from '../../../common/utils/date.util';
import { Person } from '../../../persons/entities/person.entity';
import { Plan } from '../../../plans/entities/plan.entity';
import { Payment, PaymentStatus } from '../../payments/entities/payment.entity';
import { Surplus, SurplusStatus } from '../../payments/entities/surplus.entity';

/**
 * Servicio responsable de la gestión de líneas de factura.
 *
 * Responsabilidades:
 * - Agregar cargos adicionales a facturas existentes
 * - Eliminar cargos adicionales
 * - Eliminar líneas de un afiliado cuando se desafilia
 * - Actualizar la línea de mensualidad cuando cambia el plan de un afiliado
 */
@Injectable()
export class InvoiceLineService {
  private readonly logger = new Logger(InvoiceLineService.name);

  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    @InjectRepository(InvoiceLine)
    private readonly invoiceLineRepository: Repository<InvoiceLine>,
    private readonly dataSource: DataSource,
    private readonly queryRepo: InvoiceQueryRepository,
    private readonly calculationService: InvoiceCalculationService,
  ) {}

  /**
   * Agrega un cargo adicional (no MENSUALIDAD) a una factura.
   * Recalcula `totalAmount` y ajusta el estado de la factura.
   */
  @Transactional()
  async addAdditionalCharge(invoiceId: string, dto: AddInvoiceLineInput): Promise<Invoice> {
    // Validación de categoría antes de cualquier acceso a BD
    if ((dto.category as string) === InvoiceLineCategory.MENSUALIDAD) {
      throw new BadRequestException(
        'No se puede agregar una línea de tipo MENSUALIDAD como cargo adicional.',
      );
    }

    // Verificar existencia y estado de la factura con el repo principal
    const invoiceCheck = await this.invoiceRepository.findOne({ where: { id: invoiceId } });
    if (!invoiceCheck) {
      throw new NotFoundException(`Factura con ID ${invoiceId} no encontrada`);
    }
    if (invoiceCheck.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('No se pueden agregar cargos a una factura cancelada.');
    }

    const qr = getQueryRunner();
    const invoiceRepo = qr.manager.getRepository(Invoice);

    const invoice = await invoiceRepo.findOne({
      where: { id: invoiceId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!invoice) {
      throw new NotFoundException(`Factura con ID ${invoiceId} no encontrada`);
    }

    const line = qr.manager.create(InvoiceLine, {
      invoice,
      category: dto.category,
      description: dto.description,
      amount: dto.amount,
      quantity: dto.quantity ?? 1,
      person: dto.personId ? Object.assign(new Person(), { id: dto.personId }) : null,
      isProjectable: false,
      metadata: dto.metadata ?? null,
    });

    await qr.manager.save(line);

    // Recalcular totalAmount = baseAmount + SUM(líneas no proyectables activas)
    const additionalAmount = await this.queryRepo.sumAdditionalLines(qr.manager, invoiceId);
    invoice.totalAmount = Number(invoice.baseAmount) + additionalAmount;

    // Ajustar status usando la regla común del helper
    const retentionAmount = Number(invoice.retentionAmount || 0);
    invoice.status = resolveInvoiceStatus(invoice.paidAmount, invoice.totalAmount, retentionAmount);

    await invoiceRepo.save(invoice);

    return await invoiceRepo.findOne({
      where: { id: invoice.id },
      relations: ['contract', 'lines', 'lines.person', 'lines.plan', 'payments'],
    });
  }

  /**
   * Elimina (soft-delete) un cargo adicional de una factura.
   * No permite eliminar líneas de tipo MENSUALIDAD.
   */
  @Transactional()
  async removeAdditionalCharge(invoiceId: string, lineId: string): Promise<Invoice> {
    // Verificar existencia de la factura antes del QR para tests unitarios
    const invoiceCheck = await this.invoiceRepository.findOne({ where: { id: invoiceId } });
    if (!invoiceCheck) {
      throw new NotFoundException(`Factura con ID ${invoiceId} no encontrada`);
    }

    const qr = getQueryRunner();
    const invoiceRepo = qr.manager.getRepository(Invoice);

    const invoice = await invoiceRepo.findOne({
      where: { id: invoiceId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!invoice) {
      throw new NotFoundException(`Factura con ID ${invoiceId} no encontrada`);
    }

    const line = await qr.manager.findOne(InvoiceLine, {
      where: { id: lineId, invoice: { id: invoiceId } },
    });

    if (!line) {
      throw new NotFoundException(`Línea con ID ${lineId} no encontrada en esta factura`);
    }

    if (line.category === InvoiceLineCategory.MENSUALIDAD) {
      throw new BadRequestException('No se puede eliminar una línea de tipo MENSUALIDAD.');
    }

    await qr.manager.softRemove(line);

    // Recalcular totalAmount tras la eliminación
    const additionalAmount = await this.queryRepo.sumAdditionalLines(qr.manager, invoiceId);
    invoice.totalAmount = Number(invoice.baseAmount) + additionalAmount;

    // Prevenir violación de constraint: paidAmount <= totalAmount
    if (invoice.paidAmount > invoice.totalAmount) {
      invoice.paidAmount = invoice.totalAmount;
    }

    const retentionAmount = Number(invoice.retentionAmount || 0);
    invoice.status = resolveInvoiceStatus(invoice.paidAmount, invoice.totalAmount, retentionAmount);

    await invoiceRepo.save(invoice);

    return await invoiceRepo.findOne({
      where: { id: invoice.id },
      relations: ['contract', 'lines', 'lines.person', 'lines.plan', 'payments'],
    });
  }

  /**
   * Elimina (soft-delete) las líneas MENSUALIDAD e INCLUSION de un afiliado
   * en la factura activa del mes en curso y recalcula montos + status.
   * Si queda excedente (paidAmount > totalAmount), genera un registro Surplus.
   */
  @Transactional()
  async removeAffiliateLineFromActiveInvoice(
    contractId: string,
    personId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const qr = getQueryRunnerSafe();
    const activeManager = manager ?? qr?.manager;
    const invoiceRepo = activeManager
      ? activeManager.getRepository(Invoice)
      : this.invoiceRepository;
    const invoiceLineRepo = activeManager
      ? activeManager.getRepository(InvoiceLine)
      : this.invoiceLineRepository;
    const paymentRepo = activeManager
      ? activeManager.getRepository(Payment)
      : this.dataSource.getRepository(Payment);
    const surplusRepo = activeManager
      ? activeManager.getRepository(Surplus)
      : this.dataSource.getRepository(Surplus);
    const entityManager = activeManager ?? this.dataSource.manager;

    const billingMonth = getBillingMonth();

    const invoice = await invoiceRepo.findOne({
      where: {
        contract: { id: contractId },
        billingMonth,
        status: In([InvoiceStatus.PENDING, InvoiceStatus.PARTIAL]),
      },
      relations: ['contract'],
    });

    if (!invoice) return;

    // Soft-delete la línea MENSUALIDAD o INCLUSION del afiliado
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

    // También soft-delete de línea INCLUSION si existe por separado
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

    // Recalcular baseAmount y total
    const baseAmount = await this.queryRepo.sumBaseLines(entityManager, invoice.id);
    const additionalAmount = await this.queryRepo.sumAdditionalLines(entityManager, invoice.id);
    const calculatedTotal = baseAmount + additionalAmount;

    // Verificar si queda excedente (pagos > nuevo total)
    const totalPaymentsSum = await this.queryRepo.sumCompletedPayments(entityManager, invoice.id);

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

    // Actualizar montos en la entidad
    invoice.baseAmount = baseAmount;
    invoice.totalAmount = calculatedTotal;

    // Prevenir violación de constraint
    if (invoice.paidAmount > invoice.totalAmount) {
      invoice.paidAmount = invoice.totalAmount;
    }

    await invoiceRepo.save(invoice);

    // Recalcular status final desde pagos reales
    await this.calculationService.recalculateInvoicePaidAmount(invoice.id, entityManager);

    this.logger.log(`[billing] Líneas removidas para persona ${personId} en factura ${invoice.id}`);
  }

  /**
   * Actualiza la línea MENSUALIDAD de un afiliado en la factura activa
   * cuando se cambia su plan. Recalcula baseAmount y totalAmount.
   */
  @Transactional()
  async updatePlanLineOnActiveInvoice(
    contractId: string,
    personId: string,
    newPlanId: string,
    newPlanAmount: number,
    newPlanName: string,
  ): Promise<void> {
    const qr = getQueryRunnerSafe();
    const activeManager = qr?.manager;
    const invoiceRepo = activeManager
      ? activeManager.getRepository(Invoice)
      : this.invoiceRepository;
    const invoiceLineRepo = activeManager
      ? activeManager.getRepository(InvoiceLine)
      : this.invoiceLineRepository;
    const entityManager = activeManager ?? this.dataSource.manager;

    const billingMonth = getBillingMonth();

    const invoice = await invoiceRepo.findOne({
      where: {
        contract: { id: contractId },
        billingMonth,
        status: In([InvoiceStatus.PENDING, InvoiceStatus.PARTIAL]),
      },
    });

    if (!invoice) return;

    const line = await invoiceLineRepo.findOne({
      where: {
        invoice: { id: invoice.id },
        person: { id: personId },
        category: InvoiceLineCategory.MENSUALIDAD,
        deletedAt: IsNull(),
      },
    });

    if (!line) return; // Afiliado sin línea MENSUALIDAD en el mes actual

    // Actualizar la línea con el nuevo plan y monto
    line.amount = newPlanAmount;
    line.plan = { id: newPlanId } as Plan;
    const personName = line.description.split(' - ')[0];
    line.description = `${personName} - ${newPlanName}`;
    await invoiceLineRepo.save(line);

    // Recalcular baseAmount y totalAmount
    const baseAmount = await this.queryRepo.sumBaseLines(entityManager, invoice.id);
    const additionalAmount = await this.queryRepo.sumAdditionalLines(entityManager, invoice.id);

    invoice.baseAmount = baseAmount;
    invoice.totalAmount = baseAmount + additionalAmount;

    // Prevenir violación de constraint
    if (invoice.paidAmount > invoice.totalAmount) {
      invoice.paidAmount = invoice.totalAmount;
    }

    await invoiceRepo.save(invoice);

    // Recalcular status final
    await this.calculationService.recalculateInvoicePaidAmount(invoice.id, entityManager);

    this.logger.log(
      `[billing] Línea MENSUALIDAD actualizada (plan: ${newPlanName}, $${newPlanAmount}) para persona ${personId} en factura ${invoice.id}`,
    );
  }
}
