import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMinAgeToPlans1783347993111 implements MigrationInterface {
  name = 'AddMinAgeToPlans1783347993111';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "plans" ADD "min_age" integer NOT NULL DEFAULT '0'`);
    await queryRunner.query(
      `ALTER TABLE "plans" ADD CONSTRAINT "CHK_plans_age_range" CHECK ("max_age" >= "min_age")`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD CONSTRAINT "CHK_plans_min_age" CHECK ("min_age" >= 0)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "plans" DROP CONSTRAINT "CHK_plans_min_age"`);
    await queryRunner.query(`ALTER TABLE "plans" DROP CONSTRAINT "CHK_plans_age_range"`);
    await queryRunner.query(`ALTER TABLE "plans" DROP COLUMN "min_age"`);
  }
}
