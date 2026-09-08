import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReactivationEligibleAtAndOverridePermission1788550644653 implements MigrationInterface {
  name = 'AddReactivationEligibleAtAndOverridePermission1788550644653';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Añadir columna reactivation_eligible_at a contracts
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD "reactivation_eligible_at" TIMESTAMP WITH TIME ZONE NULL`,
    );

    // 2. Crear índice condicional optimizado para contratos suspendidos
    await queryRunner.query(
      `CREATE INDEX "IDX_contracts_status_reactivation_eligible_at" ON "contracts" ("status", "reactivation_eligible_at") WHERE "status" = 'SUSPENDED'`,
    );

    // 3. Crear permiso override:contract-reactivation
    const permissionName = 'override:contract-reactivation';
    const permissionDescription =
      'Permiso para reactivar contratos suspendidos antes del plazo de 7 días o con deuda pendiente (bypass)';

    await queryRunner.query(
      `INSERT INTO "permissions" ("name", "description") VALUES ($1, $2) ON CONFLICT ("name") DO NOTHING`,
      [permissionName, permissionDescription],
    );

    // 4. Asignar el nuevo permiso al rol admin
    await queryRunner.query(
      `INSERT INTO "role_permissions" ("role_id", "permission_id")
       SELECT r.id, p.id
       FROM "roles" r, "permissions" p
       WHERE r.name = 'admin' AND p.name = $1
       ON CONFLICT DO NOTHING`,
      [permissionName],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const permissionName = 'override:contract-reactivation';

    // 1. Eliminar asignación únicamente para el rol admin
    await queryRunner.query(
      `DELETE FROM "role_permissions"
       WHERE role_id = (SELECT id FROM "roles" WHERE name = 'admin')
         AND permission_id = (SELECT id FROM "permissions" WHERE name = $1)`,
      [permissionName],
    );

    // 2. Eliminar permiso únicamente si ya no está asignado a ningún otro rol
    await queryRunner.query(
      `DELETE FROM "permissions"
       WHERE name = $1
         AND NOT EXISTS (
           SELECT 1 FROM "role_permissions" rp WHERE rp.permission_id = "permissions".id
         )`,
      [permissionName],
    );

    // 3. Eliminar índice
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_contracts_status_reactivation_eligible_at"`);

    // 4. Eliminar columna
    await queryRunner.query(`ALTER TABLE "contracts" DROP COLUMN "reactivation_eligible_at"`);
  }
}
