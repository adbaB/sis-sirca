import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTablesBilling1773424949612 implements MigrationInterface {
  name = 'AddTablesBilling1773424949612';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."payments_status_enum" AS ENUM('PROCESSING', 'COMPLETED', 'REJECTED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "payment_date" TIMESTAMP NOT NULL, "amount" numeric(10,2) NOT NULL, "payment_method" character varying(50) NOT NULL, "reference_number" character varying(100) NOT NULL, "status" "public"."payments_status_enum" NOT NULL DEFAULT 'PROCESSING', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, "invoice_id" uuid, CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."invoices_status_enum" AS ENUM('PENDING', 'PARTIAL', 'PAID', 'CANCELLED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "invoices" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "issue_date" date NOT NULL, "due_date" date NOT NULL, "total_amount" numeric(10,2) NOT NULL, "paid_amount" numeric(10,2) NOT NULL DEFAULT '0', "status" "public"."invoices_status_enum" NOT NULL DEFAULT 'PENDING', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, "contract_id" uuid, CONSTRAINT "PK_668cef7c22a427fd822cc1be3ce" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "invoice_details" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "charged_amount" numeric(10,2) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, "invoice_id" uuid, "person_id" uuid, "plan_id" uuid, CONSTRAINT "PK_3b7f561bae12fac5d2d0df9682b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."persons_status_enum" AS ENUM('ACTIVE', 'INACTIVE')`,
    );
    await queryRunner.query(
      `ALTER TABLE "persons" ADD "status" "public"."persons_status_enum" NOT NULL DEFAULT 'ACTIVE'`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."contracts_status_enum" AS ENUM('ACTIVE', 'INACTIVE')`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD "status" "public"."contracts_status_enum" NOT NULL DEFAULT 'ACTIVE'`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_563a5e248518c623eebd987d43e" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "FK_2a1393659dc4aa043ed203c8886" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_details" ADD CONSTRAINT "FK_2da75e038c5b463f19965b4c739" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_details" ADD CONSTRAINT "FK_d85b43d1d140c1e4cf76606c65b" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_details" ADD CONSTRAINT "FK_b3f935a9c5a5a0d26ed287f8f8c" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_details" DROP CONSTRAINT "FK_b3f935a9c5a5a0d26ed287f8f8c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_details" DROP CONSTRAINT "FK_d85b43d1d140c1e4cf76606c65b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_details" DROP CONSTRAINT "FK_2da75e038c5b463f19965b4c739"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "FK_2a1393659dc4aa043ed203c8886"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_563a5e248518c623eebd987d43e"`,
    );
    await queryRunner.query(`ALTER TABLE "contracts" DROP COLUMN "status"`);
    await queryRunner.query(`DROP TYPE "public"."contracts_status_enum"`);
    await queryRunner.query(`ALTER TABLE "persons" DROP COLUMN "status"`);
    await queryRunner.query(`DROP TYPE "public"."persons_status_enum"`);
    await queryRunner.query(`DROP TABLE "invoice_details"`);
    await queryRunner.query(`DROP TABLE "invoices"`);
    await queryRunner.query(`DROP TYPE "public"."invoices_status_enum"`);
    await queryRunner.query(`DROP TABLE "payments"`);
    await queryRunner.query(`DROP TYPE "public"."payments_status_enum"`);
  }
}
