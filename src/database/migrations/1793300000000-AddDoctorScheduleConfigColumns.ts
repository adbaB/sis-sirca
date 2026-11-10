import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDoctorScheduleConfigColumns1793300000000 implements MigrationInterface {
  name = 'AddDoctorScheduleConfigColumns1793300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "doctors"
      ADD COLUMN IF NOT EXISTS "consultation_duration_minutes" integer NOT NULL DEFAULT 30,
      ADD COLUMN IF NOT EXISTS "max_daily_consultations" integer NULL,
      ADD COLUMN IF NOT EXISTS "max_weekly_consultations" integer NULL,
      ADD COLUMN IF NOT EXISTS "max_monthly_consultations" integer NULL,
      ADD COLUMN IF NOT EXISTS "weekly_schedule" jsonb NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS "default_medical_service_id" uuid NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "doctors"
      ADD CONSTRAINT "CHK_doctors_consultation_duration"
      CHECK ("consultation_duration_minutes" >= 5 AND "consultation_duration_minutes" <= 240)
    `);

    await queryRunner.query(`
      ALTER TABLE "doctors"
      ADD CONSTRAINT "CHK_doctors_max_daily"
      CHECK ("max_daily_consultations" IS NULL OR "max_daily_consultations" >= 1)
    `);

    await queryRunner.query(`
      ALTER TABLE "doctors"
      ADD CONSTRAINT "CHK_doctors_max_weekly"
      CHECK ("max_weekly_consultations" IS NULL OR "max_weekly_consultations" >= 1)
    `);

    await queryRunner.query(`
      ALTER TABLE "doctors"
      ADD CONSTRAINT "CHK_doctors_max_monthly"
      CHECK ("max_monthly_consultations" IS NULL OR "max_monthly_consultations" >= 1)
    `);

    await queryRunner.query(`
      ALTER TABLE "doctors"
      ADD CONSTRAINT "FK_doctors_default_medical_service"
      FOREIGN KEY ("default_medical_service_id") REFERENCES "medical_services"("id")
      ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_doctors_default_medical_service_id"
      ON "doctors" ("default_medical_service_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_eventualities_doctor_type_admission"
      ON "eventualities" ("doctor_id", "type", "admission_date")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_eventualities_doctor_type_admission"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_doctors_default_medical_service_id"`);
    await queryRunner.query(
      `ALTER TABLE "doctors" DROP CONSTRAINT IF EXISTS "FK_doctors_default_medical_service"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctors" DROP CONSTRAINT IF EXISTS "CHK_doctors_max_monthly"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctors" DROP CONSTRAINT IF EXISTS "CHK_doctors_max_weekly"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctors" DROP CONSTRAINT IF EXISTS "CHK_doctors_max_daily"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctors" DROP CONSTRAINT IF EXISTS "CHK_doctors_consultation_duration"`,
    );
    await queryRunner.query(`
      ALTER TABLE "doctors"
      DROP COLUMN IF EXISTS "default_medical_service_id",
      DROP COLUMN IF EXISTS "weekly_schedule",
      DROP COLUMN IF EXISTS "max_monthly_consultations",
      DROP COLUMN IF EXISTS "max_weekly_consultations",
      DROP COLUMN IF EXISTS "max_daily_consultations",
      DROP COLUMN IF EXISTS "consultation_duration_minutes"
    `);
  }
}
