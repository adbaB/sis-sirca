import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIsRevertedToAffiliationHistory1788447809560 implements MigrationInterface {
  name = 'AddIsRevertedToAffiliationHistory1788447809560';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "affiliation_history" ADD "is_reverted" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "affiliation_history" ADD "reverted_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ah_is_reverted" ON "affiliation_history" ("is_reverted") `,
    );
    await queryRunner.query(
      `UPDATE "affiliation_history" SET "is_reverted" = true WHERE "reason" LIKE 'REVERTIDO:%'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_ah_is_reverted"`);
    await queryRunner.query(`ALTER TABLE "affiliation_history" DROP COLUMN "reverted_at"`);
    await queryRunner.query(`ALTER TABLE "affiliation_history" DROP COLUMN "is_reverted"`);
  }
}
