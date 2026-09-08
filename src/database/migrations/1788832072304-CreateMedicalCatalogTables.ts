import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMedicalCatalogTables1788832072304 implements MigrationInterface {
  name = 'CreateMedicalCatalogTables1788832072304';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_contracts_status_reactivation_eligible_at"`);
    await queryRunner.query(
      `CREATE TABLE "service_categories" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying(50) NOT NULL, "name" character varying(255) NOT NULL, "description" text, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_fe4da5476c4ffe5aa2d3524ae68" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_service_categories_code_active" ON "service_categories" ("code") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "plan_services" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "plan_id" uuid NOT NULL, "medical_service_id" uuid NOT NULL, "limit_type" character varying(20) NOT NULL DEFAULT 'UNLIMITED', "limit_quantity" integer, "waiting_period_days" integer NOT NULL DEFAULT '0', "copay_amount" numeric(10,2) NOT NULL DEFAULT '0', "copay_percentage" numeric(5,2) NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "CHK_plan_services_copay_percentage" CHECK ("copay_percentage" >= 0 AND "copay_percentage" <= 100), CONSTRAINT "CHK_plan_services_copay_amount" CHECK ("copay_amount" >= 0), CONSTRAINT "CHK_plan_services_waiting_period" CHECK ("waiting_period_days" >= 0), CONSTRAINT "CHK_plan_services_limit_rule" CHECK (("limit_type" = 'UNLIMITED' AND "limit_quantity" IS NULL) OR ("limit_type" IN ('MONTHLY', 'ANNUAL') AND "limit_quantity" IS NOT NULL AND "limit_quantity" >= 1)), CONSTRAINT "CHK_plan_services_limit_type" CHECK ("limit_type" IN ('UNLIMITED', 'MONTHLY', 'ANNUAL')), CONSTRAINT "PK_215e05e5117021cdc348fcf07f0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_plan_services_medical_service_id" ON "plan_services" ("medical_service_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_plan_services_plan_id" ON "plan_services" ("plan_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_plan_services_plan_medical_service_active" ON "plan_services" ("plan_id", "medical_service_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "medical_services" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying(50) NOT NULL, "name" character varying(255) NOT NULL, "description" text, "category_id" uuid NOT NULL, "linked_health_categories" text array NOT NULL DEFAULT '{}', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_dc375d271f4c13a5a36bdd83c70" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_medical_services_category_id" ON "medical_services" ("category_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_medical_services_code_active" ON "medical_services" ("code") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."contract_person_exclusions_source_enum" AS ENUM('AUTOMATIC', 'MANUAL')`,
    );
    await queryRunner.query(
      `CREATE TABLE "contract_person_exclusions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "contract_person_id" uuid NOT NULL, "medical_service_id" uuid, "service_category_id" uuid, "reason" text NOT NULL, "source" "public"."contract_person_exclusions_source_enum" NOT NULL DEFAULT 'AUTOMATIC', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "CHK_cpe_target" CHECK ("medical_service_id" IS NOT NULL OR "service_category_id" IS NOT NULL), CONSTRAINT "PK_592e4346af9ebd48048848d9893" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_cpe_person_service_category_active" ON "contract_person_exclusions" ("contract_person_id", "service_category_id") WHERE "deleted_at" IS NULL AND "medical_service_id" IS NULL AND "service_category_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_cpe_person_medical_service_active" ON "contract_person_exclusions" ("contract_person_id", "medical_service_id") WHERE "deleted_at" IS NULL AND "medical_service_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cpe_source" ON "contract_person_exclusions" ("source") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cpe_service_category_id" ON "contract_person_exclusions" ("service_category_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cpe_medical_service_id" ON "contract_person_exclusions" ("medical_service_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cpe_contract_person_id" ON "contract_person_exclusions" ("contract_person_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "plan_services" ADD CONSTRAINT "FK_8a47c700b2580c49e35511c9360" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "plan_services" ADD CONSTRAINT "FK_01ae1de3a329eb050c19032aad3" FOREIGN KEY ("medical_service_id") REFERENCES "medical_services"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "medical_services" ADD CONSTRAINT "FK_ffe3333e35534c7dbc44450772d" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "contract_person_exclusions" ADD CONSTRAINT "FK_8aa78555b80f79117035473dbf3" FOREIGN KEY ("contract_person_id") REFERENCES "contract_persons"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "contract_person_exclusions" ADD CONSTRAINT "FK_484ff9400e6abab04ed5117a745" FOREIGN KEY ("medical_service_id") REFERENCES "medical_services"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "contract_person_exclusions" ADD CONSTRAINT "FK_29a19095a96f2f816d26b8f7046" FOREIGN KEY ("service_category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    const permissions = [
      {
        name: 'create:service-categories',
        description: 'Permiso para crear categorías de servicios médicos',
      },
      {
        name: 'read:service-categories',
        description: 'Permiso para consultar categorías de servicios médicos',
      },
      {
        name: 'update:service-categories',
        description: 'Permiso para actualizar categorías de servicios médicos',
      },
      {
        name: 'delete:service-categories',
        description: 'Permiso para eliminar categorías de servicios médicos',
      },
      { name: 'create:medical-services', description: 'Permiso para crear servicios médicos' },
      { name: 'read:medical-services', description: 'Permiso para consultar servicios médicos' },
      { name: 'update:medical-services', description: 'Permiso para actualizar servicios médicos' },
      { name: 'delete:medical-services', description: 'Permiso para eliminar servicios médicos' },
      { name: 'create:plan-services', description: 'Permiso para configurar servicios en planes' },
      { name: 'read:plan-services', description: 'Permiso para consultar servicios de planes' },
      { name: 'update:plan-services', description: 'Permiso para modificar servicios de planes' },
      { name: 'delete:plan-services', description: 'Permiso para eliminar servicios de planes' },
      {
        name: 'create:contract-exclusions',
        description: 'Permiso para crear exclusiones médicas de contrato',
      },
      {
        name: 'read:contract-exclusions',
        description: 'Permiso para consultar exclusiones médicas de contrato',
      },
      {
        name: 'update:contract-exclusions',
        description: 'Permiso para modificar exclusiones médicas de contrato',
      },
      {
        name: 'delete:contract-exclusions',
        description: 'Permiso para eliminar exclusiones médicas de contrato',
      },
    ];

    for (const perm of permissions) {
      await queryRunner.query(
        `INSERT INTO "permissions" ("name", "description") VALUES ($1, $2) ON CONFLICT ("name") DO NOTHING`,
        [perm.name, perm.description],
      );
      await queryRunner.query(
        `INSERT INTO "role_permissions" ("role_id", "permission_id")
                 SELECT r.id, p.id FROM "roles" r, "permissions" p
                 WHERE r.name = 'admin' AND p.name = $1 ON CONFLICT DO NOTHING`,
        [perm.name],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const permissions = [
      'create:service-categories',
      'read:service-categories',
      'update:service-categories',
      'delete:service-categories',
      'create:medical-services',
      'read:medical-services',
      'update:medical-services',
      'delete:medical-services',
      'create:plan-services',
      'read:plan-services',
      'update:plan-services',
      'delete:plan-services',
      'create:contract-exclusions',
      'read:contract-exclusions',
      'update:contract-exclusions',
      'delete:contract-exclusions',
    ];

    for (const name of permissions) {
      await queryRunner.query(
        `DELETE FROM "role_permissions" WHERE permission_id = (SELECT id FROM "permissions" WHERE name = $1)`,
        [name],
      );
      await queryRunner.query(`DELETE FROM "permissions" WHERE name = $1`, [name]);
    }

    await queryRunner.query(
      `ALTER TABLE "contract_person_exclusions" DROP CONSTRAINT "FK_29a19095a96f2f816d26b8f7046"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contract_person_exclusions" DROP CONSTRAINT "FK_484ff9400e6abab04ed5117a745"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contract_person_exclusions" DROP CONSTRAINT "FK_8aa78555b80f79117035473dbf3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "medical_services" DROP CONSTRAINT "FK_ffe3333e35534c7dbc44450772d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "plan_services" DROP CONSTRAINT "FK_01ae1de3a329eb050c19032aad3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "plan_services" DROP CONSTRAINT "FK_8a47c700b2580c49e35511c9360"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_cpe_contract_person_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cpe_medical_service_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cpe_service_category_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cpe_source"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_cpe_person_medical_service_active"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_cpe_person_service_category_active"`);
    await queryRunner.query(`DROP TABLE "contract_person_exclusions"`);
    await queryRunner.query(`DROP TYPE "public"."contract_person_exclusions_source_enum"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_medical_services_code_active"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_medical_services_category_id"`);
    await queryRunner.query(`DROP TABLE "medical_services"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_plan_services_plan_medical_service_active"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_plan_services_plan_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_plan_services_medical_service_id"`);
    await queryRunner.query(`DROP TABLE "plan_services"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_service_categories_code_active"`);
    await queryRunner.query(`DROP TABLE "service_categories"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_contracts_status_reactivation_eligible_at" ON "contracts" ("reactivation_eligible_at", "status") WHERE (status = 'SUSPENDED'::contracts_status_enum)`,
    );
  }
}
