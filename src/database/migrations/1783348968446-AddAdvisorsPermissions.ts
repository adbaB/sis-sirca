import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdvisorsPermissions1783348968446 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const permissionNames = [
      'create:advisors',
      'read:advisors',
      'update:advisors',
      'delete:advisors',
    ];

    for (const name of permissionNames) {
      await queryRunner.query(
        `INSERT INTO "permissions" ("name", "description") VALUES ($1, $2) ON CONFLICT ("name") DO NOTHING`,
        [name, `Permiso para ${name.replace(':', ' ')}`],
      );

      // Assign to admin role
      await queryRunner.query(
        `INSERT INTO "role_permissions" ("role_id", "permission_id")
             SELECT r.id, p.id
             FROM "roles" r, "permissions" p
             WHERE r.name = 'admin' AND p.name = $1
             ON CONFLICT DO NOTHING`,
        [name],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const permissionNames = [
      'create:advisors',
      'read:advisors',
      'update:advisors',
      'delete:advisors',
    ];

    for (const name of permissionNames) {
      await queryRunner.query(
        `DELETE FROM "role_permissions" WHERE permission_id = (SELECT id FROM "permissions" WHERE name = $1)`,
        [name],
      );
      await queryRunner.query(`DELETE FROM "permissions" WHERE name = $1`, [name]);
    }
  }
}
