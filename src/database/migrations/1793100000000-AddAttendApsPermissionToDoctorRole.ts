import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAttendApsPermissionToDoctorRole1793100000000 implements MigrationInterface {
  name = 'AddAttendApsPermissionToDoctorRole1793100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Asegurar existencia de los permisos específicos para APS y Médicos
    await queryRunner.query(`
      INSERT INTO "permissions" ("name", "description")
      VALUES
        ('attend:aps', 'Atender consultas APS y acceder al Dashboard Médico'),
        ('manage:doctors', 'Crear y administrar perfiles de médicos')
      ON CONFLICT ("name") DO NOTHING;
    `);

    // 2. Asegurar existencia del rol 'Medico'
    await queryRunner.query(`
      INSERT INTO "roles" ("name", "description")
      VALUES ('Medico', 'Rol para médicos tratantes con acceso al panel médico y atención de pacientes')
      ON CONFLICT ("name") DO NOTHING;
    `);

    // 3. Asignar 'attend:aps' y 'manage:doctors' al rol 'admin'
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r.id, p.id
      FROM "roles" r, "permissions" p
      WHERE r.name = 'admin' AND p.name IN ('attend:aps', 'manage:doctors')
      ON CONFLICT ("role_id", "permission_id") DO NOTHING;
    `);

    // 4. Asignar 'attend:aps' al rol 'Medico'
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r.id, p.id
      FROM "roles" r, "permissions" p
      WHERE r.name = 'Medico' AND p.name = 'attend:aps'
      ON CONFLICT ("role_id", "permission_id") DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revertir asignación al rol 'Medico'
    await queryRunner.query(`
      DELETE FROM "role_permissions"
      WHERE "role_id" IN (SELECT id FROM "roles" WHERE name = 'Medico')
        AND "permission_id" IN (SELECT id FROM "permissions" WHERE name = 'attend:aps');
    `);
  }
}
