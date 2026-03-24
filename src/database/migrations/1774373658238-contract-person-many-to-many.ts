import { MigrationInterface, QueryRunner } from 'typeorm';

export class ContractPersonManyToMany1774373658238 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the new contract_persons junction table
    await queryRunner.query(`
            CREATE TYPE "public"."contract_persons_role_enum" AS ENUM('TITULAR', 'AFILIADO');
            CREATE TABLE "contract_persons" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "contract_id" uuid NOT NULL,
                "person_id" uuid NOT NULL,
                "role" "public"."contract_persons_role_enum" NOT NULL DEFAULT 'AFILIADO',
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                "deleted_at" TIMESTAMP,
                CONSTRAINT "UQ_contract_person" UNIQUE ("contract_id", "person_id"),
                CONSTRAINT "PK_contract_persons" PRIMARY KEY ("id")
            );
        `);

    // Add foreign keys
    await queryRunner.query(`
            ALTER TABLE "contract_persons" ADD CONSTRAINT "FK_contract_persons_contract" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
            ALTER TABLE "contract_persons" ADD CONSTRAINT "FK_contract_persons_person" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
        `);

    // Migrate existing contract_id data from persons to contract_persons (assuming all existing ones were AFILIADO by default for legacy constraints, or TITULAR if we want to be safe, but let's default to AFILIADO based on previous code)
    await queryRunner.query(`
            INSERT INTO "contract_persons" ("contract_id", "person_id", "role")
            SELECT "contract_id", "id", 'AFILIADO' FROM "persons" WHERE "contract_id" IS NOT NULL;
        `);

    // Drop the old contract_id column and foreign key from persons
    await queryRunner.query(`
            ALTER TABLE "persons" DROP CONSTRAINT IF EXISTS "FK_10c6782ef8b37b26c79510a4f39";
        `);
    await queryRunner.query(`
            ALTER TABLE "persons" DROP COLUMN "contract_id";
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-add contract_id column
    await queryRunner.query(`
            ALTER TABLE "persons" ADD "contract_id" uuid;
        `);

    // Re-add foreign key
    await queryRunner.query(`
            ALTER TABLE "persons" ADD CONSTRAINT "FK_persons_contract" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
        `);

    // Restore data (will lose M:N data if a person was in multiple contracts, picks one randomly basically)
    await queryRunner.query(`
            UPDATE "persons" p
            SET "contract_id" = cp."contract_id"
            FROM (
                SELECT DISTINCT ON ("person_id") "person_id", "contract_id" FROM "contract_persons"
            ) cp
            WHERE p."id" = cp."person_id";
        `);

    // Drop new table and enum
    await queryRunner.query(`
            ALTER TABLE "contract_persons" DROP CONSTRAINT "FK_contract_persons_contract";
            ALTER TABLE "contract_persons" DROP CONSTRAINT "FK_contract_persons_person";
            DROP TABLE "contract_persons";
            DROP TYPE "public"."contract_persons_role_enum";
        `);
  }
}
