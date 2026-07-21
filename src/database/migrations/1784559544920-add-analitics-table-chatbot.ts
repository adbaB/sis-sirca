import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnaliticsTableChatbot1784559544920 implements MigrationInterface {
  name = 'AddAnaliticsTableChatbot1784559544920';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."chatbot_interactions_status_enum" AS ENUM('IN_PROGRESS', 'COMPLETED', 'ABANDONED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "chatbot_interactions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "phone" character varying(120) NOT NULL, "status" "public"."chatbot_interactions_status_enum" NOT NULL DEFAULT 'IN_PROGRESS', "current_step" character varying, "metadata" json, "started_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "completed_at" TIMESTAMP, CONSTRAINT "UQ_f3fd8497afc77766fe67d8c971a" UNIQUE ("phone"), CONSTRAINT "PK_0d4ee2b6daa14ebf2a6e079903a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "chatbot_interaction_invoices" ("interaction_id" uuid NOT NULL, "invoice_id" uuid NOT NULL, CONSTRAINT "PK_f4c7f1a0ac977ea552ce08fe079" PRIMARY KEY ("interaction_id", "invoice_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d4c04e84a0fc2b5c8bf6f360fd" ON "chatbot_interaction_invoices" ("interaction_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_08e2920491fe62d6ff8cef2480" ON "chatbot_interaction_invoices" ("invoice_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_73fbbe21f279818cfb75cbb64f" ON "health_declarations" ("contract_person_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_interaction_invoices" ADD CONSTRAINT "FK_d4c04e84a0fc2b5c8bf6f360fd6" FOREIGN KEY ("interaction_id") REFERENCES "chatbot_interactions"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_interaction_invoices" ADD CONSTRAINT "FK_08e2920491fe62d6ff8cef24807" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chatbot_interaction_invoices" DROP CONSTRAINT "FK_08e2920491fe62d6ff8cef24807"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_interaction_invoices" DROP CONSTRAINT "FK_d4c04e84a0fc2b5c8bf6f360fd6"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_73fbbe21f279818cfb75cbb64f"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_08e2920491fe62d6ff8cef2480"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_d4c04e84a0fc2b5c8bf6f360fd"`);
    await queryRunner.query(`DROP TABLE "chatbot_interaction_invoices"`);
    await queryRunner.query(`DROP TABLE "chatbot_interactions"`);
    await queryRunner.query(`DROP TYPE "public"."chatbot_interactions_status_enum"`);
  }
}
