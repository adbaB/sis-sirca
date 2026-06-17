import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvoiceLinesAndAffiliationHistory1781400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ═══════════════════════════════════════════════════════════════
    // STEP 1: Crear tabla invoice_lines
    // ═══════════════════════════════════════════════════════════════
    await queryRunner.query(`
      CREATE TABLE "invoice_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "invoice_id" uuid NOT NULL,
        "category" varchar(30) NOT NULL DEFAULT 'MENSUALIDAD',
        "description" varchar(255) NOT NULL,
        "amount" decimal(10,2) NOT NULL,
        "quantity" int NOT NULL DEFAULT 1,
        "person_id" uuid,
        "plan_id" uuid,
        "is_projectable" boolean NOT NULL DEFAULT false,
        "metadata" jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        CONSTRAINT "PK_invoice_lines" PRIMARY KEY ("id"),
        CONSTRAINT "FK_invoice_lines_invoice" FOREIGN KEY ("invoice_id")
          REFERENCES "invoices"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_invoice_lines_person" FOREIGN KEY ("person_id")
          REFERENCES "persons"("id"),
        CONSTRAINT "FK_invoice_lines_plan" FOREIGN KEY ("plan_id")
          REFERENCES "plans"("id"),
        CONSTRAINT "CHK_invoice_lines_amount" CHECK ("amount" >= 0),
        CONSTRAINT "CHK_invoice_lines_quantity" CHECK ("quantity" > 0),
        CONSTRAINT "CHK_invoice_lines_category" CHECK (
          "category" IN ('MENSUALIDAD','COMISION','INCLUSION','RECOBRO','IMPUESTO')
        )
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_invoice_lines_invoice" ON "invoice_lines"("invoice_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_invoice_lines_category" ON "invoice_lines"("category")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_invoice_lines_projectable" ON "invoice_lines"("is_projectable")`,
    );

    // ═══════════════════════════════════════════════════════════════
    // STEP 2: Agregar base_amount a invoices
    // ═══════════════════════════════════════════════════════════════
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD COLUMN "base_amount" decimal(10,2) NOT NULL DEFAULT 0, ADD CONSTRAINT "CHK_invoices_base_amount" CHECK ("base_amount" >= 0)`,
    );
    await queryRunner.query(`UPDATE "invoices" SET "base_amount" = "total_amount"`);

    // ═══════════════════════════════════════════════════════════════
    // STEP 3: Migrar datos de invoice_details → invoice_lines
    // ═══════════════════════════════════════════════════════════════
    await queryRunner.query(`
      INSERT INTO "invoice_lines" (
        "invoice_id", "category", "description", "amount", "quantity",
        "person_id", "plan_id", "is_projectable", "created_at", "updated_at", "deleted_at"
      )
      SELECT
        id."invoice_id",
        'MENSUALIDAD',
        COALESCE(p."name", 'Afiliado') || ' - ' || COALESCE(pl."name", 'Plan'),
        id."charged_amount",
        1,
        id."person_id",
        id."plan_id",
        true,
        id."created_at",
        id."updated_at",
        id."deleted_at"
      FROM "invoice_details" id
      LEFT JOIN "persons" p ON p."id" = id."person_id"
      LEFT JOIN "plans" pl ON pl."id" = id."plan_id"
    `);

    // ═══════════════════════════════════════════════════════════════
    // STEP 4: Crear tabla affiliation_history
    // ═══════════════════════════════════════════════════════════════
    await queryRunner.query(`
      CREATE TABLE "affiliation_history" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "contract_id" uuid NOT NULL,
        "person_id" uuid NOT NULL,
        "plan_id" uuid,
        "action" varchar(20) NOT NULL,
        "amount" decimal(10,2) NOT NULL DEFAULT 0,
        "reason" varchar(255),
        "performed_by" uuid,
        "action_date" TIMESTAMP NOT NULL DEFAULT now(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_affiliation_history" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ah_contract" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id"),
        CONSTRAINT "FK_ah_person" FOREIGN KEY ("person_id") REFERENCES "persons"("id"),
        CONSTRAINT "FK_ah_plan" FOREIGN KEY ("plan_id") REFERENCES "plans"("id"),
        CONSTRAINT "CHK_ah_action" CHECK ("action" IN ('AFILIACION', 'DESAFILIACION'))
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_ah_contract" ON "affiliation_history"("contract_id")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_ah_person" ON "affiliation_history"("person_id")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_ah_action_date" ON "affiliation_history"("action_date")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_ah_action" ON "affiliation_history"("action")`);

    // ═══════════════════════════════════════════════════════════════
    // STEP 5: Fix unique constraint en contract_persons para soft delete
    // ═══════════════════════════════════════════════════════════════
    const constraints = await queryRunner.query(`
      SELECT tc.constraint_name 
      FROM information_schema.table_constraints tc 
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name 
        AND tc.table_schema = kcu.table_schema
      WHERE tc.table_name = 'contract_persons' 
        AND tc.constraint_type = 'UNIQUE'
        AND kcu.column_name IN ('contract_id', 'person_id')
      GROUP BY tc.constraint_name
      HAVING COUNT(DISTINCT kcu.column_name) = 2
    `);
    for (const c of constraints) {
      await queryRunner.query(
        `ALTER TABLE "contract_persons" DROP CONSTRAINT "${c.constraint_name}"`,
      );
    }
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_contract_person_active"
      ON "contract_persons" ("contract_id", "person_id")
      WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_contract_person_active"`);

    // Clean up duplicate (contract_id, person_id) rows before restoring global unique constraint
    await queryRunner.query(`
      WITH duplicates AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY "contract_id", "person_id" 
                 ORDER BY ("deleted_at" IS NULL) DESC, "created_at" DESC
               ) as rn
        FROM "contract_persons"
      )
      DELETE FROM "contract_persons"
      WHERE id IN (
        SELECT id FROM duplicates WHERE rn > 1
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "contract_persons" ADD CONSTRAINT "UQ_contract_person"
      UNIQUE ("contract_id", "person_id")
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "affiliation_history"`);
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN IF EXISTS "base_amount"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "invoice_lines"`);
  }
}
