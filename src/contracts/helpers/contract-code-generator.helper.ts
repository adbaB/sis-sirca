import { NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Advisor } from '../../advisors/entities/advisor.entity';
import { SystemCounter } from '../../common/entities/system-counter.entity';

export interface GeneratedContractCodeResult {
  generatedCode: string;
  advisor: Advisor;
  serial: number;
}

/**
 * Atomically generates the next contract code with format: SIR-{advisorCode}-{serialNumber}
 * utilizing a pessimistic write lock on the SystemCounter entity.
 */
export async function generateContractCode(
  manager: EntityManager,
  advisorId: string,
): Promise<GeneratedContractCodeResult> {
  const advisor = await manager.getRepository(Advisor).findOne({ where: { id: advisorId } });
  if (!advisor) {
    throw new NotFoundException('El asesor proporcionado no existe.');
  }

  const counterRepo = manager.getRepository(SystemCounter);
  let counter = await counterRepo.findOne({
    where: { key: 'contract_code' },
    lock: { mode: 'pessimistic_write' },
  });

  if (!counter) {
    counter = counterRepo.create({ key: 'contract_code', value: 1 });
  }

  const serial = counter.value;
  counter.value += 1;
  await counterRepo.save(counter);

  const serialNumber = String(serial).padStart(5, '0');
  let advisorCodeStr = '000';
  if (advisor.code) {
    advisorCodeStr = String(advisor.code).padStart(3, '0');
  }

  const generatedCode = `SIR-${advisorCodeStr}-${serialNumber}`;

  return {
    generatedCode,
    advisor,
    serial,
  };
}
