import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Payment } from '../entities/payment.entity';
import { Surplus, SurplusStatus } from '../entities/surplus.entity';
import { ExchangeRateService } from '../../../exchange-rate/services/exchange-rate.service';
import { InvoiceService } from '../../invoices/services/invoice.service';
import { parseDateToCaracas } from '../../../common/utils/date.util';
import { Transactional } from '../../../common/decorators/transactional.decorator';
import { getQueryRunner } from '../../../common/context/request-context';
import { computePaymentSplit } from '../utils/payment-calculator.util';

/**
 * Servicio encargado del ajuste y modificación de datos de pagos existentes.
 * Gestiona la corrección de fechas, recalculación de tasas de cambio aplicables
 * y actualización de saldos a favor (excedentes) y facturas afectadas.
 */
@Injectable()
export class PaymentUpdateService {
  private readonly logger = new Logger(PaymentUpdateService.name);
  constructor(
    private readonly exchangeRateService: ExchangeRateService,
    private readonly invoiceService: InvoiceService,
  ) {}

  /**
   * Actualiza la fecha registrada de un pago y recalcula todas las conversiones de moneda y excedentes.
   * Obtiene la tasa de cambio correspondiente a la nueva fecha, recalcula la división entre pago e excedente,
   * actualiza los registros en base de datos y solicita la recalculación del saldo pagado de la factura.
   *
   * @param id - Identificador UUID del pago a actualizar.
   * @param newDateStr - Nueva fecha deseada en formato de cadena (interpretada en horario Caracas).
   * @returns Promesa con el registro {@link Payment} modificado y rellenado con sus relaciones.
   * @throws NotFoundException Si el pago no existe en la base de datos.
   * @throws BadRequestException Si el formato de la fecha es inválido o no existe tasa de cambio para dicha fecha.
   */
  @Transactional()
  async updatePaymentDate(id: string, newDateStr: string): Promise<Payment> {
    const qr = getQueryRunner();
    const paymentRepo = qr.manager.getRepository(Payment);
    const surplusRepo = qr.manager.getRepository(Surplus);

    const payment = await qr.manager
      .createQueryBuilder(Payment, 'payment')
      .setQueryRunner(qr)
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
        throw new BadRequestException('No se encontró tasa de cambio para la fecha especificada.');
      }
      rateUsd = Number(exchangeRate.rateUsd);
      if (!Number.isFinite(rateUsd) || rateUsd <= 0) {
        throw new BadRequestException('Tasa de cambio inválida para la fecha especificada.');
      }
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
    const invoice = await this.invoiceService.fetchInvoiceWithLock(qr, payment.invoice.id);

    // Recalcular saldo pendiente antes de este pago
    const invoiceUnpaidBefore = Math.max(
      0,
      Number(invoice.totalAmount) -
        Number(invoice.retentionAmount || 0) -
        (Number(invoice.paidAmount) - Number(payment.amount)),
    );

    let amountUsdInput = totalUsd;
    if (!isZelle) {
      amountUsdInput = totalBs / rateUsd;
    }

    const split = computePaymentSplit(
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

    await this.invoiceService.recalculateInvoicePaidAmount(invoice.id, qr);

    const reloadedPayment = await paymentRepo.findOne({
      where: { id },
      relations: ['person', 'invoice', 'invoice.contract', 'surpluses'],
    });

    if (!reloadedPayment) {
      throw new NotFoundException(`Pago con ID ${id} no encontrado tras guardar`);
    }

    if (reloadedPayment.surpluses) {
      reloadedPayment.surpluses = reloadedPayment.surpluses.filter(
        (s) => s.status !== SurplusStatus.CANCELLED,
      );
    }

    return reloadedPayment;
  }
}
