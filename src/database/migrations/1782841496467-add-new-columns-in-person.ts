import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNewColumnsInPerson1782841496467 implements MigrationInterface {
  name = 'AddNewColumnsInPerson1782841496467';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."health_declarations_category_enum" AS ENUM('CARDIOVASCULAR', 'RESPIRATORIA', 'DIGESTIVA', 'ENDOCRINA', 'OSTEOMUSCULAR', 'GENITOURINARIA', 'PIEL_OJOS_OIDOS', 'CRONICA_TRANSITORIA', 'GINECOLOGICA', 'QUIRURGICA', 'OTROS')`,
    );
    await queryRunner.query(
      `CREATE TABLE "health_declarations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "category" "public"."health_declarations_category_enum" NOT NULL, "has_condition" boolean NOT NULL DEFAULT false, "affected_persons" text, "details" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "contract_person_id" uuid NOT NULL, CONSTRAINT "PK_5bfdb14afe34588589b46572d31" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`ALTER TABLE "persons" ADD "phone" character varying(20)`);
    await queryRunner.query(`ALTER TABLE "persons" ADD "alternate_phone" character varying(20)`);
    await queryRunner.query(`ALTER TABLE "persons" ADD "email" character varying(100)`);
    await queryRunner.query(`ALTER TABLE "persons" ADD "address" text`);
    await queryRunner.query(`ALTER TABLE "persons" ADD "city" character varying(100)`);
    await queryRunner.query(`ALTER TABLE "persons" ADD "state" character varying(100)`);
    await queryRunner.query(`ALTER TABLE "persons" ADD "postal_code" character varying(10)`);
    await queryRunner.query(`ALTER TABLE "persons" ADD "weight" numeric(5,2)`);
    await queryRunner.query(`ALTER TABLE "persons" ADD "height" numeric(4,2)`);
    await queryRunner.query(`ALTER TABLE "persons" ADD "occupation" character varying(100)`);
    await queryRunner.query(
      `ALTER TABLE "persons" ADD "legal_representative" character varying(255)`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."contract_persons_relationship_enum" AS ENUM('PADRE', 'MADRE', 'HIJO', 'HIJA', 'HERMANO', 'HERMANA', 'ESPOSO', 'ESPOSA', 'ABUELO', 'ABUELA', 'TIO', 'TIA', 'SOBRINO', 'SOBRINA', 'PRIMO', 'PRIMA', 'OTRO')`,
    );
    await queryRunner.query(
      `ALTER TABLE "contract_persons" ADD "relationship" "public"."contract_persons_relationship_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "health_declarations" ADD CONSTRAINT "FK_73fbbe21f279818cfb75cbb64f3" FOREIGN KEY ("contract_person_id") REFERENCES "contract_persons"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "health_declarations" DROP CONSTRAINT "FK_73fbbe21f279818cfb75cbb64f3"`,
    );
    await queryRunner.query(`ALTER TABLE "contract_persons" DROP COLUMN "relationship"`);
    await queryRunner.query(`DROP TYPE "public"."contract_persons_relationship_enum"`);
    await queryRunner.query(`ALTER TABLE "persons" DROP COLUMN "legal_representative"`);
    await queryRunner.query(`ALTER TABLE "persons" DROP COLUMN "occupation"`);
    await queryRunner.query(`ALTER TABLE "persons" DROP COLUMN "height"`);
    await queryRunner.query(`ALTER TABLE "persons" DROP COLUMN "weight"`);
    await queryRunner.query(`ALTER TABLE "persons" DROP COLUMN "postal_code"`);
    await queryRunner.query(`ALTER TABLE "persons" DROP COLUMN "state"`);
    await queryRunner.query(`ALTER TABLE "persons" DROP COLUMN "city"`);
    await queryRunner.query(`ALTER TABLE "persons" DROP COLUMN "address"`);
    await queryRunner.query(`ALTER TABLE "persons" DROP COLUMN "email"`);
    await queryRunner.query(`ALTER TABLE "persons" DROP COLUMN "alternate_phone"`);
    await queryRunner.query(`ALTER TABLE "persons" DROP COLUMN "phone"`);
    await queryRunner.query(`DROP TABLE "health_declarations"`);
    await queryRunner.query(`DROP TYPE "public"."health_declarations_category_enum"`);
  }
}
