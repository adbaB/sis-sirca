import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRelationshipToContractPersons1783438272048 implements MigrationInterface {
  name = 'AddRelationshipToContractPersons1783438272048';

  public async up(queryRunner: QueryRunner): Promise<void> {
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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
  }
}
