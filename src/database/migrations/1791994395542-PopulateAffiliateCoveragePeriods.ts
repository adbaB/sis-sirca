import { MigrationInterface, QueryRunner } from 'typeorm';

export class PopulateAffiliateCoveragePeriods1791994395542 implements MigrationInterface {
  name = 'PopulateAffiliateCoveragePeriods1791994395542';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "contract_coverage_periods" (
        "id",
        "contract_id",
        "contract_person_id",
        "period_number",
        "start_date",
        "expiration_date",
        "status",
        "initial_coverage",
        "consumed_coverage",
        "reserved_coverage",
        "remaining_coverage",
        "created_at",
        "updated_at"
      )
      SELECT
        uuid_generate_v4() AS "id",
        c.id AS "contract_id",
        cp.id AS "contract_person_id",
        1 AS "period_number",
        COALESCE(c.start_date, cp.affiliation_date, c.affiliation_date, CURRENT_DATE)::date AS "start_date",
        COALESCE(
          c.expiration_date,
          (DATE_TRUNC('month', COALESCE(c.start_date, cp.affiliation_date, c.affiliation_date, CURRENT_DATE)::date + INTERVAL '11 months') + INTERVAL '1 month' - INTERVAL '1 day')::date
        ) AS "expiration_date",
        'ACTIVE' AS "status",
        COALESCE(p.coverage, pp.coverage, 0.00)::numeric(10,2) AS "initial_coverage",
        0.00 AS "consumed_coverage",
        0.00 AS "reserved_coverage",
        COALESCE(p.coverage, pp.coverage, 0.00)::numeric(10,2) AS "remaining_coverage",
        now() AS "created_at",
        now() AS "updated_at"
      FROM "contract_persons" cp
      INNER JOIN "contracts" c ON c.id = cp.contract_id
      LEFT JOIN "persons" person ON person.id = cp.person_id
      LEFT JOIN "plans" p ON p.id = cp.plan_id
      LEFT JOIN "plans" pp ON pp.id = person.plan_id
      WHERE cp.deleted_at IS NULL
        AND c.deleted_at IS NULL
        AND c.status IN ('ACTIVE', 'SUSPENDED')
        AND (cp.role = 'AFILIADO' OR cp.plan_id IS NOT NULL OR person.plan_id IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM "contract_coverage_periods" ccp
          WHERE ccp.contract_person_id = cp.id
            AND ccp.status = 'ACTIVE'
            AND ccp.deleted_at IS NULL
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "contract_coverage_periods"
      WHERE "period_number" = 1
        AND "consumed_coverage" = 0.00
        AND "reserved_coverage" = 0.00
    `);
  }
}
