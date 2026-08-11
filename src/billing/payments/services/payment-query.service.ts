import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Payment, PaymentStatus } from '../entities/payment.entity';

/**
 * Servicio encargado exclusivamente de las operaciones de lectura y consulta de pagos.
 * Separa la lógica de consulta del procesamiento de transacciones (CQS / Clean Architecture).
 */
@Injectable()
export class PaymentQueryService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
  ) {}

  /**
   * Consulta registros de pagos aplicándoles filtros de búsqueda, estado y rango de fechas (mes/año),
   * retornando una respuesta paginada con sus relaciones asociadas (person, invoice, contract, surpluses).
   *
   * @param page - Número de página (1-indexed, por defecto: 1).
   * @param limit - Número de elementos por página (límite máximo: 100).
   * @param status - Estado opcional de pago a filtrar (PROCESSING, COMPLETED, REJECTED).
   * @param search - Término de búsqueda por referencia, cédula, nombre o código de contrato.
   * @param month - Mes de facturación (1 a 12).
   * @param year - Año de facturación (e.g. 2026).
   * @returns Objeto con el arreglo `data` de pagos y metadatos de paginación `meta`.
   */
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

  /**
   * Obtiene la cantidad de pagos que se encuentran actualmente en estado `PROCESSING`.
   *
   * @returns Promesa con el conteo numérico de pagos pendientes.
   */
  async countPendingPayments(): Promise<number> {
    return await this.paymentRepository.count({
      where: { status: PaymentStatus.PROCESSING },
    });
  }

  /**
   * Encuentra los pagos cuyo estado es `COMPLETED` y aún no han sido marcados como notificados (`sendAt` nulo).
   * Carga la estructura completa de relaciones requeridas para generar los reportes/PDFs.
   *
   * @returns Promesa con el arreglo de pagos con relaciones profundas.
   */
  async findUnsetPayment(): Promise<Payment[]> {
    return this.paymentRepository.find({
      where: {
        status: PaymentStatus.COMPLETED,
        sendAt: IsNull(),
      },
      relations: [
        'invoice',
        'invoice.contract',
        'invoice.contract.advisor',
        'invoice.contract.contractPersons',
        'invoice.contract.contractPersons.plan',
        'invoice.contract.contractPersons.person',
        'invoice.contract.contractPersons.person.plan',
        'invoice.lines',
        'invoice.lines.person',
        'invoice.lines.plan',
      ],
    });
  }
}
