import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRetentionFields1782755239759 implements MigrationInterface {
  name = 'AddRetentionFields1782755239759';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "role_permissions" DROP CONSTRAINT "FK_role_permissions_permission"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_role_permissions_permission_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_role_permissions_role_id"`);
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD "retention_percentage" numeric(5,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "retention_percentage" numeric(5,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "retention_amount" numeric(10,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolios" ALTER COLUMN "commission_amount" SET DEFAULT '0'`,
    );
    await queryRunner.query(`ALTER TABLE "plans" ALTER COLUMN "commission_amount" SET DEFAULT '0'`);
    await queryRunner.query(
      `CREATE INDEX "IDX_178199805b901ccd220ab7740e" ON "role_permissions" ("role_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_17022daf3f885f7d35423e9971" ON "role_permissions" ("permission_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "role_permissions" ADD CONSTRAINT "FK_role_permissions_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "role_permissions" DROP CONSTRAINT "FK_role_permissions_permission"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_17022daf3f885f7d35423e9971"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_178199805b901ccd220ab7740e"`);
    await queryRunner.query(
      `ALTER TABLE "plans" ALTER COLUMN "commission_amount" SET DEFAULT 0.00`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolios" ALTER COLUMN "commission_amount" SET DEFAULT 0.00`,
    );
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "retention_amount"`);
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "retention_percentage"`);
    await queryRunner.query(`ALTER TABLE "contracts" DROP COLUMN "retention_percentage"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_role_permissions_role_id" ON "role_permissions" ("role_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_role_permissions_permission_id" ON "role_permissions" ("permission_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "role_permissions" ADD CONSTRAINT "FK_role_permissions_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }
}
