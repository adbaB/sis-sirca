import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUrlInPayments1774536350920 implements MigrationInterface {
  name = 'AddUrlInPayments1774536350920';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "payments" ADD "url" character varying(255)');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "payments" DROP COLUMN "url"');
  }
}
