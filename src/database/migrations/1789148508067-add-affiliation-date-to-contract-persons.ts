import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAffiliationDateToContractPersons1789148508067 implements MigrationInterface {
  name = 'AddAffiliationDateToContractPersons1789148508067';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add column if not exists
    await queryRunner.query(
      `ALTER TABLE "contract_persons" ADD COLUMN IF NOT EXISTS "affiliation_date" date`,
    );

    // 2. Backfill existing records using the contract's affiliation_date
    await queryRunner.query(`
      UPDATE "contract_persons" cp
      SET "affiliation_date" = c."affiliation_date"
      FROM "contracts" c
      WHERE cp."contract_id" = c."id" AND cp."affiliation_date" IS NULL
    `);

    // 3. Fallback for any records without contract affiliation_date
    await queryRunner.query(`
      UPDATE "contract_persons"
      SET "affiliation_date" = "created_at"::date
      WHERE "affiliation_date" IS NULL
    `);

    // 4. Enforce NOT NULL constraint
    await queryRunner.query(
      `ALTER TABLE "contract_persons" ALTER COLUMN "affiliation_date" SET NOT NULL`,
    );

    // 5. Create index on affiliation_date
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_contract_persons_affiliation_date" ON "contract_persons" ("affiliation_date")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_contract_persons_affiliation_date"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contract_persons" DROP COLUMN IF EXISTS "affiliation_date"`,
    );
  }
}
