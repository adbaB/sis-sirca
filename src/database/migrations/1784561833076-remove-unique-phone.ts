import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveUniquePhone1784561833076 implements MigrationInterface {
  name = 'RemoveUniquePhone1784561833076';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chatbot_interactions" DROP CONSTRAINT "UQ_f3fd8497afc77766fe67d8c971a"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chatbot_interactions" ADD CONSTRAINT "UQ_f3fd8497afc77766fe67d8c971a" UNIQUE ("phone")`,
    );
  }
}
