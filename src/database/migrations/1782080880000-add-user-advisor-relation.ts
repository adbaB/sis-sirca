import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserAdvisorRelation1782080880000 implements MigrationInterface {
  name = 'AddUserAdvisorRelation1782080880000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Relación Usuario-Asesor en base de datos
    await queryRunner.query(`ALTER TABLE "users" ADD "advisor_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_users_advisor" FOREIGN KEY ("advisor_id") REFERENCES "advisors"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // 2. Crear el nuevo permiso read:pipeline con descripción amigable
    await queryRunner.query(
      `INSERT INTO "permissions" ("name", "description") VALUES ('read:pipeline', 'Ver consola de seguimiento comercial y alertas de contratos')`,
    );

    // 3. Asignar el nuevo permiso automáticamente al rol admin
    await queryRunner.query(
      `INSERT INTO "role_permissions" ("role_id", "permission_id")
       VALUES (
         (SELECT id FROM "roles" WHERE name = 'admin'),
         (SELECT id FROM "permissions" WHERE name = 'read:pipeline')
       )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Eliminar asignación del permiso al rol admin
    await queryRunner.query(
      `DELETE FROM "role_permissions" WHERE permission_id = (SELECT id FROM "permissions" WHERE name = 'read:pipeline')`,
    );

    // 2. Eliminar el permiso read:pipeline
    await queryRunner.query(`DELETE FROM "permissions" WHERE name = 'read:pipeline'`);

    // 3. Eliminar relación Usuario-Asesor y columna
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_users_advisor"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "advisor_id"`);
  }
}
