import { MigrationInterface, QueryRunner } from 'typeorm';

export class RelocatePlanToContractPerson1785773204942 implements MigrationInterface {
  name = 'RelocatePlanToContractPerson1785773204942';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add plan_id column to contract_persons if not exists
    await queryRunner.query(
      `ALTER TABLE "contract_persons" ADD COLUMN IF NOT EXISTS "plan_id" uuid`,
    );

    // 2. Data Migration: Copy existing plan_id from persons to contract_persons for existing affiliates
    await queryRunner.query(`
            UPDATE "contract_persons" cp
            SET "plan_id" = p."plan_id"
            FROM "persons" p
            WHERE cp."person_id" = p."id"
              AND cp."role" = 'AFILIADO'
              AND p."plan_id" IS NOT NULL
              AND cp."plan_id" IS NULL
        `);

    // 3. Create index and foreign key constraint
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_contract_persons_plan_id" ON "contract_persons" ("plan_id")`,
    );
    await queryRunner.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_contract_persons_plan') THEN
                    ALTER TABLE "contract_persons" ADD CONSTRAINT "FK_contract_persons_plan" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
                END IF;
            END $$;
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contract_persons" DROP CONSTRAINT IF EXISTS "FK_contract_persons_plan"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_contract_persons_plan_id"`);
    await queryRunner.query(`ALTER TABLE "contract_persons" DROP COLUMN IF EXISTS "plan_id"`);
  }
}
