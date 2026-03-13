import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTablesPersonPlanAndContratct1773326914033 implements MigrationInterface {
  name = 'AddTablesPersonPlanAndContratct1773326914033';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "contracts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "affiliation_date" date NOT NULL, "monthly_amount" numeric(10,2) NOT NULL DEFAULT '0', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "PK_2c7b8f3a7b1acdd49497d83d0fb" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "persons" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "identity_card" character varying(50) NOT NULL, "name" character varying(255) NOT NULL, "birth_date" date NOT NULL, "gender" character varying(20) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, "plan_id" uuid, "contract_id" uuid, CONSTRAINT "UQ_b18f825b4fac08fc60aaabf2b49" UNIQUE ("identity_card"), CONSTRAINT "PK_74278d8812a049233ce41440ac7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "plans" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(255) NOT NULL, "max_age" integer NOT NULL, "amount" numeric(10,2) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "PK_3720521a81c7c24fe9b7202ba61" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "persons" ADD CONSTRAINT "FK_9ccd1861f8804074aecf87bf1fc" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "persons" ADD CONSTRAINT "FK_10c6782ef8b37b26c79510a4f39" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "persons" DROP CONSTRAINT "FK_10c6782ef8b37b26c79510a4f39"`,
    );
    await queryRunner.query(
      `ALTER TABLE "persons" DROP CONSTRAINT "FK_9ccd1861f8804074aecf87bf1fc"`,
    );
    await queryRunner.query(`DROP TABLE "plans"`);
    await queryRunner.query(`DROP TABLE "persons"`);
    await queryRunner.query(`DROP TABLE "contracts"`);
  }
}
