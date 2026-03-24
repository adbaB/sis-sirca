import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Contract, ContractStatus } from '../../contracts/entities/contract.entity';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { InvoiceDetail } from '../entities/invoice-detail.entity';
import { PersonStatus } from '../../persons/entities/person.entity';

@Injectable()
export class BillingCronService {
  private readonly logger = new Logger(BillingCronService.name);

  constructor(
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    private readonly dataSource: DataSource,
  ) {}

  @Cron('0 0 25 * *')
  async generateMonthlyInvoices() {
    this.logger.log('Starting monthly invoice generation...');

    const chunkSize = 100;
    let offset = 0;

    const now = new Date();
    // 1st of the current month
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    // Last millisecond of the current month
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    // Let's set a due date for the 5th of the next month
    const dueDate = new Date(now.getFullYear(), now.getMonth() + 1, 5);

    // Create billingMonth string YYYY-MM
    const billingMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    while (true) {
      const contracts = await this.contractRepository.find({
        where: { status: ContractStatus.ACTIVE },
        relations: ['contractPersons', 'contractPersons.person', 'contractPersons.person.plan'],
        order: { id: 'ASC' },
        skip: offset,
        take: chunkSize,
      });

      if (contracts.length === 0) {
        break;
      }

      for (const contract of contracts) {
        await this.processContract(contract, startOfMonth, endOfMonth, dueDate, billingMonth);
      }

      offset += chunkSize;
    }

    this.logger.log('Monthly invoice generation completed.');
  }

  private async processContract(
    contract: Contract,
    startOfMonth: Date,
    endOfMonth: Date,
    dueDate: Date,
    billingMonth: string,
  ) {
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      // The idempotency check below is now only an optimization.
      // The true database truth check is enforced via the Unique constraint
      // on (contract, billingMonth).
      const existingInvoice = await queryRunner.manager.findOne(Invoice, {
        where: {
          contract: { id: contract.id },
          billingMonth,
        },
      });

      if (existingInvoice) {
        await queryRunner.rollbackTransaction();
        return; // Skip this contract as it already has an invoice for this month
      }

      const activeAfiliados = contract.contractPersons?.filter(
        (cp) => cp.role === 'AFILIADO' && cp.person?.status === PersonStatus.ACTIVE,
      ).map(cp => cp.person) || [];

      if (activeAfiliados.length === 0) {
        // No active afiliado persons, skip invoice generation
        await queryRunner.rollbackTransaction();
        return;
      }

      const invalidPerson = activeAfiliados.find(
        (p) => !p.plan || p.plan.amount === null || p.plan.amount === undefined,
      );
      if (invalidPerson) {
        throw new Error(
          `Active afiliado ${invalidPerson.id} in contract ${contract.id} has no valid plan amount`,
        );
      }

      let totalAmount = 0;
      const invoiceDetailsData = activeAfiliados.map((person) => {
        const amount = Number(person.plan.amount);
        totalAmount += amount;

        if (!Number.isFinite(amount) || amount < 0) {
          throw new Error(`Invalid plan amount for afiliado ${person.id} in contract ${contract.id}`);
        }

        return {
          person: person,
          plan: person.plan,
          chargedAmount: amount,
        };
      });

      // Create Invoice
      const invoice = queryRunner.manager.create(Invoice, {
        contract: contract,
        billingMonth: billingMonth,
        issueDate: new Date(),
        dueDate: dueDate,
        totalAmount: totalAmount,
        paidAmount: 0,
        status: InvoiceStatus.PENDING,
      });

      const savedInvoice = await queryRunner.manager.save(invoice);

      // Create Invoice Details
      const invoiceDetails = invoiceDetailsData.map((data) => {
        return queryRunner.manager.create(InvoiceDetail, {
          ...data,
          invoice: savedInvoice,
        });
      });

      await queryRunner.manager.save(invoiceDetails);

      await queryRunner.commitTransaction();
      this.logger.log(`Created invoice ${savedInvoice.id} for contract ${contract.id}`);
    } catch (error: unknown) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }

      // Postgres Unique Violation Code
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
    } finally {
      await queryRunner.release();
    }
  }
}
