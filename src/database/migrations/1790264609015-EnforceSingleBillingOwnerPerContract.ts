import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceSingleBillingOwnerPerContract1790264609015 implements MigrationInterface {
  name = 'EnforceSingleBillingOwnerPerContract1790264609015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Saneamiento de datos: desmarcar registros duplicados de is_billing_owner en contratos activos
    await queryRunner.query(`
      WITH ranked_billing_owners AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY "contract_id" 
                 ORDER BY "updated_at" DESC, "created_at" DESC
               ) as rn
        FROM "contract_persons"
        WHERE "is_billing_owner" = true 
          AND "deleted_at" IS NULL
      )
      UPDATE "contract_persons"
      SET "is_billing_owner" = false
      WHERE id IN (
        SELECT id FROM ranked_billing_owners WHERE rn > 1
      )
    `);

    // 2. Crear índice único parcial para garantizar un único titular de factura activo por contrato
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_contract_person_billing_owner"
      ON "contract_persons" ("contract_id")
      WHERE "is_billing_owner" = true AND "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_contract_person_billing_owner"`,
    );
  }
}
