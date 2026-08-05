import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Equal, In, Not, QueryRunner, Repository } from 'typeorm';
import { ContractPerson } from '../../../contracts/entities/contract-person.entity';
import { Contract, ContractStatus } from '../../../contracts/entities/contract.entity';
import { Person, TypeIdentityCard } from '../../../persons/entities/person.entity';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { AddInvoiceLineInput } from '../dto/add-invoice-line.input';
import { InvoiceCalculationService } from './invoice-calculation.service';
import { InvoiceGenerationService } from './invoice-generation.service';
import { InvoiceLineService } from './invoice-line.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { resolveQueryRunner } from '../../../common/context/request-context';

/**
 * Facade público del módulo de facturas.
 *
 * Este servicio mantiene exactamente las mismas firmas de métodos públicos
 * que el InvoiceService original para garantizar compatibilidad con todos
 * los consumidores externos (crons, otros módulos que lo importan vía exports).
 *
 * Internamente delega a sub-servicios especializados:
 * - `InvoiceGenerationService`  → generación de facturas
 * - `InvoiceCalculationService` → recálculo de montos y status
 * - `InvoiceLineService`        → gestión de líneas y cargos adicionales
 * - `InvoicePdfService`         → generación de PDFs
 *
 * Las queries de búsqueda simples se mantienen en este facade.
 */
@Injectable()
export class InvoiceService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    private readonly dataSource: DataSource,
    private readonly generationService: InvoiceGenerationService,
    private readonly calculationService: InvoiceCalculationService,
    private readonly lineService: InvoiceLineService,
    private readonly pdfService: InvoicePdfService,
  ) {}

  // ---------------------------------------------------------------------------
  // Queries de búsqueda (responsabilidad propia del facade)
  // ---------------------------------------------------------------------------

  /**
   * Obtiene la factura con un lock pesimístico de escritura para evitar
   * condiciones de carrera. Lanza NotFoundException si no existe.
   */
  async fetchInvoiceWithLock(invoiceId: string): Promise<Invoice>;
  async fetchInvoiceWithLock(queryRunner: QueryRunner, invoiceId: string): Promise<Invoice>;
  async fetchInvoiceWithLock(
    queryRunnerOrId: QueryRunner | string,
    invoiceId?: string,
  ): Promise<Invoice> {
    let qr: QueryRunner;
    let id: string;

    if (typeof queryRunnerOrId === 'string') {
      id = queryRunnerOrId;
      qr = resolveQueryRunner(undefined, this.dataSource);
    } else {
      qr = resolveQueryRunner(queryRunnerOrId, this.dataSource);
      id = invoiceId!;
    }

    const invoice = await qr.manager
      .createQueryBuilder(Invoice, 'invoice')
      .setQueryRunner(qr)
      .innerJoinAndSelect('invoice.contract', 'contract')
      .where('invoice.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    return invoice;
  }

  /**
   * Busca facturas pendientes o parciales por código de contrato o cédula.
   * Soporta formatos: "CODE-123", "V-12345678", "V12345678".
   */
  async findPendingInvoices(queryStr: string): Promise<Invoice[]> {
    const trimmedQuery = queryStr.trim();

    // 1. Intentar buscar por código de contrato
    const contract = await this.dataSource.getRepository(Contract).findOne({
      where: { code: trimmedQuery },
    });

    let contractIds: string[];

    if (contract) {
      contractIds = [contract.id];
    } else {
      // 2. Buscar por cédula de identidad
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

      const contractPersons = await this.dataSource.getRepository(ContractPerson).find({
        where: {
          person: { id: person.id },
          contract: { status: Not(Equal(ContractStatus.INACTIVE)) },
        },
        relations: ['contract'],
      });

      if (contractPersons.length === 0) {
        return [];
      }

      contractIds = contractPersons.map((cp) => cp.contract.id);
    }

    return this.invoiceRepository.find({
      where: {
        contract: { id: In(contractIds) },
        status: In([InvoiceStatus.PENDING, InvoiceStatus.PARTIAL]),
      },
      relations: ['contract', 'contract.contractPersons', 'contract.contractPersons.person'],
      order: { billingMonth: 'ASC' },
    });
  }

  /**
   * @deprecated Usar {@link findPendingInvoices} con formato "TYPE-IDENTITYCARD"
   */
  async findPendingInvoicesByIdentityCard(
    identityCard: string,
    typeIdentityCard: TypeIdentityCard,
  ): Promise<Invoice[]> {
    return this.findPendingInvoices(`${typeIdentityCard}-${identityCard}`);
  }

  async findPendingInvoicesByBillingMonth(billingMonth: string): Promise<Invoice[]> {
    return this.invoiceRepository.find({
      where: {
        status: In([InvoiceStatus.PENDING, InvoiceStatus.PARTIAL]),
        billingMonth,
        contract: { contractPersons: { isBillingOwner: true } },
      },
      relations: { contract: { contractPersons: { person: true } } },
    });
  }

  async findInvoicesByIds(ids: string[]): Promise<Invoice[]> {
    if (!ids || ids.length === 0) return [];

    return this.invoiceRepository
      .createQueryBuilder('invoice')
      .innerJoinAndSelect('invoice.contract', 'contract')
      .where('invoice.id IN (:...ids)', { ids })
      .getMany();
  }

  // ---------------------------------------------------------------------------
  // Delegaciones a sub-servicios especializados
  // ---------------------------------------------------------------------------

  generateInvoiceForContract(
    contractId: string,
    billingMonthInput?: string,
    isAffiliation: boolean = false,
  ): Promise<Invoice> {
    return this.generationService.generateInvoiceForContract(
      contractId,
      billingMonthInput,
      isAffiliation,
    );
  }

  calculateAmountByInvoicesIds(ids: string[], paymentMethod: string): Promise<number> {
    return this.calculationService.calculateAmountByInvoicesIds(ids, paymentMethod);
  }

  recalculateInvoicePaidAmount(
    invoiceId: string,
    queryRunnerOrManager?: QueryRunner | import('typeorm').EntityManager,
  ): Promise<void> {
    // Normalizar a EntityManager para el sub-servicio
    let manager: import('typeorm').EntityManager | undefined;
    if (queryRunnerOrManager) {
      manager =
        'manager' in queryRunnerOrManager
          ? queryRunnerOrManager.manager
          : (queryRunnerOrManager as import('typeorm').EntityManager);
    }
    return this.calculationService.recalculateInvoicePaidAmount(invoiceId, manager);
  }

  recalculateInvoiceAmountFromContract(invoiceId: string): Promise<Invoice> {
    return this.calculationService.recalculateInvoiceAmountFromContract(invoiceId);
  }

  addAdditionalCharge(invoiceId: string, dto: AddInvoiceLineInput): Promise<Invoice> {
    return this.lineService.addAdditionalCharge(invoiceId, dto);
  }

  removeAdditionalCharge(invoiceId: string, lineId: string): Promise<Invoice> {
    return this.lineService.removeAdditionalCharge(invoiceId, lineId);
  }

  removeAffiliateLineFromActiveInvoice(
    contractId: string,
    personId: string,
    manager?: import('typeorm').EntityManager,
  ): Promise<void> {
    return this.lineService.removeAffiliateLineFromActiveInvoice(contractId, personId, manager);
  }

  updatePlanLineOnActiveInvoice(
    contractId: string,
    personId: string,
    newPlanId: string,
    newPlanAmount: number,
    newPlanName: string,
  ): Promise<void> {
    return this.lineService.updatePlanLineOnActiveInvoice(
      contractId,
      personId,
      newPlanId,
      newPlanAmount,
      newPlanName,
    );
  }

  /**
   * @deprecated Inyectar InvoicePdfService directamente en el controlador.
   * Este método se mantiene para compatibilidad temporal.
   */
  async buildInvoicePdf(invoiceId: string): Promise<{ pdfBuffer: Buffer; filename: string }> {
    return this.pdfService.buildInvoicePdf(invoiceId);
  }
}
