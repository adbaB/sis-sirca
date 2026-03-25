import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPaymentTypes1774451720052 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "payment_types" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "name" character varying(255) NOT NULL,
                "currency" character varying(10) NOT NULL,
                CONSTRAINT "PK_payment_types_id" PRIMARY KEY ("id")
            )`
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "payment_types"`);
    }

}
