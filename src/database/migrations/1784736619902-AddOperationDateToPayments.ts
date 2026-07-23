import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOperationDateToPayments1784736619902 implements MigrationInterface {
  name = 'AddOperationDateToPayments1784736619902';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payments" ADD "operation_date" TIMESTAMP`);
    await queryRunner.query(
      `UPDATE "payments" SET "operation_date" = "payment_date" WHERE "operation_date" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "operation_date"`);
  }
}
