import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Contract, ContractStatus } from '../../contracts/entities/contract.entity';
import { InvoiceGenerationService } from '../invoices/services/invoice-generation.service';
import { getCaracasNow } from '../../common/utils/date.util';

@Injectable()
export class GenerateMonthlyInvoices {
  private readonly logger = new Logger(GenerateMonthlyInvoices.name);

  constructor(
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    private readonly dataSource: DataSource,
    private readonly invoiceGenerationService: InvoiceGenerationService,
  ) {}

  @Cron('1 0 25 * *')
  async generateMonthlyInvoices() {
    this.logger.log('Starting monthly invoice generation...');

    const chunkSize = 100;
    let offset = 0;

    const now = getCaracasNow();
    // Calculate the target month (next month) since invoices are generated on the 25th of the current month
    const targetDate = now.plus({ months: 1 });

    // Create billingMonth string YYYY-MM
    const billingMonth = targetDate.toFormat('yyyy-MM');

    while (true) {
      const contracts = await this.contractRepository.find({
        where: { status: ContractStatus.ACTIVE },
        order: { id: 'ASC' },
        skip: offset,
        take: chunkSize,
      });

      if (contracts.length === 0) {
        break;
      }

      for (const contract of contracts) {
        await this.processContract(contract, billingMonth);
      }

      offset += chunkSize;
    }

    this.logger.log('Monthly invoice generation completed.');
  }

  private async processContract(contract: Contract, billingMonth: string) {
    // Manejar exclusión de facturación antes de delegar al servicio.
    // Esta validación permanece en el cron porque `excludeFromNextBilling`
    // es un concepto del ciclo automático, no de la creación de facturas en general.
    if (contract.excludeFromNextBilling) {
      this.logger.log(
        `Contract ${contract.id} (${contract.code}) is excluded from billing cycle ${billingMonth}. Resetting excludeFromNextBilling to false.`,
      );

      const queryRunner = this.dataSource.createQueryRunner();
      try {
        await queryRunner.connect();
        await queryRunner.startTransaction();
        await queryRunner.manager.update(
          Contract,
          { id: contract.id },
          { excludeFromNextBilling: false },
        );
        await queryRunner.commitTransaction();
      } catch (error: unknown) {
        if (queryRunner.isTransactionActive) {
          await queryRunner.rollbackTransaction();
        }
        this.logger.error(
          `Error resetting excludeFromNextBilling for contract ${contract.id}: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      } finally {
        await queryRunner.release();
      }
      return;
    }

    try {
      // Delegar la creación de factura al servicio, que maneja:
      // - Retenciones (retentionPercentage, retentionAmount)
      // - Emisión del evento INVOICE_CREATED (post-commit)
      // - Aplicación automática de surplus vía SurplusService
      // - Validaciones de negocio y transaccionalidad
      const invoice = await this.invoiceGenerationService.generateInvoiceForContract(
        contract.id,
        billingMonth,
      );
      this.logger.log(`Created invoice ${invoice.id} for contract ${contract.id}`);
    } catch (error: unknown) {
      // BadRequestException con "Ya existe una factura" = idempotencia, skip silencioso
      if (error instanceof BadRequestException) {
        this.logger.log(`Skipping contract ${contract.id}: ${error.message}`);
        return;
      }

      // Postgres Unique Violation Code (doble protección de idempotencia)
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        this.logger.log(
          `Skipping contract ${contract.id}: Invoice for ${billingMonth} already exists (Duplicate Key)`,
        );
        return;
      }

      this.logger.error(
        `Error processing contract ${contract.id}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
