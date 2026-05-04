import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentMetadata1778120671000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payments" ADD COLUMN "send_at" TIMESTAMP NULL`);
    await queryRunner.query(`ALTER TABLE "payments" ADD COLUMN "metadata" JSONB NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "metadata"`);
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "send_at"`);
  }
}
