import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdvisorPaymentsPermission1781722058100 implements MigrationInterface {
  name = 'AddAdvisorPaymentsPermission1781722058100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Insert new permission for advisor payments
    await queryRunner.query(
      `INSERT INTO "permissions" ("name", "description") VALUES ('create:advisor-payments', 'Permiso para que los asesores registren abonos de pagos') ON CONFLICT ("name") DO NOTHING`,
    );

    // Assign the new permission to admin role automatically
    await queryRunner.query(
      `INSERT INTO "role_permissions" ("role_id", "permission_id")
             SELECT r.id, p.id
             FROM "roles" r, "permissions" p
             WHERE r.name = 'admin' AND p.name = 'create:advisor-payments'
             ON CONFLICT DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove permission assignment
    await queryRunner.query(
      `DELETE FROM "role_permissions" WHERE permission_id = (SELECT id FROM "permissions" WHERE name = 'create:advisor-payments')`,
    );

    // Delete permission
    await queryRunner.query(`DELETE FROM "permissions" WHERE name = 'create:advisor-payments'`);
  }
}
