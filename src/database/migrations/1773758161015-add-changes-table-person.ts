import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChangesTablePerson1773758161015 implements MigrationInterface {
  name = 'AddChangesTablePerson1773758161015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "persons" ALTER COLUMN "birth_date" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "persons" DROP COLUMN "gender"`);
    await queryRunner.query(`ALTER TABLE "persons" ADD "gender" boolean`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "persons" DROP COLUMN "gender"`);
    await queryRunner.query(`ALTER TABLE "persons" ADD "gender" character varying(20) NOT NULL`);
    await queryRunner.query(`ALTER TABLE "persons" ALTER COLUMN "birth_date" SET NOT NULL`);
  }
}
