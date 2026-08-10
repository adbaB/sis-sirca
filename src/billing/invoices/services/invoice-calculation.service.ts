import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { ExchangeRateService } from '../../../exchange-rate/services/exchange-rate.service';
import { getCaracasTodayJSDate } from '../../../common/utils/date.util';
import { getQueryRunner } from '../../../common/context/request-context';
import { Transactional } from '../../../common/decorators/transactional.decorator';
import { InvoiceQueryRepository } from '../repositories/invoice-query.repository';
import { resolveInvoiceStatus } from '../helpers/invoice-status.helper';

/**
 * Servicio responsable de todos los cálculos de montos y estado de facturas.
 *
 * Responsabilidades:
 * - Recalcular `paidAmount` y status a partir de pagos reales
 * - Recalcular `baseAmount` y `totalAmount` desde las líneas de la factura
 * - Calcular el monto a cobrar para un conjunto de facturas (con conversión de moneda)
 *
 * Este servicio es **exportado** desde `InvoiceModule` para que `SurplusService`
 * pueda inyectarlo directamente sin pasar por el facade `InvoiceService`.
 */
@Injectable()
export class InvoiceCalculationService {
  private readonly logger = new Logger(InvoiceCalculationService.name);

  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    private readonly dataSource: DataSource,
    private readonly queryRepo: InvoiceQueryRepository,
    private readonly exchangeRateService: ExchangeRateService,
  ) {}

  /**
   * Recalcula `paidAmount` y `status` de una factura sumando sus pagos
   * en estado PROCESSING o COMPLETED.
   *
   * @param invoiceId - ID de la factura a recalcular
   * @param manager   - EntityManager opcional para operar dentro de una transacción existente
   */
  async recalculateInvoicePaidAmount(invoiceId: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(Invoice) : this.invoiceRepository;

    const entityManager = manager ?? this.dataSource.manager;

    const invoice = await repo.findOne({ where: { id: invoiceId } });

    if (!invoice) {
      this.logger.warn(`Cannot recalculate: Invoice ${invoiceId} not found.`);
      return;
    }

    const newPaidAmount = await this.queryRepo.sumCompletedPayments(entityManager, invoiceId);

    const totalAmount = Number(invoice.totalAmount);
    const retentionAmount = Number(invoice.retentionAmount || 0);
    const amountDue = Math.max(0, totalAmount - retentionAmount);

    invoice.paidAmount = Math.min(newPaidAmount, amountDue);
    invoice.status = resolveInvoiceStatus(invoice.paidAmount, totalAmount, retentionAmount);

    await repo.save(invoice);
  }

  /**
   * Recalcula `baseAmount`, `totalAmount`, `retentionAmount` y `status`
   * de una factura a partir de sus líneas actuales.
   */
  @Transactional()
  async recalculateInvoiceAmountFromContract(invoiceId: string): Promise<Invoice> {
    const qr = getQueryRunner();
    const invoiceRepo = qr.manager.getRepository(Invoice);

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

    const newBaseAmount = await this.queryRepo.sumBaseLines(qr.manager, invoiceId);
    const additionalAmount = await this.queryRepo.sumAdditionalLines(qr.manager, invoiceId);
    const calculatedTotal = newBaseAmount + additionalAmount;

    invoice.baseAmount = newBaseAmount;
    invoice.totalAmount = calculatedTotal;

    const retentionPercentage = Number(contract.retentionPercentage || 0);
    const retentionAmount = calculatedTotal * (retentionPercentage / 100);
    invoice.retentionPercentage = retentionPercentage;
    invoice.retentionAmount = retentionAmount;

    await invoiceRepo.save(invoice);

    // Recalcular desde pagos reales dentro de la misma transacción
    await this.recalculateInvoicePaidAmount(invoice.id, qr.manager);

    return await invoiceRepo.findOne({
      where: { id: invoice.id },
      relations: ['contract', 'lines', 'lines.person', 'lines.plan', 'payments'],
    });
  }

  /**
   * Calcula el monto total a cobrar para un conjunto de facturas.
   * Si el método de pago es transferencia o pago_movil, convierte a Bs
   * usando la tasa de cambio del día.
   */
  async calculateAmountByInvoicesIds(ids: string[], paymentMethod: string): Promise<number> {
    if (!ids || ids.length === 0) return 0;

    const invoices = await this.invoiceRepository
      .createQueryBuilder('invoice')
      .innerJoinAndSelect('invoice.contract', 'contract')
      .where('invoice.id IN (:...ids)', { ids })
      .getMany();

    const totalAmount = invoices.reduce(
      (sum, inv) =>
        sum +
        Math.max(
          0,
          Number(inv.totalAmount) - Number(inv.retentionAmount || 0) - Number(inv.paidAmount),
        ),
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
    }

    return totalAmount;
  }
}
