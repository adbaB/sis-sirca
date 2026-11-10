import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDoctorPermissionsAndAuditorRole1793400000000 implements MigrationInterface {
  name = 'AddDoctorPermissionsAndAuditorRole1793400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Añadir columnas de control de asignación y auditoría a la tabla doctors
    await queryRunner.query(`
      ALTER TABLE "doctors"
      ADD COLUMN IF NOT EXISTS "can_attend_aps" boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS "can_schedule_consultations" boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS "is_medical_auditor" boolean NOT NULL DEFAULT false;
    `);

    // 2. Registrar o actualizar los permisos específicos para el ámbito médico
    await queryRunner.query(`
      INSERT INTO "permissions" ("name", "description")
      VALUES
        ('attend:aps', 'Ver cola de APS y ser asignado para atender pacientes en APS'),
        ('attend:consultations', 'Agendar citas y ver/atender únicamente las consultas asignadas al médico'),
        ('audit:medical', 'Médico Auditor: ver todo lo relacionado con médicos sin permisos de escritura ni edición'),
        ('manage:doctors', 'Crear y administrar perfiles y agendas de médicos')
      ON CONFLICT ("name") DO UPDATE SET
        "description" = EXCLUDED."description";
    `);

    // 3. Registrar roles especializados para el cuerpo médico si no existen
    await queryRunner.query(`
      INSERT INTO "roles" ("name", "description")
      VALUES
        ('Medico', 'Rol para médicos tratantes con acceso a cola APS y consultas asignadas'),
        ('Medico Consultas', 'Rol para médicos especialistas con acceso a su agenda de citas asignadas'),
        ('Medico Auditor', 'Rol para médicos auditores con visualización clínica y operativa en modo solo lectura')
      ON CONFLICT ("name") DO NOTHING;
    `);

    // 4. Asignar todos los permisos médicos al rol admin
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r.id, p.id
      FROM "roles" r, "permissions" p
      WHERE r.name = 'admin'
        AND p.name IN ('attend:aps', 'attend:consultations', 'audit:medical', 'manage:doctors')
      ON CONFLICT ("role_id", "permission_id") DO NOTHING;
    `);

    // 5. Asignar permisos al rol 'Medico' (APS + Consultas)
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r.id, p.id
      FROM "roles" r, "permissions" p
      WHERE r.name = 'Medico'
        AND p.name IN ('attend:aps', 'attend:consultations')
      ON CONFLICT ("role_id", "permission_id") DO NOTHING;
    `);

    // 6. Asignar permisos al rol 'Medico Consultas' (solo Consultas)
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r.id, p.id
      FROM "roles" r, "permissions" p
      WHERE r.name = 'Medico Consultas'
        AND p.name = 'attend:consultations'
      ON CONFLICT ("role_id", "permission_id") DO NOTHING;
    `);

    // 7. Asignar permisos al rol 'Medico Auditor' (solo Auditoría)
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r.id, p.id
      FROM "roles" r, "permissions" p
      WHERE r.name = 'Medico Auditor'
        AND p.name = 'audit:medical'
      ON CONFLICT ("role_id", "permission_id") DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Eliminar asignaciones de permisos de los roles médicos
    await queryRunner.query(`
      DELETE FROM "role_permissions"
      WHERE "permission_id" IN (
        SELECT id FROM "permissions"
        WHERE name IN ('attend:consultations', 'audit:medical')
      );
    `);

    // 2. Eliminar permisos creados
    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE name IN ('attend:consultations', 'audit:medical');
    `);

    // 3. Eliminar columnas de la tabla doctors
    await queryRunner.query(`
      ALTER TABLE "doctors"
      DROP COLUMN IF EXISTS "is_medical_auditor",
      DROP COLUMN IF EXISTS "can_schedule_consultations",
      DROP COLUMN IF EXISTS "can_attend_aps";
    `);
  }
}
