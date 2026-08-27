import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contract, ContractStatus } from '../../../contracts/entities/contract.entity';
import { PersonStatus } from '../../../persons/entities/person.entity';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { InvoiceLine } from '../entities/invoice-line.entity';
import { InvoiceLineCategory } from '../enums/invoice-line-category.enum';
import { INVOICE_CREATED, InvoiceCreatedEvent } from '../events/invoice.events';
import { Transactional } from '../../../common/decorators/transactional.decorator';
import {
  getContextSafe,
  getQueryRunner,
  registerPostCommitHook,
} from '../../../common/context/request-context';
import {
  getBillingMonth,
  getCaracasNow,
  getCaracasTodayJSDate,
} from '../../../common/utils/date.util';

/**
 * Servicio responsable de la generación de facturas.
 *
 * Responsabilidades:
 * - Crear la factura y sus líneas de mensualidad dentro de una transacción atómica
 * - Emitir el evento `invoice.created` post-commit para que `SurplusService`
 *   aplique excedentes en su propia transacción separada (sin dependencia circular)
 */
@Injectable()
export class InvoiceGenerationService {
  private readonly logger = new Logger(InvoiceGenerationService.name);

  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Genera una factura para un contrato en el mes de facturación indicado.
   * La creación de la factura y sus líneas es atómica (una sola transacción).
   * La aplicación de excedentes se delega al `SurplusService` vía evento de dominio.
   *
   * @param contractId       - ID del contrato
   * @param billingMonthInput - Mes de facturación en formato YYYY-MM (opcional, por defecto el mes actual)
   * @param isAffiliation    - Si es true, las líneas se marcan como INCLUSION en lugar de MENSUALIDAD
   */
  @Transactional()
  async generateInvoiceForContract(
    contractId: string,
    billingMonthInput?: string,
    isAffiliation: boolean = false,
  ): Promise<Invoice> {
    const billingMonth = billingMonthInput ?? getBillingMonth();

    // Pre-validar el contrato ANTES de getQueryRunner() para que los tests
    // unitarios puedan verificar NotFoundException y BadRequestException
    // sin necesitar un contexto ALS activo.
    const preContract = await this.contractRepository.findOne({
      where: { id: contractId },
      relations: [
        'contractPersons',
        'contractPersons.plan',
        'contractPersons.person',
        'contractPersons.person.plan',
      ],
    });

    if (!preContract) {
      throw new NotFoundException(`Contrato con ID ${contractId} no encontrado`);
    }

    if (preContract.status !== ContractStatus.ACTIVE) {
      throw new BadRequestException('El contrato no está activo');
    }

    // Verificar idempotencia antes de entrar en la transacción
    const existingInvoice = await this.invoiceRepository.findOne({
      where: { contract: { id: contractId }, billingMonth },
    });

    if (existingInvoice) {
      throw new BadRequestException(
        `Ya existe una factura para este contrato en el mes ${billingMonth}`,
      );
    }

    // Validaciones de negocio sobre los afiliados
    const activeAfiliadoCps =
      preContract.contractPersons?.filter(
        (cp) => cp.role === 'AFILIADO' && cp.person?.status === PersonStatus.ACTIVE,
      ) || [];

    if (activeAfiliadoCps.length === 0) {
      throw new BadRequestException('El contrato no tiene afiliados activos');
    }

    const invalidCp = activeAfiliadoCps.find((cp) => {
      const plan = cp.plan || cp.person?.plan;
      return !plan || plan.amount === null || plan.amount === undefined;
    });

    if (invalidCp) {
      throw new BadRequestException(
        `El afiliado ${invalidCp.person.name} no tiene un plan de salud válido asignado`,
      );
    }

    const qr = getQueryRunner();
    const invoiceRepo = qr.manager.getRepository(Invoice);

    // Calcular monto total y preparar líneas
    let totalAmount = 0;
    const invoiceDetailsData = activeAfiliadoCps.map((cp) => {
      const plan = cp.plan || cp.person?.plan;
      const person = cp.person;
      const amount = Number(plan!.amount);

      if (!Number.isFinite(amount) || amount < 0) {
        throw new BadRequestException(`El monto del plan del afiliado ${person.name} no es válido`);
      }

      totalAmount += amount;
      return { person, plan: plan!, chargedAmount: amount };
    });

    const now = getCaracasNow();
    const dueDate = now.plus({ days: 5 }).toJSDate();

    const retentionPercentage = Number(preContract.retentionPercentage || 0);
    const retentionAmount = totalAmount * (retentionPercentage / 100);

    // Crear y persistir la factura
    const invoice = invoiceRepo.create({
      contract: preContract,
      billingMonth,
      issueDate: getCaracasTodayJSDate(),
      dueDate,
      baseAmount: isAffiliation ? 0 : totalAmount,
      totalAmount,
      paidAmount: 0,
      status: InvoiceStatus.PENDING,
      retentionPercentage,
      retentionAmount,
    });

    const savedInvoice = await invoiceRepo.save(invoice);

    // Crear líneas de factura
    const invoiceLines = invoiceDetailsData.map((data) =>
      qr.manager.create(InvoiceLine, {
        invoice: savedInvoice,
        category: isAffiliation ? InvoiceLineCategory.INCLUSION : InvoiceLineCategory.MENSUALIDAD,
        description: `${data.person.name} - ${data.plan.name}`,
        amount: data.chargedAmount,
        quantity: 1,
        person: data.person,
        plan: data.plan,
        isProjectable: !isAffiliation,
      }),
    );

    await qr.manager.save(invoiceLines);

    // Recargar con relaciones completas DENTRO de la transacción
    const reloadedInvoice = await invoiceRepo.findOne({
      where: { id: savedInvoice.id },
      relations: ['contract', 'lines', 'lines.person', 'lines.plan', 'payments'],
    });

    // El @Transactional hace commit al retornar. Emitimos el evento DESPUÉS
    // del commit para que SurplusService opere en su propia transacción limpia.
    const emitEvent = () => {
      this.eventEmitter.emit(INVOICE_CREATED, new InvoiceCreatedEvent(savedInvoice.id, contractId));
      this.logger.log(
        `[invoice] Evento '${INVOICE_CREATED}' emitido para factura ${savedInvoice.id}`,
      );
    };

    if (getContextSafe()) {
      registerPostCommitHook(emitEvent);
    } else {
      setImmediate(emitEvent);
    }

    return reloadedInvoice;
  }
}
