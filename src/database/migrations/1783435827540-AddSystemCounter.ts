import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSystemCounter1783435827540 implements MigrationInterface {
  name = 'AddSystemCounter1783435827540';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "system_counters" ("key" character varying(100) NOT NULL, "value" integer NOT NULL DEFAULT '1', CONSTRAINT "PK_2d416e8f67766ed1e6254918de9" PRIMARY KEY ("key"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "system_counters"`);
  }
}
