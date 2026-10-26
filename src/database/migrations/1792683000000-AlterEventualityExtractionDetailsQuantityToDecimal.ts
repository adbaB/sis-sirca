import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlterEventualityExtractionDetailsQuantityToDecimal1792683000000 implements MigrationInterface {
  name = 'AlterEventualityExtractionDetailsQuantityToDecimal1792683000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "eventuality_extraction_details" ALTER COLUMN "quantity" TYPE numeric(10,3) USING "quantity"::numeric(10,3)`,
    );
    await queryRunner.query(
      `ALTER TABLE "eventuality_extraction_details" ALTER COLUMN "quantity" SET DEFAULT 1.000`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "eventuality_extraction_details" ALTER COLUMN "quantity" TYPE integer USING ROUND("quantity")::integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "eventuality_extraction_details" ALTER COLUMN "quantity" SET DEFAULT 1`,
    );
  }
}
