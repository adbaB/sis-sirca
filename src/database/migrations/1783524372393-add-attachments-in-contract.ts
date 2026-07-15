import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAttachmentsInContract1783524372393 implements MigrationInterface {
  name = 'AddAttachmentsInContract1783524372393';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "contracts" ADD "attachments" text array`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "contracts" DROP COLUMN "attachments"`);
  }
}
