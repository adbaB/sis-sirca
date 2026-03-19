import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChangesToContractAndPerson1773937665301 implements MigrationInterface {
  name = 'AddChangesToContractAndPerson1773937665301';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."persons_typeidentitycard_enum" AS ENUM('V', 'E', 'P', 'J', 'G', 'C', 'PN')`,
    );
    await queryRunner.query(
      `ALTER TABLE "persons" ADD "typeIdentityCard" "public"."persons_typeidentitycard_enum" NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "contracts" ADD "code" character varying(255) NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD CONSTRAINT "UQ_2a55e1c83511e04d3b9ddfefb51" UNIQUE ("code")`,
    );
    await queryRunner.query(
      `ALTER TABLE "persons" DROP CONSTRAINT "FK_9ccd1861f8804074aecf87bf1fc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "persons" DROP CONSTRAINT "UQ_b18f825b4fac08fc60aaabf2b49"`,
    );
    await queryRunner.query(`ALTER TABLE "persons" ALTER COLUMN "plan_id" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "persons" ADD CONSTRAINT "UQ_bf17f7e76d7adb32c5c298e2881" UNIQUE ("typeIdentityCard", "identity_card")`,
    );
    await queryRunner.query(
      `ALTER TABLE "persons" ADD CONSTRAINT "FK_9ccd1861f8804074aecf87bf1fc" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "persons" DROP CONSTRAINT "FK_9ccd1861f8804074aecf87bf1fc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "persons" DROP CONSTRAINT "UQ_bf17f7e76d7adb32c5c298e2881"`,
    );
    await queryRunner.query(`ALTER TABLE "persons" ALTER COLUMN "plan_id" DROP NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "persons" ADD CONSTRAINT "UQ_b18f825b4fac08fc60aaabf2b49" UNIQUE ("identity_card")`,
    );
    await queryRunner.query(
      `ALTER TABLE "persons" ADD CONSTRAINT "FK_9ccd1861f8804074aecf87bf1fc" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" DROP CONSTRAINT "UQ_2a55e1c83511e04d3b9ddfefb51"`,
    );
    await queryRunner.query(`ALTER TABLE "contracts" DROP COLUMN "code"`);
    await queryRunner.query(`ALTER TABLE "persons" DROP COLUMN "typeIdentityCard"`);
    await queryRunner.query(`DROP TYPE "public"."persons_typeidentitycard_enum"`);
  }
}
