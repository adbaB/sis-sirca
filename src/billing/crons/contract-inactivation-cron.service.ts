import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, MoreThan, Repository } from 'typeorm';
import { Contract, ContractStatus } from '../../contracts/entities/contract.entity';
import { EmailService } from '../../email/email.service';
import { Invoice, InvoiceStatus } from '../invoices/entities/invoice.entity';
import { formatDateES, getCaracasNow } from '../../common/utils/date.util';

interface InactivatedContractInfo {
  contractCode: string;
  titularName: string;
  unpaidInvoiceCount: number;
  inactivationDate: string;
}

@Injectable()
export class ContractInactivationCronService {
  private readonly logger = new Logger(ContractInactivationCronService.name);

  private static readonly NOTIFICATION_EMAIL = 'sircapagos@gmail.com';
  private static readonly UNPAID_THRESHOLD = 3;

  constructor(
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    private readonly dataSource: DataSource,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Runs on the 1st of every month at 12:00 PM.
   * Checks all ACTIVE contracts for delinquency (3+ unpaid invoices,
   * meaning 2+ months without paying) and inactivates them.
   * Sends a summary email to sircapagos@gmail.com with the list of
   * inactivated contracts.
   */
  @Cron('0 12 1 * *')
  async processContractInactivations(): Promise<void> {
    this.logger.log('Starting contract inactivation check for delinquency...');

    const chunkSize = 100;
    let lastId: string | null = null;
    const inactivatedContracts: InactivatedContractInfo[] = [];
    const today = formatDateES(getCaracasNow(), 'dd/MM/yyyy');

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
        const result = await this.evaluateAndInactivate(contract, today);
        if (result) {
          inactivatedContracts.push(result);
        }
      }

      lastId = contracts[contracts.length - 1].id;
    }

    this.logger.log(
      `Contract inactivation check completed. ${inactivatedContracts.length} contract(s) inactivated.`,
    );

    if (inactivatedContracts.length > 0) {
      await this.sendSummaryEmail(inactivatedContracts, today);
    }
  }

  private async evaluateAndInactivate(
    contract: Contract,
    today: string,
  ): Promise<InactivatedContractInfo | null> {
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const unpaidInvoiceCount = await queryRunner.manager.count(Invoice, {
        where: {
          contract: { id: contract.id },
          status: In([InvoiceStatus.PENDING, InvoiceStatus.PARTIAL]),
        },
      });

      if (unpaidInvoiceCount < ContractInactivationCronService.UNPAID_THRESHOLD) {
        await queryRunner.rollbackTransaction();
        return null;
      }

      const reason = `Inactivado automáticamente por morosidad: ${unpaidInvoiceCount} facturas impagas`;

      await queryRunner.manager.update(Contract, contract.id, {
        status: ContractStatus.INACTIVE,
        inactivationReason: reason,
      });

      await queryRunner.commitTransaction();

      this.logger.warn(
        `Contract ${contract.code} inactivated: ${unpaidInvoiceCount} unpaid invoices`,
      );

      const titularCp = contract.contractPersons?.find((cp) => cp.isBillingOwner === true);
      const titularName = titularCp?.person?.name ?? 'Sin titular';

      return {
        contractCode: contract.code,
        titularName,
        unpaidInvoiceCount,
        inactivationDate: today,
      };
    } catch (error: unknown) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      this.logger.error(
        `Error evaluating contract ${contract.id}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return null;
    } finally {
      await queryRunner.release();
    }
  }

  private async sendSummaryEmail(
    contracts: InactivatedContractInfo[],
    today: string,
  ): Promise<void> {
    const subject = `Contratos Inactivados por Morosidad — ${today} (${contracts.length} contrato(s))`;

    const tableRows = contracts
      .map(
        (c) => `
        <tr>
          <td style="padding:8px 12px;border:1px solid #ddd;">${c.contractCode}</td>
          <td style="padding:8px 12px;border:1px solid #ddd;">${c.titularName}</td>
          <td style="padding:8px 12px;border:1px solid #ddd;text-align:center;">${c.unpaidInvoiceCount}</td>
          <td style="padding:8px 12px;border:1px solid #ddd;">${c.inactivationDate}</td>
        </tr>`,
      )
      .join('');

    const htmlBody = `
      <div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;">
        <h2 style="color:#c0392b;">Reporte de Contratos Inactivados por Morosidad</h2>
        <p>Estimado equipo SIRCA,</p>
        <p>El proceso automático de revisión de morosidad se ejecutó el <strong>${today}</strong> y se inactivaron <strong>${contracts.length}</strong> contrato(s) por tener 3 o más facturas impagas.</p>
        <table style="border-collapse:collapse;width:100%;margin:20px 0;">
          <thead>
            <tr style="background-color:#c0392b;color:#fff;">
              <th style="padding:10px 12px;border:1px solid #ddd;text-align:left;">Código de Contrato</th>
              <th style="padding:10px 12px;border:1px solid #ddd;text-align:left;">Titular</th>
              <th style="padding:10px 12px;border:1px solid #ddd;text-align:center;">Facturas Impagas</th>
              <th style="padding:10px 12px;border:1px solid #ddd;text-align:left;">Fecha de Inactivación</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
        <p style="color:#888;font-size:12px;">Este es un correo automático generado por el sistema SIRCA. No responder.</p>
        <p>Salud Integral El Rosario C.A.</p>
      </div>
    `;

    try {
      await this.emailService.sendHtmlEmail(
        ContractInactivationCronService.NOTIFICATION_EMAIL,
        subject,
        htmlBody,
      );
      this.logger.log(
        `Summary email sent to ${ContractInactivationCronService.NOTIFICATION_EMAIL} with ${contracts.length} inactivated contract(s).`,
      );
    } catch (error: unknown) {
      this.logger.error(
        `Failed to send inactivation summary email: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
