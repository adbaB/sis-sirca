import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { Contract, ContractStatus } from '../../contracts/entities/contract.entity';
import { Invoice, InvoiceStatus } from '../invoices/entities/invoice.entity';
import { formatDateES, getCaracasNow } from '../../common/utils/date.util';

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
  @Cron('0 1 * * *')
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
        const result = await this.evaluateAndSuspend(contract, today, now.toJSDate());
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
    nowDate: Date,
  ): Promise<SuspendedContractInfo | null> {
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      // Buscar facturas impagas vencidas
      const overdueInvoiceCount = await queryRunner.manager.count(Invoice, {
        where: {
          contract: { id: contract.id },
          status: In([InvoiceStatus.PENDING, InvoiceStatus.PARTIAL]),
          dueDate: LessThanOrEqual(nowDate),
        },
      });

      if (overdueInvoiceCount === 0) {
        await queryRunner.rollbackTransaction();
        return null;
      }

      const reason = `Suspendido automáticamente por corte de pago sin saldar (Día ${contract.cutoffDay ?? 5}): ${overdueInvoiceCount} factura(s) vencida(s)`;

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
