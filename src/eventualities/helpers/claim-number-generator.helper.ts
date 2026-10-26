import { EntityManager } from 'typeorm';
import { SystemCounter } from '../../common/entities/system-counter.entity';
import { DateTime } from 'luxon';
import { CARACAS_ZONE } from '../../common/utils/date.util';

export interface GeneratedClaimNumberResult {
  claimNumber: string;
  serial: number;
  year: number;
}

/**
 * Genera atómicamente el siguiente número correlativo de siniestro exclusivamente numérico (sin letras ni guiones):
 * Formato: {YYYY}{serialNumber (6 dígitos)} -> Ej. 2026000001
 * Utiliza un bloqueo pesimista de escritura sobre SystemCounter con clave 'claim_number'.
 */
export async function generateClaimNumber(
  manager: EntityManager,
): Promise<GeneratedClaimNumberResult> {
  const counterRepo = manager.getRepository(SystemCounter);
  let counter = await counterRepo.findOne({
    where: { key: 'claim_number' },
    lock: { mode: 'pessimistic_write' },
  });

  if (!counter) {
    counter = counterRepo.create({ key: 'claim_number', value: 1 });
  }

  const serial = counter.value;
  counter.value += 1;
  await counterRepo.save(counter);

  const currentYear = DateTime.now().setZone(CARACAS_ZONE).year;
  const serialPadded = String(serial).padStart(6, '0');
  const claimNumber = `${currentYear}${serialPadded}`;

  return {
    claimNumber,
    serial,
    year: currentYear,
  };
}
