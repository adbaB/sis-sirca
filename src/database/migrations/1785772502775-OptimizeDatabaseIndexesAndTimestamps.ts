import { MigrationInterface, QueryRunner } from 'typeorm';

export class OptimizeDatabaseIndexesAndTimestamps1785772502775 implements MigrationInterface {
  name = 'OptimizeDatabaseIndexesAndTimestamps1785772502775';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Pin PostgreSQL session timezone to America/Caracas so naive timestamp conversions retain expected wall-clock times
    await queryRunner.query(`SET LOCAL TimeZone = 'America/Caracas'`);

    // Safe timestamp -> timestamptz conversions using ALTER COLUMN TYPE (preserves existing data)
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "roles" ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "roles" ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "contracts" ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "portfolios" ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolios" ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolios" ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "plans" ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "permissions" ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "permissions" ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "persons" ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "persons" ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "persons" ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "health_declarations" ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "health_declarations" ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "contract_persons" ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "contract_persons" ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "contract_persons" ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "affiliation_history" ALTER COLUMN "action_date" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "affiliation_history" ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "invoices" ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "chatbot_interactions" ALTER COLUMN "started_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_interactions" ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_interactions" ALTER COLUMN "completed_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "advisors" ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "advisors" ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "advisors" ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "payments" ALTER COLUMN "payment_date" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ALTER COLUMN "operation_date" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ALTER COLUMN "send_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "surpluses" ALTER COLUMN "date" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "surpluses" ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "surpluses" ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "invoice_lines" ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_lines" ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_lines" ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );

    // Index creations IF NOT EXISTS
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_users_role_id" ON "users" ("role_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_users_advisor_id" ON "users" ("advisor_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_contracts_advisor_id" ON "contracts" ("advisor_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_contracts_portfolio_id" ON "contracts" ("portfolio_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_contracts_status" ON "contracts" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_persons_email" ON "persons" ("email")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_persons_plan_id" ON "persons" ("plan_id")`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_persons_name" ON "persons" ("name")`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_contract_persons_person_id" ON "contract_persons" ("person_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_contract_persons_contract_id" ON "contract_persons" ("contract_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ah_action_date" ON "affiliation_history" ("action_date")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ah_plan" ON "affiliation_history" ("plan_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_invoices_status" ON "invoices" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_invoices_billing_month" ON "invoices" ("billing_month")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_invoices_contract_id" ON "invoices" ("contract_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_chatbot_phone" ON "chatbot_interactions" ("phone")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_payments_status_send_at" ON "payments" ("status", "send_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_payments_payment_date" ON "payments" ("payment_date")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_payments_reference_number" ON "payments" ("reference_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_payments_person_id" ON "payments" ("person_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_payments_invoice_id" ON "payments" ("invoice_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_surpluses_status" ON "surpluses" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_surpluses_invoice_id" ON "surpluses" ("invoice_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_surpluses_payment_id" ON "surpluses" ("payment_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_surpluses_contract_id" ON "surpluses" ("contract_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_invoice_lines_plan_id" ON "invoice_lines" ("plan_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_invoice_lines_person_id" ON "invoice_lines" ("person_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Pin PostgreSQL session timezone to America/Caracas for reverse conversions
    await queryRunner.query(`SET LOCAL TimeZone = 'America/Caracas'`);

    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_invoice_lines_person_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_invoice_lines_plan_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_surpluses_contract_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_surpluses_payment_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_surpluses_invoice_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_surpluses_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_payments_invoice_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_payments_person_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_payments_reference_number"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_payments_payment_date"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_payments_status_send_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_chatbot_phone"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_invoices_contract_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_invoices_billing_month"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_invoices_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_ah_plan"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_ah_action_date"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_contract_persons_contract_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_contract_persons_person_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_persons_name"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_persons_plan_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_persons_email"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_contracts_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_contracts_portfolio_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_contracts_advisor_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_users_advisor_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_users_role_id"`);

    await queryRunner.query(`ALTER TABLE "invoice_lines" ALTER COLUMN "deleted_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "invoice_lines" ALTER COLUMN "updated_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "invoice_lines" ALTER COLUMN "created_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "surpluses" ALTER COLUMN "updated_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "surpluses" ALTER COLUMN "created_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "surpluses" ALTER COLUMN "date" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "deleted_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "updated_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "created_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "send_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "operation_date" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "payment_date" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "advisors" ALTER COLUMN "deleted_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "advisors" ALTER COLUMN "updated_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "advisors" ALTER COLUMN "created_at" TYPE TIMESTAMP`);
    await queryRunner.query(
      `ALTER TABLE "chatbot_interactions" ALTER COLUMN "completed_at" TYPE TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_interactions" ALTER COLUMN "updated_at" TYPE TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_interactions" ALTER COLUMN "started_at" TYPE TIMESTAMP`,
    );
    await queryRunner.query(`ALTER TABLE "invoices" ALTER COLUMN "deleted_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "invoices" ALTER COLUMN "updated_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "invoices" ALTER COLUMN "created_at" TYPE TIMESTAMP`);
    await queryRunner.query(
      `ALTER TABLE "affiliation_history" ALTER COLUMN "created_at" TYPE TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "affiliation_history" ALTER COLUMN "action_date" TYPE TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "contract_persons" ALTER COLUMN "deleted_at" TYPE TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "contract_persons" ALTER COLUMN "updated_at" TYPE TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "contract_persons" ALTER COLUMN "created_at" TYPE TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "health_declarations" ALTER COLUMN "updated_at" TYPE TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "health_declarations" ALTER COLUMN "created_at" TYPE TIMESTAMP`,
    );
    await queryRunner.query(`ALTER TABLE "persons" ALTER COLUMN "deleted_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "persons" ALTER COLUMN "updated_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "persons" ALTER COLUMN "created_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "permissions" ALTER COLUMN "updated_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "permissions" ALTER COLUMN "created_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "plans" ALTER COLUMN "deleted_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "plans" ALTER COLUMN "updated_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "plans" ALTER COLUMN "created_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "portfolios" ALTER COLUMN "deleted_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "portfolios" ALTER COLUMN "updated_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "portfolios" ALTER COLUMN "created_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "contracts" ALTER COLUMN "deleted_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "contracts" ALTER COLUMN "updated_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "contracts" ALTER COLUMN "created_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "roles" ALTER COLUMN "updated_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "roles" ALTER COLUMN "created_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "updated_at" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "created_at" TYPE TIMESTAMP`);
  }
}
