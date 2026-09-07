import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIsRevertedToAffiliationHistory1788447809560 implements MigrationInterface {
  name = 'AddIsRevertedToAffiliationHistory1788447809560';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contract_persons" DROP CONSTRAINT "FK_contract_persons_plan"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_users_email"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_payments_status"`);
    await queryRunner.query(
      `ALTER TABLE "affiliation_history" ADD "is_reverted" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "affiliation_history" ADD "reverted_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ah_is_reverted" ON "affiliation_history" ("is_reverted") `,
    );
    await queryRunner.query(
      `UPDATE "affiliation_history" SET "is_reverted" = true WHERE "reason" LIKE 'REVERTIDO:%'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_payments_status_send_at" ON "payments" ("status", "send_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "contract_persons" ADD CONSTRAINT "FK_a31e2f22ff3f92d7e7064a41bf1" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contract_persons" DROP CONSTRAINT "FK_a31e2f22ff3f92d7e7064a41bf1"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_payments_status_send_at"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ah_is_reverted"`);
    await queryRunner.query(`ALTER TABLE "affiliation_history" DROP COLUMN "reverted_at"`);
    await queryRunner.query(`ALTER TABLE "affiliation_history" DROP COLUMN "is_reverted"`);
    await queryRunner.query(`CREATE INDEX "IDX_payments_status" ON "payments" ("status") `);
    await queryRunner.query(`CREATE INDEX "IDX_users_email" ON "users" ("email") `);
    await queryRunner.query(
      `ALTER TABLE "contract_persons" ADD CONSTRAINT "FK_contract_persons_plan" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );
  }
}
