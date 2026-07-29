import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddComissionAdvisor1785259875866 implements MigrationInterface {
  name = 'AddComissionAdvisor1785259875866';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD "advisor_commission" numeric(10,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD "exclude_from_next_billing" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "contracts" DROP COLUMN "exclude_from_next_billing"`);
    await queryRunner.query(`ALTER TABLE "contracts" DROP COLUMN "advisor_commission"`);
  }
}
