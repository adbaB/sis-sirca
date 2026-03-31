import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPersonPayment1774894637411 implements MigrationInterface {
  name = 'AddPersonPayment1774894637411';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payments" ADD "person_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_051690c92705cd28f863408e2a8" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_051690c92705cd28f863408e2a8"`,
    );
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "person_id"`);
  }
}
