import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPortfolioToContracts1781097683847 implements MigrationInterface {
  name = 'AddPortfolioToContracts1781097683847';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: Legacy enum column creation removed to prevent conflicts with relation-based portfolios
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
