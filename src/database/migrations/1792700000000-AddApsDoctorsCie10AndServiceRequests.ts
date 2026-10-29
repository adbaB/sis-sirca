import { MigrationInterface, QueryRunner } from 'typeorm';
import * as cie10Data from '../../cie10/data/cie10-es.json';

export class AddApsDoctorsCie10AndServiceRequests1792700000000 implements MigrationInterface {
  name = 'AddApsDoctorsCie10AndServiceRequests1792700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Tabla de Médicos (doctors)
    await queryRunner.query(`
      CREATE TABLE "doctors" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "first_name" character varying(100) NOT NULL,
        "last_name" character varying(100) NOT NULL,
        "type_identity_card" character varying(10) NOT NULL DEFAULT 'V',
        "identity_card" character varying(30) NOT NULL,
        "graduation_date" date,
        "specialty" character varying(150) NOT NULL,
        "mpps" character varying(50) NOT NULL,
        "comezu" character varying(50),
        "phone" character varying(50),
        "email" character varying(150),
        "digital_signature_url" text,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_doctors_identity_card" UNIQUE ("identity_card"),
        CONSTRAINT "PK_doctors_id" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_doctors_identity_card" ON "doctors" ("identity_card");`,
    );

    // 2. Columna doctor_id en users
    await queryRunner.query(`ALTER TABLE "users" ADD "doctor_id" uuid;`);
    await queryRunner.query(`CREATE INDEX "IDX_users_doctor_id" ON "users" ("doctor_id");`);
    await queryRunner.query(`
      ALTER TABLE "users" ADD CONSTRAINT "FK_users_doctor"
      FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
    `);

    // 3. Columna doctor_id en eventualities
    await queryRunner.query(`ALTER TABLE "eventualities" ADD "doctor_id" uuid;`);
    await queryRunner.query(
      `CREATE INDEX "IDX_eventualities_doctor_id" ON "eventualities" ("doctor_id");`,
    );
    await queryRunner.query(`
      ALTER TABLE "eventualities" ADD CONSTRAINT "FK_eventualities_doctor"
      FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
    `);

    // 4. Tabla de Códigos CIE-10 (cie10_codes)
    await queryRunner.query(`
      CREATE TABLE "cie10_codes" (
        "code" character varying(15) NOT NULL,
        "description" text NOT NULL,
        "chapter" character varying(255),
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cie10_codes_code" PRIMARY KEY ("code")
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_cie10_codes_description" ON "cie10_codes" ("description");`,
    );

    // 5. Poblar catálogo CIE-10 precargado en español
    const rawList: Array<{ code: string; description: string; chapter: string }> =
      (cie10Data as any).default || cie10Data;

    for (const item of rawList) {
      const codeEscaped = item.code.trim().toUpperCase().replace(/'/g, "''");
      const descEscaped = item.description.trim().replace(/'/g, "''");
      const chapEscaped = item.chapter ? item.chapter.trim().replace(/'/g, "''") : '';
      await queryRunner.query(`
        INSERT INTO "cie10_codes" ("code", "description", "chapter", "is_active")
        VALUES ('${codeEscaped}', '${descEscaped}', '${chapEscaped}', true)
        ON CONFLICT ("code") DO NOTHING;
      `);
    }

    // 6. Columnas de diagnóstico CIE-10 y consulta clínica en eventuality_medical_reports
    await queryRunner.query(
      `ALTER TABLE "eventuality_medical_reports" ADD "primary_cie10_code" character varying(15);`,
    );
    await queryRunner.query(
      `ALTER TABLE "eventuality_medical_reports" ADD "secondary_cie10_codes" jsonb DEFAULT '[]';`,
    );
    await queryRunner.query(
      `ALTER TABLE "eventuality_medical_reports" ADD "reason_for_consultation" text;`,
    );
    await queryRunner.query(
      `ALTER TABLE "eventuality_medical_reports" ADD "current_illness" text;`,
    );
    await queryRunner.query(`ALTER TABLE "eventuality_medical_reports" ADD "physical_exam" text;`);
    await queryRunner.query(
      `ALTER TABLE "eventuality_medical_reports" ADD "general_treatment_notes" text;`,
    );
    await queryRunner.query(`ALTER TABLE "eventuality_medical_reports" ADD "doctor_id" uuid;`);
    await queryRunner.query(
      `ALTER TABLE "eventuality_medical_reports" ADD "signed_at" TIMESTAMP WITH TIME ZONE;`,
    );

    await queryRunner.query(`
      ALTER TABLE "eventuality_medical_reports" ADD CONSTRAINT "FK_emr_primary_cie10"
      FOREIGN KEY ("primary_cie10_code") REFERENCES "cie10_codes"("code") ON DELETE SET NULL ON UPDATE CASCADE;
    `);
    await queryRunner.query(`
      ALTER TABLE "eventuality_medical_reports" ADD CONSTRAINT "FK_emr_doctor"
      FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
    `);

    // 7. Tabla de Ítems de Tratamiento / Récipe Médico (eventuality_treatment_items)
    await queryRunner.query(`
      CREATE TABLE "eventuality_treatment_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "eventuality_id" uuid NOT NULL,
        "medication_name" character varying(255) NOT NULL,
        "presentation" character varying(100),
        "dosage" character varying(150) NOT NULL,
        "frequency" character varying(150) NOT NULL,
        "duration" character varying(150) NOT NULL,
        "administration_route" character varying(100),
        "instructions" text,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_treatment_items_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_treatment_items_eventuality" FOREIGN KEY ("eventuality_id") REFERENCES "eventualities"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_treatment_items_eventuality_id" ON "eventuality_treatment_items" ("eventuality_id");`,
    );

    // 8. Tabla de Solicitudes de Servicios (eventuality_service_requests)
    await queryRunner.query(`
      CREATE TABLE "eventuality_service_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "eventuality_id" uuid NOT NULL,
        "person_id" uuid NOT NULL,
        "contract_person_id" uuid NOT NULL,
        "doctor_id" uuid,
        "request_type" character varying(30) NOT NULL,
        "status" character varying(30) NOT NULL DEFAULT 'PENDING',
        "medical_service_id" uuid,
        "service_name" character varying(255) NOT NULL,
        "specialty" character varying(150),
        "clinical_justification" text,
        "priority" character varying(20) NOT NULL DEFAULT 'NORMAL',
        "child_eventuality_id" uuid,
        "converted_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_service_requests_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_service_requests_eventuality" FOREIGN KEY ("eventuality_id") REFERENCES "eventualities"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_service_requests_person" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_service_requests_contract_person" FOREIGN KEY ("contract_person_id") REFERENCES "contract_persons"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_service_requests_doctor" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_service_requests_medical_service" FOREIGN KEY ("medical_service_id") REFERENCES "medical_services"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_service_requests_child_eventuality" FOREIGN KEY ("child_eventuality_id") REFERENCES "eventualities"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_service_requests_eventuality_id" ON "eventuality_service_requests" ("eventuality_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_service_requests_person_id" ON "eventuality_service_requests" ("person_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_service_requests_contract_person_id" ON "eventuality_service_requests" ("contract_person_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_service_requests_status" ON "eventuality_service_requests" ("status");`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_service_requests_type" ON "eventuality_service_requests" ("request_type");`,
    );

    // 9. Permisos en base de datos para Médicos y APS
    await queryRunner.query(`
      INSERT INTO "permissions" ("name", "description")
      VALUES 
        ('attend:aps', 'Atender consultas APS y acceder al Dashboard Médico'),
        ('manage:doctors', 'Crear y administrar perfiles de médicos')
      ON CONFLICT ("name") DO NOTHING;
    `);

    // Asignar permisos al rol admin
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r.id, p.id
      FROM "roles" r, "permissions" p
      WHERE r.name = 'admin' AND p.name IN ('attend:aps', 'manage:doctors')
      ON CONFLICT DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "eventuality_service_requests";`);
    await queryRunner.query(`DROP TABLE "eventuality_treatment_items";`);
    await queryRunner.query(
      `ALTER TABLE "eventuality_medical_reports" DROP CONSTRAINT "FK_emr_doctor";`,
    );
    await queryRunner.query(
      `ALTER TABLE "eventuality_medical_reports" DROP CONSTRAINT "FK_emr_primary_cie10";`,
    );
    await queryRunner.query(`ALTER TABLE "eventuality_medical_reports" DROP COLUMN "signed_at";`);
    await queryRunner.query(`ALTER TABLE "eventuality_medical_reports" DROP COLUMN "doctor_id";`);
    await queryRunner.query(
      `ALTER TABLE "eventuality_medical_reports" DROP COLUMN "general_treatment_notes";`,
    );
    await queryRunner.query(
      `ALTER TABLE "eventuality_medical_reports" DROP COLUMN "physical_exam";`,
    );
    await queryRunner.query(
      `ALTER TABLE "eventuality_medical_reports" DROP COLUMN "current_illness";`,
    );
    await queryRunner.query(
      `ALTER TABLE "eventuality_medical_reports" DROP COLUMN "reason_for_consultation";`,
    );
    await queryRunner.query(
      `ALTER TABLE "eventuality_medical_reports" DROP COLUMN "secondary_cie10_codes";`,
    );
    await queryRunner.query(
      `ALTER TABLE "eventuality_medical_reports" DROP COLUMN "primary_cie10_code";`,
    );
    await queryRunner.query(`DROP TABLE "cie10_codes";`);
    await queryRunner.query(
      `ALTER TABLE "eventualities" DROP CONSTRAINT "FK_eventualities_doctor";`,
    );
    await queryRunner.query(`ALTER TABLE "eventualities" DROP COLUMN "doctor_id";`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_users_doctor";`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "doctor_id";`);
    await queryRunner.query(`DROP TABLE "doctors";`);
  }
}
