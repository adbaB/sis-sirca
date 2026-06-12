import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenamePercentageToCommissionAmount1781276769199 implements MigrationInterface {
  name = 'RenamePercentageToCommissionAmount1781276769199';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Plans: drop old check constraint, rename column, add new check
    await queryRunner.query(
      `ALTER TABLE "plans" DROP CONSTRAINT IF EXISTS "CHK_94152c0b3c6f0dba21b93b6b3a2"`,
    );
    await queryRunner.query(`ALTER TABLE "plans" DROP CONSTRAINT IF EXISTS "CHK_plans_percentage"`);
    // Try dropping any auto-generated check constraint on "percentage"
    const planConstraints = await queryRunner.query(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'plans'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%percentage%'`,
    );
    for (const row of planConstraints) {
      await queryRunner.query(`ALTER TABLE "plans" DROP CONSTRAINT "${row.conname}"`);
    }

    await queryRunner.query(
      `ALTER TABLE "plans" RENAME COLUMN "percentage" TO "commission_amount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ALTER COLUMN "commission_amount" TYPE numeric(10,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD CONSTRAINT "CHK_plans_commission_amount" CHECK ("commission_amount" >= 0)`,
    );

    // 2. Portfolios: drop old check constraint, rename column, add new check
    await queryRunner.query(
      `ALTER TABLE "portfolios" DROP CONSTRAINT IF EXISTS "CHK_b063b15ca4fc793ed61c29fde49"`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolios" DROP CONSTRAINT IF EXISTS "CHK_portfolios_percentage"`,
    );
    const portfolioConstraints = await queryRunner.query(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'portfolios'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%percentage%'`,
    );
    for (const row of portfolioConstraints) {
      await queryRunner.query(`ALTER TABLE "portfolios" DROP CONSTRAINT "${row.conname}"`);
    }

    await queryRunner.query(
      `ALTER TABLE "portfolios" RENAME COLUMN "percentage" TO "commission_amount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolios" ALTER COLUMN "commission_amount" TYPE numeric(10,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolios" ADD CONSTRAINT "CHK_portfolios_commission_amount" CHECK ("commission_amount" >= 0)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert portfolios
    await queryRunner.query(
      `ALTER TABLE "portfolios" DROP CONSTRAINT IF EXISTS "CHK_portfolios_commission_amount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolios" ALTER COLUMN "commission_amount" TYPE numeric(5,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolios" RENAME COLUMN "commission_amount" TO "percentage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolios" ADD CONSTRAINT "CHK_portfolios_percentage" CHECK ("percentage" >= 0 AND "percentage" <= 100)`,
    );

    // Revert plans
    await queryRunner.query(
      `ALTER TABLE "plans" DROP CONSTRAINT IF EXISTS "CHK_plans_commission_amount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ALTER COLUMN "commission_amount" TYPE numeric(5,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" RENAME COLUMN "commission_amount" TO "percentage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD CONSTRAINT "CHK_plans_percentage" CHECK ("percentage" >= 0 AND "percentage" <= 100)`,
    );
  }
}
