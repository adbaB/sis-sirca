import { MigrationInterface, QueryRunner } from 'typeorm';
import * as cie10RichData from '../../cie10/data/cie10-rich.json';

export class AddRichFieldsToCie10Codes1793034657998 implements MigrationInterface {
  name = 'AddRichFieldsToCie10Codes1793034657998';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Agregar columnas a cie10_codes
    await queryRunner.query(
      `ALTER TABLE "cie10_codes" ADD COLUMN IF NOT EXISTS "clean_code" character varying(15);`,
    );
    await queryRunner.query(
      `ALTER TABLE "cie10_codes" ADD COLUMN IF NOT EXISTS "block" character varying(255);`,
    );
    await queryRunner.query(
      `ALTER TABLE "cie10_codes" ADD COLUMN IF NOT EXISTS "category" character varying(15);`,
    );
    await queryRunner.query(
      `ALTER TABLE "cie10_codes" ADD COLUMN IF NOT EXISTS "level" character varying(20) NOT NULL DEFAULT 'subcategory';`,
    );
    await queryRunner.query(
      `ALTER TABLE "cie10_codes" ADD COLUMN IF NOT EXISTS "is_terminal" boolean NOT NULL DEFAULT true;`,
    );
    await queryRunner.query(
      `ALTER TABLE "cie10_codes" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb;`,
    );

    // 2. Crear índices de búsqueda y filtrado
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_cie10_codes_clean_code" ON "cie10_codes" ("clean_code");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_cie10_codes_category" ON "cie10_codes" ("category");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_cie10_codes_is_terminal" ON "cie10_codes" ("is_terminal");`,
    );

    // 3. Poblar/actualizar con el catálogo completo y enriquecido
    const rawList: Array<any> = (cie10RichData as any).default || cie10RichData;

    if (Array.isArray(rawList) && rawList.length > 0) {
      // Inserción en bloques de 300 para alta eficiencia SQL
      const chunkSize = 300;
      for (let i = 0; i < rawList.length; i += chunkSize) {
        const chunk = rawList.slice(i, i + chunkSize);
        const valuesStatements: string[] = [];

        for (const item of chunk) {
          const codeEsc = (item.code || '').trim().toUpperCase().replace(/'/g, "''");
          const cleanEsc = (item.cleanCode || item.code || '')
            .trim()
            .toUpperCase()
            .replace(/[^A-Za-z0-9]/g, '');
          const descEsc = (item.description || '').trim().replace(/'/g, "''");
          const chapEsc = (item.chapterTitle || item.chapter || '').trim().replace(/'/g, "''");
          const blockEsc = (item.blockTitle || item.blockCode || '').trim().replace(/'/g, "''");
          const catEsc = (item.categoryCode || '').trim().replace(/'/g, "''");
          const levelEsc = (item.level || 'subcategory').replace(/'/g, "''");
          const isTerm = item.isTerminal === false ? false : true;
          const metaEsc = JSON.stringify(item.metadata || {}).replace(/'/g, "''");

          valuesStatements.push(
            `('${codeEsc}', '${cleanEsc}', '${descEsc}', ${chapEsc ? `'${chapEsc}'` : 'NULL'}, ${blockEsc ? `'${blockEsc}'` : 'NULL'}, ${catEsc ? `'${catEsc}'` : 'NULL'}, '${levelEsc}', ${isTerm}, '${metaEsc}'::jsonb, true)`,
          );
        }

        if (valuesStatements.length > 0) {
          await queryRunner.query(`
            INSERT INTO "cie10_codes" (
              "code", "clean_code", "description", "chapter", "block", "category", "level", "is_terminal", "metadata", "is_active"
            )
            VALUES ${valuesStatements.join(',\n')}
            ON CONFLICT ("code") DO UPDATE SET
              "clean_code" = EXCLUDED."clean_code",
              "description" = EXCLUDED."description",
              "chapter" = EXCLUDED."chapter",
              "block" = EXCLUDED."block",
              "category" = EXCLUDED."category",
              "level" = EXCLUDED."level",
              "is_terminal" = EXCLUDED."is_terminal",
              "metadata" = EXCLUDED."metadata",
              "updated_at" = now();
          `);
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_cie10_codes_is_terminal";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_cie10_codes_category";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_cie10_codes_clean_code";`);
    await queryRunner.query(`ALTER TABLE "cie10_codes" DROP COLUMN IF EXISTS "metadata";`);
    await queryRunner.query(`ALTER TABLE "cie10_codes" DROP COLUMN IF EXISTS "is_terminal";`);
    await queryRunner.query(`ALTER TABLE "cie10_codes" DROP COLUMN IF EXISTS "level";`);
    await queryRunner.query(`ALTER TABLE "cie10_codes" DROP COLUMN IF EXISTS "category";`);
    await queryRunner.query(`ALTER TABLE "cie10_codes" DROP COLUMN IF EXISTS "block";`);
    await queryRunner.query(`ALTER TABLE "cie10_codes" DROP COLUMN IF EXISTS "clean_code";`);
  }
}
