import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEmergencyEventualitiesTables1791825184031 implements MigrationInterface {
  name = 'CreateEmergencyEventualitiesTables1791825184031';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Tabla contract_coverage_periods (Control contable anual de saldos y vigencias)
    await queryRunner.query(`
      CREATE TABLE "contract_coverage_periods" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "contract_id" uuid NOT NULL,
        "contract_person_id" uuid NOT NULL,
        "period_number" integer NOT NULL DEFAULT 1,
        "start_date" date NOT NULL,
        "expiration_date" date NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'ACTIVE',
        "initial_coverage" numeric(10,2) NOT NULL DEFAULT 0,
        "consumed_coverage" numeric(10,2) NOT NULL DEFAULT 0,
        "reserved_coverage" numeric(10,2) NOT NULL DEFAULT 0,
        "remaining_coverage" numeric(10,2) NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "CHK_ccp_status" CHECK ("status" IN ('ACTIVE', 'CLOSED')),
        CONSTRAINT "CHK_ccp_initial_coverage" CHECK ("initial_coverage" >= 0),
        CONSTRAINT "CHK_ccp_consumed_coverage" CHECK ("consumed_coverage" >= 0),
        CONSTRAINT "CHK_ccp_reserved_coverage" CHECK ("reserved_coverage" >= 0),
        CONSTRAINT "CHK_ccp_remaining_coverage" CHECK ("remaining_coverage" >= 0),
        CONSTRAINT "CHK_ccp_dates" CHECK ("expiration_date" >= "start_date"),
        CONSTRAINT "PK_contract_coverage_periods" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_ccp_contract_id" ON "contract_coverage_periods" ("contract_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ccp_contract_person_id" ON "contract_coverage_periods" ("contract_person_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ccp_status_dates" ON "contract_coverage_periods" ("status", "start_date", "expiration_date")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_ccp_active_person_period" ON "contract_coverage_periods" ("contract_person_id") WHERE "status" = 'ACTIVE' AND "deleted_at" IS NULL`,
    );

    await queryRunner.query(`
      ALTER TABLE "contract_coverage_periods"
      ADD CONSTRAINT "FK_ccp_contract" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "contract_coverage_periods"
      ADD CONSTRAINT "FK_ccp_contract_person" FOREIGN KEY ("contract_person_id") REFERENCES "contract_persons"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    // 2. Tabla eventualities
    await queryRunner.query(`
      CREATE TABLE "eventualities" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "claim_number" character varying(50),
        "type" character varying(30) NOT NULL,
        "status" character varying(30) NOT NULL,
        "person_id" uuid NOT NULL,
        "contract_person_id" uuid NOT NULL,
        "coverage_period_id" uuid NOT NULL,
        "parent_eventuality_id" uuid,
        "clinic_name" text,
        "admission_date" TIMESTAMP WITH TIME ZONE,
        "discharge_date" TIMESTAMP WITH TIME ZONE,
        "medical_report_url" text,
        "medical_report_notes" text,
        "consumption_pdf_url" text,
        "applied_factor" numeric(5,2) NOT NULL DEFAULT 2,
        "total_cost" numeric(10,2) NOT NULL DEFAULT 0,
        "total_coverage_deducted" numeric(10,2) NOT NULL DEFAULT 0,
        "reserved_coverage_amount" numeric(10,2) NOT NULL DEFAULT 0,
        "notes" text,
        "closed_at" TIMESTAMP WITH TIME ZONE,
        "requires_approval" boolean NOT NULL DEFAULT false,
        "approved_at" TIMESTAMP WITH TIME ZONE,
        "approved_by" character varying(255),
        "rejection_reason" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "CHK_eventualities_type" CHECK ("type" IN ('EMERGENCY', 'HOSPITALIZATION', 'APS', 'CONSULTATION', 'STUDY')),
        CONSTRAINT "CHK_eventualities_status" CHECK ("status" IN ('PENDING_APPROVAL', 'CLINIC_PROCESS', 'DOCTOR_QUEUE', 'SCHEDULED', 'WAITING_INVOICE', 'UNDER_ADMIN_REVIEW', 'CLOSED', 'CANCELLED', 'REJECTED')),
        CONSTRAINT "CHK_eventualities_total_cost" CHECK ("total_cost" >= 0),
        CONSTRAINT "CHK_eventualities_total_coverage" CHECK ("total_coverage_deducted" >= 0),
        CONSTRAINT "CHK_eventualities_reserved_coverage" CHECK ("reserved_coverage_amount" >= 0),
        CONSTRAINT "PK_eventualities" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_eventualities_claim_number" ON "eventualities" ("claim_number") WHERE "claim_number" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eventualities_person_id" ON "eventualities" ("person_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eventualities_contract_person_id" ON "eventualities" ("contract_person_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eventualities_coverage_period_id" ON "eventualities" ("coverage_period_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eventualities_parent_id" ON "eventualities" ("parent_eventuality_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eventualities_type_status" ON "eventualities" ("type", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eventualities_created_at" ON "eventualities" ("created_at")`,
    );

    await queryRunner.query(`
      ALTER TABLE "eventualities"
      ADD CONSTRAINT "FK_eventualities_person" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "eventualities"
      ADD CONSTRAINT "FK_eventualities_contract_person" FOREIGN KEY ("contract_person_id") REFERENCES "contract_persons"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "eventualities"
      ADD CONSTRAINT "FK_eventualities_coverage_period" FOREIGN KEY ("coverage_period_id") REFERENCES "contract_coverage_periods"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "eventualities"
      ADD CONSTRAINT "FK_eventualities_parent" FOREIGN KEY ("parent_eventuality_id") REFERENCES "eventualities"("id") ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    // 3. Tabla eventuality_extraction_details (Insumos extraídos por IA)
    await queryRunner.query(`
      CREATE TABLE "eventuality_extraction_details" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "eventuality_id" uuid NOT NULL,
        "category" character varying(30) NOT NULL,
        "item_name" text NOT NULL,
        "quantity" numeric(10,3) NOT NULL DEFAULT 1,
        "unit_cost" numeric(10,2) NOT NULL DEFAULT 0,
        "total_cost" numeric(10,2) NOT NULL DEFAULT 0,
        "calculated_sale_price" numeric(10,2) NOT NULL DEFAULT 0,
        "status" character varying(20) NOT NULL DEFAULT 'EXTRACTED',
        "raw_line_text" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_eed_category" CHECK ("category" IN ('MEDICAMENTO', 'MATERIAL', 'SERVICIO')),
        CONSTRAINT "CHK_eed_status" CHECK ("status" IN ('EXTRACTED', 'EDITED', 'ADDED', 'REMOVED')),
        CONSTRAINT "CHK_eed_quantity" CHECK ("quantity" > 0),
        CONSTRAINT "CHK_eed_unit_cost" CHECK ("unit_cost" >= 0),
        CONSTRAINT "CHK_eed_total_cost" CHECK ("total_cost" >= 0),
        CONSTRAINT "CHK_eed_sale_price" CHECK ("calculated_sale_price" >= 0),
        CONSTRAINT "PK_eventuality_extraction_details" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_eed_eventuality_id" ON "eventuality_extraction_details" ("eventuality_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eed_category" ON "eventuality_extraction_details" ("category")`,
    );

    await queryRunner.query(`
      ALTER TABLE "eventuality_extraction_details"
      ADD CONSTRAINT "FK_eed_eventuality" FOREIGN KEY ("eventuality_id") REFERENCES "eventualities"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    // 4. Tabla eventuality_movements (Libro Mayor Contable / Débitos a cobertura)
    await queryRunner.query(`
      CREATE TABLE "eventuality_movements" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "eventuality_id" uuid NOT NULL,
        "coverage_period_id" uuid NOT NULL,
        "category" character varying(30) NOT NULL,
        "description" text NOT NULL,
        "cost_amount" numeric(10,2) NOT NULL DEFAULT 0,
        "coverage_deducted_amount" numeric(10,2) NOT NULL DEFAULT 0,
        "consumes_limit" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_em_category" CHECK ("category" IN ('MEDICAMENTO', 'MATERIAL', 'SERVICIO', 'HONORARIOS', 'FACTURA_GLOBAL', 'OTRO')),
        CONSTRAINT "CHK_em_cost_amount" CHECK ("cost_amount" >= 0),
        CONSTRAINT "CHK_em_coverage_amount" CHECK ("coverage_deducted_amount" >= 0),
        CONSTRAINT "PK_eventuality_movements" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_em_eventuality_id" ON "eventuality_movements" ("eventuality_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_em_coverage_period_id" ON "eventuality_movements" ("coverage_period_id")`,
    );

    await queryRunner.query(`
      ALTER TABLE "eventuality_movements"
      ADD CONSTRAINT "FK_em_eventuality" FOREIGN KEY ("eventuality_id") REFERENCES "eventualities"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "eventuality_movements"
      ADD CONSTRAINT "FK_em_coverage_period" FOREIGN KEY ("coverage_period_id") REFERENCES "contract_coverage_periods"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
    `);

    // 5. Tabla eventuality_provider_invoices (Facturas fiscales de clínicas y proveedores)
    await queryRunner.query(`
      CREATE TABLE "eventuality_provider_invoices" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "eventuality_id" uuid NOT NULL,
        "provider_name" text NOT NULL,
        "provider_rif" character varying(50),
        "invoice_number" character varying(100) NOT NULL,
        "control_number" character varying(100),
        "invoice_date" date NOT NULL,
        "invoice_pdf_url" text,
        "subtotal_amount" numeric(10,2) NOT NULL DEFAULT 0,
        "tax_amount" numeric(10,2) NOT NULL DEFAULT 0,
        "total_amount" numeric(10,2) NOT NULL DEFAULT 0,
        "notes" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "CHK_epi_subtotal" CHECK ("subtotal_amount" >= 0),
        CONSTRAINT "CHK_epi_tax" CHECK ("tax_amount" >= 0),
        CONSTRAINT "CHK_epi_total" CHECK ("total_amount" >= 0),
        CONSTRAINT "PK_eventuality_provider_invoices" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_epi_eventuality_id" ON "eventuality_provider_invoices" ("eventuality_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_epi_invoice_number" ON "eventuality_provider_invoices" ("invoice_number")`,
    );

    await queryRunner.query(`
      ALTER TABLE "eventuality_provider_invoices"
      ADD CONSTRAINT "FK_epi_eventuality" FOREIGN KEY ("eventuality_id") REFERENCES "eventualities"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    // 6. Contador en system_counters para claim_number
    await queryRunner.query(`
      INSERT INTO "system_counters" ("key", "value")
      VALUES ('claim_number', 1)
      ON CONFLICT ("key") DO NOTHING
    `);

    // 7. Sembrado de permisos RBAC para Emergencias
    const permissions = [
      { name: 'create:eventualities', description: 'Permiso para crear eventualidades' },
      { name: 'read:eventualities', description: 'Permiso para consultar eventualidades' },
      { name: 'update:eventualities', description: 'Permiso para actualizar eventualidades' },
      {
        name: 'manage:eventualities',
        description: 'Permiso integral de gestión de eventualidades',
      },
      {
        name: 'manage:eventuality-invoices',
        description: 'Permiso para registrar y liquidar facturas de eventualidades',
      },
      {
        name: 'review:eventuality-consumption',
        description: 'Permiso para auditar y editar insumos extraídos por IA',
      },
      {
        name: 'approve:eventualities',
        description: 'Permiso para aprobar siniestros con exceso de consumo',
      },
      {
        name: 'reject:eventualities',
        description: 'Permiso para rechazar siniestros con exceso de consumo',
      },
      {
        name: 'configure:eventualities',
        description: 'Permiso para configurar alertas y parámetros de siniestros',
      },
    ];

    for (const perm of permissions) {
      await queryRunner.query(
        `INSERT INTO "permissions" ("name", "description") VALUES ($1, $2)
         ON CONFLICT ("name") DO NOTHING`,
        [perm.name, perm.description],
      );
      await queryRunner.query(
        `INSERT INTO "role_permissions" ("role_id", "permission_id")
         SELECT r.id, p.id FROM "roles" r, "permissions" p
         WHERE r.name = 'admin' AND p.name = $1
         ON CONFLICT DO NOTHING`,
        [perm.name],
      );
    }

    // 8. Configuraciones por defecto para alertas de consumo
    await queryRunner.query(`
      INSERT INTO "system_settings" ("key", "value", "description")
      VALUES
        ('EVENTUALITY_ALERT_THRESHOLD', '80', 'Porcentaje de cobertura consumida para requerir aprobación previa'),
        ('EVENTUALITY_ALERT_PHONES', '', 'Lista de teléfonos separados por coma para notificaciones WhatsApp de siniestros'),
        ('EVENTUALITY_ALERT_ENABLED', 'true', 'Habilita o deshabilita la alerta de aprobación por consumo de siniestros')
      ON CONFLICT ("key") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "eventuality_provider_invoices"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "eventuality_movements"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "eventuality_extraction_details"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "eventualities"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "contract_coverage_periods"`);

    const permissionNames = [
      'create:eventualities',
      'read:eventualities',
      'update:eventualities',
      'manage:eventualities',
      'manage:eventuality-invoices',
      'review:eventuality-consumption',
      'approve:eventualities',
      'reject:eventualities',
      'configure:eventualities',
    ];

    for (const name of permissionNames) {
      await queryRunner.query(
        `DELETE FROM "role_permissions" WHERE "permission_id" IN (SELECT "id" FROM "permissions" WHERE "name" = $1)`,
        [name],
      );
      await queryRunner.query(`DELETE FROM "permissions" WHERE "name" = $1`, [name]);
    }

    await queryRunner.query(`
      DELETE FROM "system_settings"
      WHERE "key" IN ('EVENTUALITY_ALERT_THRESHOLD', 'EVENTUALITY_ALERT_PHONES', 'EVENTUALITY_ALERT_ENABLED')
    `);
  }
}
