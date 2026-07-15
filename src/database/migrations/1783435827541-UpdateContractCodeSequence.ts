import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateContractCodeSequence1783435827541 implements MigrationInterface {
  name = 'UpdateContractCodeSequence1783435827541';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "contracts" ADD "legacy_code" character varying(255)`);
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD CONSTRAINT "UQ_8f8356ccab135e98aab9afe1384" UNIQUE ("legacy_code")`,
    );

    await queryRunner.query(`
          DO $$
          DECLARE
              contract_rec RECORD;
              advisor_code_str TEXT;
              new_serial INT := 1;
          BEGIN
              FOR contract_rec IN 
                  SELECT c.id, c.code as old_code, a.code as adv_code
                  FROM "contracts" c
                  LEFT JOIN "advisors" a ON c.advisor_id = a.id
                  ORDER BY c.affiliation_date ASC, c.created_at ASC
              LOOP
                  IF contract_rec.adv_code IS NULL THEN
                      advisor_code_str := '000';
                  ELSIF contract_rec.adv_code < 1000 THEN
                      advisor_code_str := LPAD(contract_rec.adv_code::text, 3, '0');
                  ELSE
                      advisor_code_str := contract_rec.adv_code::text;
                  END IF;

                  UPDATE "contracts"
                  SET "legacy_code" = contract_rec.old_code,
                      "code" = 'SIR-' || advisor_code_str || '-' || LPAD(new_serial::text, 5, '0')
                  WHERE id = contract_rec.id;
                  
                  new_serial := new_serial + 1;
              END LOOP;

              -- Seed the system_counters table with the next available serial
              INSERT INTO "system_counters" ("key", "value") VALUES ('contract_code', new_serial)
              ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value";
          END $$;
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "contracts" SET "code" = "legacy_code" WHERE "legacy_code" IS NOT NULL`,
    );
    await queryRunner.query(`DELETE FROM "system_counters" WHERE "key" = 'contract_code'`);

    await queryRunner.query(
      `ALTER TABLE "contracts" DROP CONSTRAINT "UQ_8f8356ccab135e98aab9afe1384"`,
    );
    await queryRunner.query(`ALTER TABLE "contracts" DROP COLUMN "legacy_code"`);
  }
}
