import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSurplusTable1774998882823 implements MigrationInterface {
  name = 'AddSurplusTable1774998882823';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."surpluses_status_enum" AS ENUM('pending', 'applied', 'refunded', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TABLE "surpluses" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "amount_bs" numeric(10,2), "amount_usd" numeric(10,2), "date" TIMESTAMP NOT NULL, "status" "public"."surpluses_status_enum" NOT NULL DEFAULT 'pending', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "payment_id" uuid NOT NULL, "invoice_id" uuid, "contract_id" uuid NOT NULL, CONSTRAINT "PK_d04c01262cc498134cc4c8c5580" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "surpluses" ADD CONSTRAINT "FK_59a0aa81bb67d3ff70b32fcb003" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "surpluses" ADD CONSTRAINT "FK_3bd54b87a68c93dacb7346d31c6" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "surpluses" ADD CONSTRAINT "FK_f18e7a184952e521c57a54c4367" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "surpluses" DROP CONSTRAINT "FK_f18e7a184952e521c57a54c4367"`,
    );
    await queryRunner.query(
      `ALTER TABLE "surpluses" DROP CONSTRAINT "FK_3bd54b87a68c93dacb7346d31c6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "surpluses" DROP CONSTRAINT "FK_59a0aa81bb67d3ff70b32fcb003"`,
    );
    await queryRunner.query(`DROP TABLE "surpluses"`);
    await queryRunner.query(`DROP TYPE "public"."surpluses_status_enum"`);
  }
}
