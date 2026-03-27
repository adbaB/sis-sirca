import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIdempotencyKey1774540000000 implements MigrationInterface {
  name = 'AddIdempotencyKey1774540000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Agregamos la columna de idempotency_key con restricción de unicidad
    await queryRunner.query(
      'ALTER TABLE "payments" ADD "idempotency_key" character varying(255) NOT NULL DEFAULT uuid_generate_v4()',
    );
    await queryRunner.query(
      'ALTER TABLE "payments" ADD CONSTRAINT "UQ_idempotency_key" UNIQUE ("idempotency_key")',
    );

    // Actualizamos reference_number para que sea único
    await queryRunner.query(
      'ALTER TABLE "payments" ADD CONSTRAINT "UQ_reference_number" UNIQUE ("reference_number")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "payments" DROP CONSTRAINT "UQ_reference_number"');
    await queryRunner.query('ALTER TABLE "payments" DROP CONSTRAINT "UQ_idempotency_key"');
    await queryRunner.query('ALTER TABLE "payments" DROP COLUMN "idempotency_key"');
  }
}
