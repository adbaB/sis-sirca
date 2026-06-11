import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePortfoliosTable1781183626976 implements MigrationInterface {
  name = 'CreatePortfoliosTable1781183626976';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Remove old portfolio enum column and type
    await queryRunner.query(`ALTER TABLE "contracts" DROP COLUMN IF EXISTS "portfolio"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."contracts_portfolio_enum"`);

    // 2. Create portfolios table
    await queryRunner.query(
      `CREATE TABLE "portfolios" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(255) NOT NULL,
        "code" character varying(255) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'ACTIVE',
        "percentage" numeric(5,2) NOT NULL DEFAULT 0.00,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        CONSTRAINT "UQ_portfolio_code" UNIQUE ("code"),
        CONSTRAINT "PK_portfolios" PRIMARY KEY ("id")
      )`,
    );

    // 3. Add portfolio_id column to contracts and link foreign key
    await queryRunner.query(`ALTER TABLE "contracts" ADD "portfolio_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD CONSTRAINT "FK_contracts_portfolio" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    // 4. Seed base portfolios
    await queryRunner.query(
      `INSERT INTO "portfolios" ("name", "code", "status", "percentage") VALUES 
        ('Hospital el rosario', 'HER', 'ACTIVE', 0.00),
        ('APF', 'APF', 'ACTIVE', 0.00),
        ('GMP', 'GMP', 'ACTIVE', 0.00)`,
    );

    // 5. Seed RBAC Permissions
    const permissions = [
      'create:portfolios',
      'read:portfolios',
      'update:portfolios',
      'delete:portfolios',
    ];

    for (const name of permissions) {
      await queryRunner.query(`INSERT INTO "permissions" ("name", "description") VALUES ($1, $2)`, [
        name,
        `Permiso para ${name.replace(':', ' ')}`,
      ]);

      await queryRunner.query(
        `INSERT INTO "role_permissions" ("role_id", "permission_id")
         VALUES (
           (SELECT id FROM "roles" WHERE name = 'admin'),
           (SELECT id FROM "permissions" WHERE name = $1)
         )`,
        [name],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove permissions
    const permissions = [
      'create:portfolios',
      'read:portfolios',
      'update:portfolios',
      'delete:portfolios',
    ];
    for (const name of permissions) {
      await queryRunner.query(
        `DELETE FROM "role_permissions" WHERE permission_id = (SELECT id FROM "permissions" WHERE name = $1)`,
        [name],
      );
      await queryRunner.query(`DELETE FROM "permissions" WHERE name = $1`, [name]);
    }

    // Drop fk and column
    await queryRunner.query(`ALTER TABLE "contracts" DROP CONSTRAINT "FK_contracts_portfolio"`);
    await queryRunner.query(`ALTER TABLE "contracts" DROP COLUMN "portfolio_id"`);

    // Drop table
    await queryRunner.query(`DROP TABLE "portfolios"`);

    // Recreate enum and column
    await queryRunner.query(
      `CREATE TYPE "public"."contracts_portfolio_enum" AS ENUM('HER', 'APF', 'GMP')`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD "portfolio" "public"."contracts_portfolio_enum"`,
    );
  }
}
