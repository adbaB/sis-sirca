import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSuspendedStatusAndCutoffDayToContracts1788464590396 implements MigrationInterface {
  name = 'AddSuspendedStatusAndCutoffDayToContracts1788464590396';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD "cutoff_day" integer NOT NULL DEFAULT '5'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."contracts_status_enum" RENAME TO "contracts_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."contracts_status_enum" AS ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED')`,
    );
    await queryRunner.query(`ALTER TABLE "contracts" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "contracts" ALTER COLUMN "status" TYPE "public"."contracts_status_enum" USING "status"::"text"::"public"."contracts_status_enum"`,
    );
    await queryRunner.query(`ALTER TABLE "contracts" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'`);
    await queryRunner.query(`DROP TYPE "public"."contracts_status_enum_old"`);
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD CONSTRAINT "CHK_contracts_cutoff_day" CHECK ("cutoff_day" >= 1 AND "cutoff_day" <= 31)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "contracts" DROP CONSTRAINT "CHK_contracts_cutoff_day"`);
    await queryRunner.query(
      `CREATE TYPE "public"."contracts_status_enum_old" AS ENUM('ACTIVE', 'INACTIVE')`,
    );
    await queryRunner.query(
      `UPDATE "contracts" SET "status" = 'INACTIVE' WHERE "status"::text = 'SUSPENDED'`,
    );
    await queryRunner.query(`ALTER TABLE "contracts" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "contracts" ALTER COLUMN "status" TYPE "public"."contracts_status_enum_old" USING "status"::"text"::"public"."contracts_status_enum_old"`,
    );
    await queryRunner.query(`ALTER TABLE "contracts" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'`);
    await queryRunner.query(`DROP TYPE "public"."contracts_status_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."contracts_status_enum_old" RENAME TO "contracts_status_enum"`,
    );
    await queryRunner.query(`ALTER TABLE "contracts" DROP COLUMN "cutoff_day"`);
  }
}
