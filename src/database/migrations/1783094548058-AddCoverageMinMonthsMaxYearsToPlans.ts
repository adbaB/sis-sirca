import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCoverageMinMonthsMaxYearsToPlans1783094548058 implements MigrationInterface {
  name = 'AddCoverageMinMonthsMaxYearsToPlans1783094548058';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "plans" ADD "coverage" numeric(10,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(`ALTER TABLE "plans" ADD "min_months" integer NOT NULL DEFAULT '2'`);
    await queryRunner.query(
      `ALTER TABLE "plans" ADD CONSTRAINT "CHK_plans_min_months" CHECK ("min_months" >= 2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD CONSTRAINT "CHK_plans_coverage" CHECK ("coverage" >= 0)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "plans" DROP CONSTRAINT "CHK_plans_coverage"`);
    await queryRunner.query(`ALTER TABLE "plans" DROP CONSTRAINT "CHK_plans_min_months"`);
    await queryRunner.query(`ALTER TABLE "plans" DROP COLUMN "min_months"`);
    await queryRunner.query(`ALTER TABLE "plans" DROP COLUMN "coverage"`);
  }
}
