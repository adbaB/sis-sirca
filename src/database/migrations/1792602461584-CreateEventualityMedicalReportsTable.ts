import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEventualityMedicalReportsTable1792602461584 implements MigrationInterface {
  name = 'CreateEventualityMedicalReportsTable1792602461584';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "eventuality_medical_reports" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "eventuality_id" uuid NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'PROCESSING', "report_type" text, "company" text, "doctor_full_name" text, "doctor_identity_card" character varying(50), "doctor_ms" character varying(100), "doctor_comezu" character varying(100), "doctor_specialty" text, "admission_diagnosis" text, "medical_report" text, "discharge_diagnosis" text, "report_date" character varying(50), "report_time" character varying(50), "error_message" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_ac6c6a3a5281c54676770a5ab57" UNIQUE ("eventuality_id"), CONSTRAINT "REL_ac6c6a3a5281c54676770a5ab5" UNIQUE ("eventuality_id"), CONSTRAINT "CHK_emr_status" CHECK ("status" IN ('PROCESSING', 'EXTRACTED', 'EDITED', 'FAILED')), CONSTRAINT "PK_eba67a17cd40ddc2338a1b9b4a4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_emr_eventuality_id" ON "eventuality_medical_reports" ("eventuality_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "eventuality_medical_reports" ADD CONSTRAINT "FK_ac6c6a3a5281c54676770a5ab57" FOREIGN KEY ("eventuality_id") REFERENCES "eventualities"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "eventualities" ADD "consumption_currency" character varying(10)`,
    );
    await queryRunner.query(`ALTER TABLE "eventualities" ADD "exchange_rate_date" date`);
    await queryRunner.query(
      `ALTER TABLE "eventualities" ADD "applied_exchange_rate" numeric(10,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "eventuality_extraction_details" ADD "unit_cost_bs" numeric(12,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "eventuality_extraction_details" ADD "total_cost_bs" numeric(12,2)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "eventuality_extraction_details" DROP COLUMN "total_cost_bs"`,
    );
    await queryRunner.query(
      `ALTER TABLE "eventuality_extraction_details" DROP COLUMN "unit_cost_bs"`,
    );
    await queryRunner.query(`ALTER TABLE "eventualities" DROP COLUMN "applied_exchange_rate"`);
    await queryRunner.query(`ALTER TABLE "eventualities" DROP COLUMN "exchange_rate_date"`);
    await queryRunner.query(`ALTER TABLE "eventualities" DROP COLUMN "consumption_currency"`);
    await queryRunner.query(
      `ALTER TABLE "eventuality_medical_reports" DROP CONSTRAINT "FK_ac6c6a3a5281c54676770a5ab57"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_emr_eventuality_id"`);
    await queryRunner.query(`DROP TABLE "eventuality_medical_reports"`);
  }
}
