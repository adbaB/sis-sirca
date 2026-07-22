import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOriginToPayments1784738400007 implements MigrationInterface {
  name = 'AddOriginToPayments1784738400007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" ADD "origin" character varying(20) NOT NULL DEFAULT 'WEB'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "origin"`);
  }
}
