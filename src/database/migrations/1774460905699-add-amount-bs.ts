import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAmountBs1774460905699 implements MigrationInterface {
  name = 'AddAmountBs1774460905699';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contract_persons" DROP CONSTRAINT "FK_contract_persons_contract"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contract_persons" DROP CONSTRAINT "FK_contract_persons_person"`,
    );
    await queryRunner.query(`ALTER TABLE "contract_persons" DROP CONSTRAINT "UQ_contract_person"`);
    await queryRunner.query(`ALTER TABLE "payments" ADD "amount_bs" numeric(10,2)`);
    await queryRunner.query(
      `ALTER TABLE "persons" DROP CONSTRAINT "FK_9ccd1861f8804074aecf87bf1fc"`,
    );
    await queryRunner.query(`ALTER TABLE "persons" ALTER COLUMN "plan_id" DROP NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "contract_persons" ADD CONSTRAINT "UQ_3970b54831d384fe5614eeb8ae1" UNIQUE ("contract_id", "person_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "persons" ADD CONSTRAINT "FK_9ccd1861f8804074aecf87bf1fc" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "contract_persons" ADD CONSTRAINT "FK_984e91a23639beb64d502b75c6a" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "contract_persons" ADD CONSTRAINT "FK_60467d27a185de1942f112f7f85" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contract_persons" DROP CONSTRAINT "FK_60467d27a185de1942f112f7f85"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contract_persons" DROP CONSTRAINT "FK_984e91a23639beb64d502b75c6a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "persons" DROP CONSTRAINT "FK_9ccd1861f8804074aecf87bf1fc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contract_persons" DROP CONSTRAINT "UQ_3970b54831d384fe5614eeb8ae1"`,
    );
    await queryRunner.query(`ALTER TABLE "persons" ALTER COLUMN "plan_id" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "persons" ADD CONSTRAINT "FK_9ccd1861f8804074aecf87bf1fc" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "amount_bs"`);
    await queryRunner.query(
      `ALTER TABLE "contract_persons" ADD CONSTRAINT "UQ_contract_person" UNIQUE ("contract_id", "person_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "contract_persons" ADD CONSTRAINT "FK_contract_persons_person" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "contract_persons" ADD CONSTRAINT "FK_contract_persons_contract" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }
}
