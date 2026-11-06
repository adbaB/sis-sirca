import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCutoffDateToExtractionDetails1793200000000 implements MigrationInterface {
  name = 'AddCutoffDateToExtractionDetails1793200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "eventuality_extraction_details" ADD COLUMN IF NOT EXISTS "cutoff_date" date NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "eventuality_extraction_details" ADD COLUMN IF NOT EXISTS "source_file_url" text NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_eed_cutoff_date" ON "eventuality_extraction_details" ("cutoff_date")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_eed_cutoff_date"`);
    await queryRunner.query(
      `ALTER TABLE "eventuality_extraction_details" DROP COLUMN IF EXISTS "source_file_url"`,
    );
    await queryRunner.query(
      `ALTER TABLE "eventuality_extraction_details" DROP COLUMN IF EXISTS "cutoff_date"`,
    );
  }
}
