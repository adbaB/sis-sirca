import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdvisorCode1783100450762 implements MigrationInterface {
  name = 'AddAdvisorCode1783100450762';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "advisors" ADD "code" SERIAL NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "advisors" ADD CONSTRAINT "UQ_22f0ae4471b934d24971f53c136" UNIQUE ("code")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "advisors" DROP CONSTRAINT "UQ_22f0ae4471b934d24971f53c136"`,
    );
    await queryRunner.query(`ALTER TABLE "advisors" DROP COLUMN "code"`);
  }
}
