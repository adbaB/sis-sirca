import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSurplusMetadata1785773204943 implements MigrationInterface {
  name = 'AddSurplusMetadata1785773204943';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "surpluses" ADD COLUMN IF NOT EXISTS "metadata" JSONB NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "surpluses" DROP COLUMN IF EXISTS "metadata"`);
  }
}
