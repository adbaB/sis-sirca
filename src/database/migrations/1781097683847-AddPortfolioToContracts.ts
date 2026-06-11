import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPortfolioToContracts1781097683847 implements MigrationInterface {
  name = 'AddPortfolioToContracts1781097683847';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."contracts_portfolio_enum" AS ENUM('HER', 'APF', 'GMP')`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD "portfolio" "public"."contracts_portfolio_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "contracts" DROP COLUMN "portfolio"`);
    await queryRunner.query(`DROP TYPE "public"."contracts_portfolio_enum"`);
  }
}
