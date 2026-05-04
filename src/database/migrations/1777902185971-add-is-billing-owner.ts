import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIsBillingOwner1777902185971 implements MigrationInterface {
  name = 'AddIsBillingOwner1777902185971';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "persons" DROP CONSTRAINT "UQ_bf17f7e76d7adb32c5c298e2881"`,
    );
    await queryRunner.query(
      `ALTER TABLE "persons" RENAME COLUMN "typeIdentityCard" TO "type_identity_card"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."persons_typeidentitycard_enum" RENAME TO "persons_type_identity_card_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contract_persons" ADD "is_billing_owner" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "persons" ADD CONSTRAINT "UQ_8259a1279c88910f0dd9132e8a4" UNIQUE ("type_identity_card", "identity_card")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "persons" DROP CONSTRAINT "UQ_8259a1279c88910f0dd9132e8a4"`,
    );
    await queryRunner.query(`ALTER TABLE "contract_persons" DROP COLUMN "is_billing_owner"`);
    await queryRunner.query(
      `ALTER TYPE "public"."persons_type_identity_card_enum" RENAME TO "persons_typeidentitycard_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "persons" RENAME COLUMN "type_identity_card" TO "typeIdentityCard"`,
    );
    await queryRunner.query(
      `ALTER TABLE "persons" ADD CONSTRAINT "UQ_bf17f7e76d7adb32c5c298e2881" UNIQUE ("identity_card", "typeIdentityCard")`,
    );
  }
}
