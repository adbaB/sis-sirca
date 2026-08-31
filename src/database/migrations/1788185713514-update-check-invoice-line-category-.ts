import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateCheckInvoiceLineCategory1788185713514 implements MigrationInterface {
  name = 'UpdateCheckInvoiceLineCategory1788185713514';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_lines" DROP CONSTRAINT IF EXISTS "CHK_invoice_lines_category"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_lines" ADD CONSTRAINT "CHK_invoice_lines_category" CHECK ("category" IN ('MENSUALIDAD', 'COMISION', 'INCLUSION', 'RECOBRO', 'IMPUESTO', 'SUSCRIPCION'))`,
    );
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_lines" DROP CONSTRAINT IF EXISTS "CHK_invoice_lines_category"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_lines" ADD CONSTRAINT "CHK_invoice_lines_category" CHECK ("category" IN ('MENSUALIDAD', 'COMISION', 'INCLUSION', 'RECOBRO', 'IMPUESTO'))`,
    );
  }
}
