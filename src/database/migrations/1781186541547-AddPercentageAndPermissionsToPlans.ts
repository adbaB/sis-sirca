import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPercentageAndPermissionsToPlans1781186541547 implements MigrationInterface {
  name = 'AddPercentageAndPermissionsToPlans1781186541547';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add percentage and status columns to plans
    await queryRunner.query(
      `ALTER TABLE "plans" ADD "percentage" numeric(5,2) NOT NULL DEFAULT 0.00`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD "status" character varying(20) NOT NULL DEFAULT 'ACTIVE' CONSTRAINT "CK_plans_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE'))`,
    );

    // 2. Seed RBAC permissions
    const permissions = ['create:plans', 'read:plans', 'update:plans', 'delete:plans'];

    for (const name of permissions) {
      await queryRunner.query(
        `INSERT INTO "permissions" ("name", "description") 
         SELECT CAST($1 AS varchar), CAST($2 AS varchar)
         WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "name" = CAST($1 AS varchar))`,
        [name, `Permiso para ${name.replace(':', ' ')}`],
      );

      await queryRunner.query(
        `INSERT INTO "role_permissions" ("role_id", "permission_id")
         SELECT r.id, p.id 
         FROM "roles" r, "permissions" p 
         WHERE r.name = 'admin' AND p.name = CAST($1 AS varchar)
         AND NOT EXISTS (
           SELECT 1 FROM "role_permissions" rp 
           WHERE rp.role_id = r.id AND rp.permission_id = p.id
         )`,
        [name],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const permissions = ['create:plans', 'read:plans', 'update:plans', 'delete:plans'];

    for (const name of permissions) {
      const description = `Permiso para ${name.replace(':', ' ')}`;
      await queryRunner.query(
        `DELETE FROM "role_permissions" 
         WHERE permission_id = (
           SELECT id FROM "permissions" 
           WHERE name = CAST($1 AS varchar) AND description = CAST($2 AS varchar)
         )`,
        [name, description],
      );
      await queryRunner.query(
        `DELETE FROM "permissions" 
         WHERE name = CAST($1 AS varchar) AND description = CAST($2 AS varchar)`,
        [name, description],
      );
    }

    await queryRunner.query(`ALTER TABLE "plans" DROP COLUMN "status"`);
    await queryRunner.query(`ALTER TABLE "plans" DROP COLUMN "percentage"`);
  }
}
