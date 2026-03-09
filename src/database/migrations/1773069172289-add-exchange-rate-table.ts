import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExchangeRateTable1773069172289 implements MigrationInterface {
  name = 'AddExchangeRateTable1773069172289';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "exchange_rate" ("uuid" uuid NOT NULL DEFAULT uuid_generate_v4(), "date" date NOT NULL, "rateUsd" numeric(10,2) NOT NULL, "rateEur" numeric(10,2) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_ffa32005d59de0f0109411d0a6d" UNIQUE ("date"), CONSTRAINT "PK_0c7f9cbb077485fa86839e2a33d" PRIMARY KEY ("uuid"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "exchange_rate"`);
  }
}
