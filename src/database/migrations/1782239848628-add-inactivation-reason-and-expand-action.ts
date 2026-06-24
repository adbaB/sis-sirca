import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInactivationReasonAndExpandAction1782239848628 implements MigrationInterface {
  name = 'AddInactivationReasonAndExpandAction1782239848628';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Agregar columna inactivation_reason a contracts
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD "inactivation_reason" character varying(500)`,
    );

    // 2. Expandir action de varchar(20) a varchar(30) para soportar 'CAMBIO_CONTRATO'
    await queryRunner.query(
      `ALTER TABLE "affiliation_history" ALTER COLUMN "action" TYPE character varying(30)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 2. Revertir action de varchar(30) a varchar(20)
    await queryRunner.query(
      `ALTER TABLE "affiliation_history" ALTER COLUMN "action" TYPE character varying(20)`,
    );

    // 1. Eliminar columna inactivation_reason de contracts
    await queryRunner.query(`ALTER TABLE "contracts" DROP COLUMN "inactivation_reason"`);
  }
}
