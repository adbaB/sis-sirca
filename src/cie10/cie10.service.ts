import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cie10Code } from './entities/cie10-code.entity';
import * as cie10RichData from './data/cie10-rich.json';

@Injectable()
export class Cie10Service implements OnModuleInit {
  private readonly logger = new Logger(Cie10Service.name);

  constructor(
    @InjectRepository(Cie10Code)
    private readonly cie10Repo: Repository<Cie10Code>,
  ) {}

  async onModuleInit() {
    try {
      await this.ensurePreloaded();
    } catch (err) {
      this.logger.warn(
        `Could not preload CIE-10 codes on startup (might be waiting for migration): ${err?.message}`,
      );
    }
  }

  async ensurePreloaded(): Promise<number> {
    const count = await this.cie10Repo.count();
    const richSample = await this.cie10Repo.findOne({
      where: { code: 'A00.0' },
    });
    const isEnriched = Boolean(richSample?.cleanCode && richSample?.metadata);

    // Si ya tiene el catálogo completo (más de 11.000 códigos) y enriquecido, no hace falta reinsertar
    if (count >= 11000 && isEnriched) {
      return count;
    }

    this.logger.log(
      `Preloading complete enriched CIE-10 catalog (current count: ${count}, target: 11286)...`,
    );
    const rawList: Array<any> =
      (cie10RichData as unknown as { default: Array<any> }).default || cie10RichData;

    const values = rawList.map((item) => ({
      code: item.code.trim().toUpperCase(),
      cleanCode: (item.cleanCode || item.code)
        .trim()
        .toUpperCase()
        .replace(/[^A-Za-z0-9]/g, ''),
      description: item.description.trim(),
      chapter: item.chapterTitle?.trim() || item.chapter?.trim() || null,
      block: item.blockTitle?.trim() || item.blockCode?.trim() || null,
      category: item.categoryCode?.trim() || null,
      level: item.level || 'subcategory',
      isTerminal: item.isTerminal === false ? false : true,
      metadata: item.metadata || {},
      isActive: true,
    }));

    // Inserción en bloques de 300 con query builder y ON CONFLICT DO UPDATE
    const chunkSize = 300;
    for (let i = 0; i < values.length; i += chunkSize) {
      const chunk = values.slice(i, i + chunkSize);
      await this.cie10Repo
        .createQueryBuilder()
        .insert()
        .into(Cie10Code)
        .values(chunk)
        .orUpdate(
          [
            'clean_code',
            'description',
            'chapter',
            'block',
            'category',
            'level',
            'is_terminal',
            'metadata',
            'is_active',
            'updated_at',
          ],
          ['code'],
        )
        .execute();
    }

    const finalCount = await this.cie10Repo.count();
    this.logger.log(`Successfully ensured ${finalCount} enriched CIE-10 codes in database.`);
    return finalCount;
  }

  async search(query = '', limit = 30, onlyTerminal = true): Promise<Cie10Code[]> {
    const trimmed = (query || '').trim();
    const cleanCodeQuery = trimmed.replace(/[^A-Za-z0-9]/g, '');
    const qb = this.cie10Repo
      .createQueryBuilder('cie')
      .where('cie.isActive = :isActive', { isActive: true });

    if (onlyTerminal) {
      qb.andWhere('cie.isTerminal = :isTerminal', { isTerminal: true });
    }

    if (trimmed) {
      qb.andWhere(
        "(cie.code ILIKE :q OR cie.cleanCode ILIKE :cleanQ OR cie.description ILIKE :q OR cie.chapter ILIKE :q OR cie.block ILIKE :q OR CAST(cie.metadata->'inclusions' AS text) ILIKE :q)",
        {
          q: `%${trimmed}%`,
          cleanQ: `%${cleanCodeQuery}%`,
        },
      );
      // Priorizar coincidencias exactas por código, luego prefijo, luego descripción
      qb.orderBy(
        `CASE 
          WHEN cie.code = :cleanCodeUpper OR cie.cleanCode = :cleanCodeUpper THEN 0 
          WHEN cie.cleanCode ILIKE :cleanPrefix THEN 1 
          WHEN cie.code ILIKE :exactPrefix THEN 2 
          WHEN cie.description ILIKE :q THEN 3 
          ELSE 4 
        END`,
        'ASC',
      )
        .setParameter('cleanCodeUpper', cleanCodeQuery.toUpperCase())
        .setParameter('cleanPrefix', `${cleanCodeQuery}%`)
        .setParameter('exactPrefix', `${trimmed}%`)
        .setParameter('q', `%${trimmed}%`);
      qb.addOrderBy('cie.code', 'ASC');
    } else {
      qb.orderBy('cie.code', 'ASC');
    }

    qb.take(Math.min(limit, 100));
    return qb.getMany();
  }

  async findOne(code: string): Promise<Cie10Code | null> {
    const clean = (code || '').trim().toUpperCase();
    const noDot = clean.replace(/[^A-Za-z0-9]/g, '');
    return this.cie10Repo.findOne({
      where: [{ code: clean }, { cleanCode: noDot }],
    });
  }
}
