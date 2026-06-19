import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdvisorPaymentsPermission1781722058100 implements MigrationInterface {
  name = 'AddAdvisorPaymentsPermission1781722058100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Insert new permission for advisor payments
    await queryRunner.query(
      `INSERT INTO "permissions" ("name", "description") VALUES ('create:advisor-payments', 'Permiso para que los asesores registren abonos de pagos')`,
    );

    // Assign the new permission to admin role automatically
    await queryRunner.query(
      `INSERT INTO "role_permissions" ("role_id", "permission_id")
             VALUES (
                 (SELECT id FROM "roles" WHERE name = 'admin'),
                 (SELECT id FROM "permissions" WHERE name = 'create:advisor-payments')
             )`,
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
