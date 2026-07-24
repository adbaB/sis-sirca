import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixAffiliationHistoryCheckConstraint1784901628928 implements MigrationInterface {
  name = 'FixAffiliationHistoryCheckConstraint1784901628928';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop old constraint that only allowed AFILIACION | DESAFILIACION
    await queryRunner.query(
      `ALTER TABLE "affiliation_history" DROP CONSTRAINT IF EXISTS "CHK_ah_action"`,
    );

    // Re-create with CAMBIO_CONTRATO included (matches AffiliationAction enum)
    await queryRunner.query(
      `ALTER TABLE "affiliation_history" ADD CONSTRAINT "CHK_ah_action" CHECK ("action" IN ('AFILIACION', 'DESAFILIACION', 'CAMBIO_CONTRATO'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "affiliation_history" DROP CONSTRAINT IF EXISTS "CHK_ah_action"`,
    );

    // Restore original constraint (without CAMBIO_CONTRATO)
    await queryRunner.query(
      `ALTER TABLE "affiliation_history" ADD CONSTRAINT "CHK_ah_action" CHECK ("action" IN ('AFILIACION', 'DESAFILIACION'))`,
    );
  }
}
