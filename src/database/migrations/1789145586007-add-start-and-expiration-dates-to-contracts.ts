import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStartAndExpirationDatesToContracts1789145586007 implements MigrationInterface {
  name = 'AddStartAndExpirationDatesToContracts1789145586007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "contracts" ADD "start_date" date`);
    await queryRunner.query(`ALTER TABLE "contracts" ADD "expiration_date" date`);
    await queryRunner.query(
      `UPDATE "contracts" SET "start_date" = "affiliation_date" WHERE "start_date" IS NULL AND "affiliation_date" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "contracts" DROP COLUMN "expiration_date"`);
    await queryRunner.query(`ALTER TABLE "contracts" DROP COLUMN "start_date"`);
  }
}
