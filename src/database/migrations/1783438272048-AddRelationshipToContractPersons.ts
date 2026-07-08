import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRelationshipToContractPersons1783438272048 implements MigrationInterface {
  name = 'AddRelationshipToContractPersons1783438272048';

  public async up(queryRunner: QueryRunner): Promise<void> {
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
  }
}
