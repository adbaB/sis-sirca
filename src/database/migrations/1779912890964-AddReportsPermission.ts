import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReportsPermission1779912890964 implements MigrationInterface {
  name = 'AddReportsPermission1779912890964';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Insert new permission for reports
    await queryRunner.query(
      `INSERT INTO "permissions" ("name", "description") VALUES ('read:reports', 'Permiso para ver y descargar reportes de contratos')`,
    );

    // Assign the new permission to admin role automatically
    await queryRunner.query(
      `INSERT INTO "role_permissions" ("role_id", "permission_id")
             VALUES (
                 (SELECT id FROM "roles" WHERE name = 'admin'),
                 (SELECT id FROM "permissions" WHERE name = 'read:reports')
             )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove permission assignment
    await queryRunner.query(
      `DELETE FROM "role_permissions" WHERE permission_id = (SELECT id FROM "permissions" WHERE name = 'read:reports')`,
    );

    // Delete permission
    await queryRunner.query(`DELETE FROM "permissions" WHERE name = 'read:reports'`);
  }
}
