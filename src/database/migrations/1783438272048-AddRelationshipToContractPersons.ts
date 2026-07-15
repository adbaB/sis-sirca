import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRelationshipToContractPersons1783438272048 implements MigrationInterface {
  name = 'AddRelationshipToContractPersons1783438272048';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasEnum = await queryRunner.query(
      `SELECT 1 FROM pg_type WHERE typname = 'contract_persons_relationship_enum'`,
    );
    if (!hasEnum.length) {
      await queryRunner.query(
        `CREATE TYPE "public"."contract_persons_relationship_enum" AS ENUM('PADRE', 'MADRE', 'HIJO', 'HIJA', 'HERMANO', 'HERMANA', 'ESPOSO', 'ESPOSA', 'ABUELO', 'ABUELA', 'TIO', 'TIA', 'SOBRINO', 'SOBRINA', 'PRIMO', 'PRIMA', 'OTRO')`,
      );
    }
    const hasColumn = await queryRunner.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contract_persons' AND column_name = 'relationship'`,
    );
    if (!hasColumn.length) {
      await queryRunner.query(
        `ALTER TABLE "contract_persons" ADD "relationship" "public"."contract_persons_relationship_enum"`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "contract_persons" DROP COLUMN "relationship"`);
    await queryRunner.query(`DROP TYPE "public"."contract_persons_relationship_enum"`);
  }
}
