import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPricingAndSystemSettings1789747540990 implements MigrationInterface {
  name = 'AddPricingAndSystemSettings1789747540990';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Crear tabla system_settings
    await queryRunner.query(
      `CREATE TABLE "system_settings" (
        "key" character varying(100) NOT NULL,
        "value" text NOT NULL,
        "description" text,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_system_settings_key" PRIMARY KEY ("key")
      )`,
    );

    // 2. Sembrar factor de precio por defecto (2.00)
    await queryRunner.query(
      `INSERT INTO "system_settings" ("key", "value", "description")
       VALUES ('DEFAULT_SERVICE_PRICE_FACTOR', '2.00', 'Factor multiplicador global por defecto para calcular el precio de venta de servicios a partir del costo')
       ON CONFLICT ("key") DO NOTHING`,
    );

    // 3. Crear y asignar permisos de configuraciones al rol admin
    const permissions = [
      {
        name: 'read:system-settings',
        description: 'Permiso para consultar configuraciones del sistema',
      },
      {
        name: 'manage:system-settings',
        description: 'Permiso para gestionar configuraciones del sistema',
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
         WHERE r.name = 'admin' AND p.name = $1 ON CONFLICT DO NOTHING`,
        [perm.name],
      );
    }

    // 4. Agregar costo y precio de venta a medical_services
    await queryRunner.query(
      `ALTER TABLE "medical_services" ADD "cost" numeric(10,2) NOT NULL DEFAULT '0.00'`,
    );
    await queryRunner.query(`ALTER TABLE "medical_services" ADD "sale_price" numeric(10,2)`);
    await queryRunner.query(
      `ALTER TABLE "medical_services" ADD CONSTRAINT "CHK_medical_services_cost" CHECK ("cost" >= 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE "medical_services" ADD CONSTRAINT "CHK_medical_services_sale_price" CHECK ("sale_price" IS NULL OR "sale_price" >= 0)`,
    );

    // 5. Agregar factor de ganancia a plans
    await queryRunner.query(`ALTER TABLE "plans" ADD "profit_factor" numeric(5,2)`);
    await queryRunner.query(
      `ALTER TABLE "plans" ADD CONSTRAINT "CHK_plans_profit_factor" CHECK ("profit_factor" IS NULL OR "profit_factor" > 0)`,
    );

    // 6. Agregar costo y precio de venta a plan_services
    await queryRunner.query(`ALTER TABLE "plan_services" ADD "cost" numeric(10,2)`);
    await queryRunner.query(`ALTER TABLE "plan_services" ADD "sale_price" numeric(10,2)`);
    await queryRunner.query(
      `ALTER TABLE "plan_services" ADD CONSTRAINT "CHK_plan_services_cost" CHECK ("cost" IS NULL OR "cost" >= 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE "plan_services" ADD CONSTRAINT "CHK_plan_services_sale_price" CHECK ("sale_price" IS NULL OR "sale_price" >= 0)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 6. Revertir plan_services
    await queryRunner.query(
      `ALTER TABLE "plan_services" DROP CONSTRAINT "CHK_plan_services_sale_price"`,
    );
    await queryRunner.query(`ALTER TABLE "plan_services" DROP CONSTRAINT "CHK_plan_services_cost"`);
    await queryRunner.query(`ALTER TABLE "plan_services" DROP COLUMN "sale_price"`);
    await queryRunner.query(`ALTER TABLE "plan_services" DROP COLUMN "cost"`);

    // 5. Revertir plans
    await queryRunner.query(`ALTER TABLE "plans" DROP CONSTRAINT "CHK_plans_profit_factor"`);
    await queryRunner.query(`ALTER TABLE "plans" DROP COLUMN "profit_factor"`);

    // 4. Revertir medical_services
    await queryRunner.query(
      `ALTER TABLE "medical_services" DROP CONSTRAINT "CHK_medical_services_sale_price"`,
    );
    await queryRunner.query(
      `ALTER TABLE "medical_services" DROP CONSTRAINT "CHK_medical_services_cost"`,
    );
    await queryRunner.query(`ALTER TABLE "medical_services" DROP COLUMN "sale_price"`);
    await queryRunner.query(`ALTER TABLE "medical_services" DROP COLUMN "cost"`);

    // 3. Revertir permisos
    const permissions = ['manage:system-settings', 'read:system-settings'];
    for (const name of permissions) {
      await queryRunner.query(
        `DELETE FROM "role_permissions"
         WHERE role_id = (SELECT id FROM "roles" WHERE name = 'admin')
           AND permission_id = (SELECT id FROM "permissions" WHERE name = $1)`,
        [name],
      );
      await queryRunner.query(
        `DELETE FROM "permissions"
         WHERE name = $1
           AND NOT EXISTS (
             SELECT 1 FROM "role_permissions" rp WHERE rp.permission_id = "permissions".id
           )`,
        [name],
      );
    }

    // 1. Revertir system_settings
    await queryRunner.query(`DROP TABLE "system_settings"`);
  }
}
