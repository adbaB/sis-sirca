import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddValidations1773773404803 implements MigrationInterface {
  name = 'AddValidations1773773404803';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "billing_month" character varying(7) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_563a5e248518c623eebd987d43e"`,
    );
    await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "invoice_id" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "FK_2a1393659dc4aa043ed203c8886"`,
    );
    await queryRunner.query(`ALTER TABLE "invoices" ALTER COLUMN "contract_id" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "invoice_details" DROP CONSTRAINT "FK_2da75e038c5b463f19965b4c739"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_details" DROP CONSTRAINT "FK_d85b43d1d140c1e4cf76606c65b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_details" DROP CONSTRAINT "FK_b3f935a9c5a5a0d26ed287f8f8c"`,
    );
    await queryRunner.query(`ALTER TABLE "invoice_details" ALTER COLUMN "invoice_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "invoice_details" ALTER COLUMN "person_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "invoice_details" ALTER COLUMN "plan_id" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "CHK_6e5b396b6082402956a13f6ad9" CHECK ("paid_amount" <= "total_amount")`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "CHK_120bf4d4cdf45e86f491df7532" CHECK ("paid_amount" >= 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "CHK_aafbd2f4481753025fd07ec13b" CHECK ("total_amount" >= 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "UQ_c3b7fe429955aaa06a67124865c" UNIQUE ("contract_id", "billing_month")`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_563a5e248518c623eebd987d43e" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "FK_2a1393659dc4aa043ed203c8886" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_details" ADD CONSTRAINT "FK_2da75e038c5b463f19965b4c739" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_details" ADD CONSTRAINT "FK_d85b43d1d140c1e4cf76606c65b" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_details" ADD CONSTRAINT "FK_b3f935a9c5a5a0d26ed287f8f8c" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_details" DROP CONSTRAINT "FK_b3f935a9c5a5a0d26ed287f8f8c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_details" DROP CONSTRAINT "FK_d85b43d1d140c1e4cf76606c65b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_details" DROP CONSTRAINT "FK_2da75e038c5b463f19965b4c739"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "FK_2a1393659dc4aa043ed203c8886"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_563a5e248518c623eebd987d43e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "UQ_c3b7fe429955aaa06a67124865c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "CHK_aafbd2f4481753025fd07ec13b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "CHK_120bf4d4cdf45e86f491df7532"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "CHK_6e5b396b6082402956a13f6ad9"`,
    );
    await queryRunner.query(`ALTER TABLE "invoice_details" ALTER COLUMN "plan_id" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "invoice_details" ALTER COLUMN "person_id" DROP NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "invoice_details" ALTER COLUMN "invoice_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_details" ADD CONSTRAINT "FK_b3f935a9c5a5a0d26ed287f8f8c" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_details" ADD CONSTRAINT "FK_d85b43d1d140c1e4cf76606c65b" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_details" ADD CONSTRAINT "FK_2da75e038c5b463f19965b4c739" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "invoices" ALTER COLUMN "contract_id" DROP NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "FK_2a1393659dc4aa043ed203c8886" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "invoice_id" DROP NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_563a5e248518c623eebd987d43e" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "billing_month"`);
  }
}
