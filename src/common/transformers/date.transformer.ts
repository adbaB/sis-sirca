import { ValueTransformer } from 'typeorm';
import { normalizeDateOnly } from '../utils/date.util';

/**
 * TypeORM ValueTransformer for PostgreSQL 'date' columns.
 *
 * Ensures that whenever a Date object or date string is written to PostgreSQL,
 * it is serialized as a plain 'YYYY-MM-DD' string to prevent node-postgres
 * from applying local timezone shifts (e.g. converting UTC midnight into 20:00
 * of the previous day in America/Caracas UTC-4, which causes Postgres to subtract a day).
 */
export const dateColumnTransformer: ValueTransformer = {
  to(value: Date | string | null | undefined): string | null {
    if (!value) return null;
    return normalizeDateOnly(value);
  },
  from(value: string | Date | null | undefined): Date | string | null {
    if (!value) return null;
    return value;
  },
};
