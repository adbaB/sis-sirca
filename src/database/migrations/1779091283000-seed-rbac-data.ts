import { MigrationInterface, QueryRunner } from 'typeorm';
import * as bcrypt from 'bcrypt';

/**
 * Seed de datos iniciales para el sistema RBAC.
 * Crea permisos base, rol de admin, y un usuario administrador.
 *
 * Credenciales iniciales del admin:
 *   email: admin@sirca.com.ve
 *   password: Admin123!
 */
export class SeedRbacData1779091283000 implements MigrationInterface {
  name = 'SeedRbacData1779091283000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Crear permisos CRUD para cada módulo
    const permissionNames = [
      // Users
      'create:users',
      'read:users',
      'update:users',
      'delete:users',
      // Roles
      'create:roles',
      'read:roles',
      'update:roles',
      'delete:roles',
      // Permissions
      'create:permissions',
      'read:permissions',
      'update:permissions',
      'delete:permissions',
      // Módulos existentes
      'create:contracts',
      'read:contracts',
      'update:contracts',
      'delete:contracts',
      'create:payments',
      'read:payments',
      'update:payments',
      'delete:payments',
      'create:billing',
      'read:billing',
      'update:billing',
      'delete:billing',
      'read:statistics',
    ];

    for (const name of permissionNames) {
      await queryRunner.query(`INSERT INTO "permissions" ("name", "description") VALUES ($1, $2)`, [
        name,
        `Permiso para ${name.replace(':', ' ')}`,
      ]);
    }

    // 2. Crear rol de administrador
    await queryRunner.query(
      `INSERT INTO "roles" ("id", "name", "description") VALUES (uuid_generate_v4(), 'admin', 'Administrador con acceso completo')`,
    );

    // 3. Asignar todos los permisos al rol admin
    await queryRunner.query(
      `INSERT INTO "role_permissions" ("role_id", "permission_id")
       SELECT r.id, p.id FROM "roles" r, "permissions" p WHERE r.name = 'admin'`,
    );

    // 4. Crear usuario administrador
    const hashedPassword = await bcrypt.hash('Admin123!', 10);
    await queryRunner.query(
      `INSERT INTO "users" ("email", "password", "is_active", "role_id")
       VALUES ($1, $2, true, (SELECT id FROM "roles" WHERE name = 'admin'))`,
      ['admin@sirca.com.ve', hashedPassword],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "users" WHERE email = 'admin@sirca.com.ve'`);
    await queryRunner.query(
      `DELETE FROM "role_permissions" WHERE role_id = (SELECT id FROM "roles" WHERE name = 'admin')`,
    );
    await queryRunner.query(`DELETE FROM "roles" WHERE name = 'admin'`);
    await queryRunner.query(`DELETE FROM "permissions"`);
  }
}
