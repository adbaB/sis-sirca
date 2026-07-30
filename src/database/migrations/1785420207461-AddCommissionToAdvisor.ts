import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCommissionToAdvisor1785420207461 implements MigrationInterface {
  name = 'AddCommissionToAdvisor1785420207461';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "advisors" ADD "commission" numeric(5,2) NOT NULL DEFAULT '0'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "advisors" DROP COLUMN "commission"`);
  }
}
