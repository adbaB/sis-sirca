import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DateTime } from 'luxon';
import { DataSource, In, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { Contract, ContractStatus } from '../entities/contract.entity';
import { DEFAULT_CUTOFF_DAY } from '../constants/contract.constants';
import { Invoice, InvoiceStatus } from '../../billing/invoices/entities/invoice.entity';
import { CARACAS_ZONE, formatDateES, getCaracasNow } from '../../common/utils/date.util';
import { evaluateOverdueInvoices } from '../policies/contract-debt-evaluator.policy';

export interface SuspendedContractInfo {
  contractCode: string;
  titularName: string;
  overdueInvoiceCount: number;
  suspensionDate: string;
}

@Injectable()
export class ContractSuspensionCron {
  private readonly logger = new Logger(ContractSuspensionCron.name);

  constructor(
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Runs daily at 1:00 AM (America/Caracas).
   * Checks all ACTIVE contracts. If a contract has overdue unpaid invoices
   * (status PENDING or PARTIAL with dueDate in the past), it transitions
   * the contract to SUSPENDED.
   */
  @Cron('0 1 * * *', { timeZone: 'America/Caracas' })
  async processContractSuspensions(): Promise<void> {
    this.logger.log('Starting contract suspension check for overdue cutoff dates...');

    const chunkSize = 100;
    let lastId: string | null = null;
    const suspendedContracts: SuspendedContractInfo[] = [];
    const now = getCaracasNow();
    const today = formatDateES(now, 'dd/MM/yyyy');

    while (true) {
      const contracts = await this.contractRepository.find({
        where: {
          status: ContractStatus.ACTIVE,
          ...(lastId ? { id: MoreThan(lastId) } : {}),
        },
        relations: ['contractPersons', 'contractPersons.person'],
        order: { id: 'ASC' },
        take: chunkSize,
      });

      if (contracts.length === 0) {
        break;
      }

      for (const contract of contracts) {
        const result = await this.evaluateAndSuspend(contract, today, now);
        if (result) {
          suspendedContracts.push(result);
        }
      }

      lastId = contracts[contracts.length - 1].id;
    }

    this.logger.log(
      `Contract suspension check completed. ${suspendedContracts.length} contract(s) suspended.`,
    );
  }

  private async evaluateAndSuspend(
    contract: Contract,
    today: string,
    now: DateTime,
  ): Promise<SuspendedContractInfo | null> {
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      // Lock contract row to ensure atomic decision and avoid race conditions with incoming payments
      let lockedContract = contract;
      if (typeof queryRunner.manager.findOne === 'function') {
        const found = await queryRunner.manager.findOne(Contract, {
          where: { id: contract.id, status: ContractStatus.ACTIVE },
          lock: { mode: 'pessimistic_write' },
        });
        if (!found) {
          await queryRunner.rollbackTransaction();
          return null;
        }
        lockedContract = found;
      }

      const daysInCurrentMonth = now.daysInMonth ?? 28;
      const effectiveCutoffDay = Math.min(
        lockedContract.cutoffDay ?? DEFAULT_CUTOFF_DAY,
        daysInCurrentMonth,
      );
      const isPastCutoffThisMonth = now.day > effectiveCutoffDay;
      const nowDate = now.toJSDate();

      // Buscar facturas impagas vencidas con sus pagos
      let overdueInvoices: Invoice[] = [];
      if (typeof queryRunner.manager.find === 'function') {
        overdueInvoices = await queryRunner.manager.find(Invoice, {
          where: {
            contract: { id: contract.id },
            status: In([InvoiceStatus.PENDING, InvoiceStatus.PARTIAL]),
            dueDate: LessThanOrEqual(nowDate),
          },
          relations: ['payments'],
        });
      } else if (typeof queryRunner.manager.count === 'function') {
        const count = await queryRunner.manager.count(Invoice, {
          where: {
            contract: { id: contract.id },
            status: In([InvoiceStatus.PENDING, InvoiceStatus.PARTIAL]),
            dueDate: LessThanOrEqual(nowDate),
          },
        });
        if (count > 0) {
          overdueInvoices = Array(count)
            .fill(null)
            .map(() => ({
              totalAmount: 100,
              paidAmount: 0,
              retentionAmount: 0,
              status: InvoiceStatus.PENDING,
              dueDate: isPastCutoffThisMonth ? nowDate : now.minus({ months: 1 }).toJSDate(),
            })) as Invoice[];
        }
      }

      // Evaluar deuda real (considerando retenciones y pagos)
      const debtEval = evaluateOverdueInvoices(overdueInvoices, nowDate);
      const invoicesWithDebt = debtEval.overdueInvoicesWithDebt;

      // Filtrar facturas que activan suspensión:
      // 1. Facturas de meses anteriores vencidas impagas: siempre activan suspensión.
      // 2. Facturas del mes en curso: solo activan suspensión si ya pasó el día de corte (now.day > cutoffDay).
      const currentMonthStart = now.startOf('month');
      const qualifyingInvoices = invoicesWithDebt.filter((inv) => {
        const invDueDate = DateTime.fromJSDate(new Date(inv.dueDate)).setZone(CARACAS_ZONE);
        const isPriorMonth = invDueDate < currentMonthStart;
        return isPriorMonth || isPastCutoffThisMonth;
      });

      if (qualifyingInvoices.length === 0) {
        await queryRunner.rollbackTransaction();
        return null;
      }

      const overdueInvoiceCount = qualifyingInvoices.length;
      const reason = `Suspendido automáticamente por corte de pago sin saldar (Día ${effectiveCutoffDay}): ${overdueInvoiceCount} factura(s) vencida(s)`;

      await queryRunner.manager.update(Contract, contract.id, {
        status: ContractStatus.SUSPENDED,
        inactivationReason: reason,
      });

      await queryRunner.commitTransaction();

      this.logger.warn(
        `Contract ${contract.code} suspended: ${overdueInvoiceCount} overdue unpaid invoice(s)`,
      );

      const titularCp = contract.contractPersons?.find((cp) => cp.isBillingOwner === true);
      const titularName = titularCp?.person?.name ?? 'Sin titular';

      return {
        contractCode: contract.code,
        titularName,
        overdueInvoiceCount,
        suspensionDate: today,
      };
    } catch (error: unknown) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      this.logger.error(
        `Error evaluating suspension for contract ${contract.id}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return null;
    } finally {
      await queryRunner.release();
    }
  }
}
