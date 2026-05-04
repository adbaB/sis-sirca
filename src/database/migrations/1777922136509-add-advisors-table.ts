import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAdvisorsTable1777922136509 implements MigrationInterface {
    name = 'AddAdvisorsTable1777922136509'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "advisors" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(255) NOT NULL, "status" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "PK_4baf808487b3dcc389087c9cdeb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "contracts" ADD "advisor_id" uuid`);
        await queryRunner.query(`ALTER TABLE "contracts" ADD CONSTRAINT "FK_da939d680763ba58e1104532481" FOREIGN KEY ("advisor_id") REFERENCES "advisors"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "contracts" DROP CONSTRAINT "FK_da939d680763ba58e1104532481"`);
        await queryRunner.query(`ALTER TABLE "contracts" DROP COLUMN "advisor_id"`);
        await queryRunner.query(`DROP TABLE "advisors"`);
    }

}
