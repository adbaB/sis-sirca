import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, Between } from 'typeorm';
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

    while (true) {
      const contracts = await this.contractRepository.find({
        where: { status: ContractStatus.ACTIVE },
        relations: ['persons', 'persons.plan'],
        skip: offset,
        take: chunkSize,
      });

      if (contracts.length === 0) {
        break;
      }

      for (const contract of contracts) {
        await this.processContract(contract, startOfMonth, endOfMonth, dueDate);
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
  ) {
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Idempotency check: see if invoice for this month already exists
      const existingInvoice = await queryRunner.manager.findOne(Invoice, {
        where: {
          contract: { id: contract.id },
          issueDate: Between(startOfMonth, endOfMonth),
        },
      });

      if (existingInvoice) {
        await queryRunner.rollbackTransaction();
        return; // Skip this contract as it already has an invoice for this month
      }

      const activePersons = contract.persons.filter((p) => p.status === PersonStatus.ACTIVE);

      if (activePersons.length === 0) {
        // No active persons, skip invoice generation
        await queryRunner.rollbackTransaction();
        return;
      }

      let totalAmount = 0;
      const invoiceDetailsData = activePersons.map((person) => {
        const amount = Number(person.plan.amount);
        totalAmount += amount;

        return {
          person: person,
          plan: person.plan,
          chargedAmount: amount,
        };
      });

      // Create Invoice
      const invoice = queryRunner.manager.create(Invoice, {
        contract: contract,
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
    } catch (error) {
      this.logger.error(
        `Error processing contract ${contract.id}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      await queryRunner.rollbackTransaction();
    } finally {
      await queryRunner.release();
    }
  }
}
