import { MigrationInterface, QueryRunner } from 'typeorm';

export class AssignAdvisorCodesToExisting1783350391062 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Temporarily move all codes to a negative offset to prevent UNIQUE constraint violations during update.
    // E.g., code 1 becomes -100001, code 2 becomes -100002.
    await queryRunner.query(`
        UPDATE "advisors"
        SET "code" = -1 * ("code" + 100000);
    `);

    // 2. Enforce sequential codes ordered by registration date (created_at)
    await queryRunner.query(`
        WITH ranked AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) as rn
          FROM "advisors"
        )
        UPDATE "advisors"
        SET "code" = ranked.rn
        FROM ranked
        WHERE "advisors"."id" = ranked.id;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No action needed for down migration as it's a data population migration
  }
}
