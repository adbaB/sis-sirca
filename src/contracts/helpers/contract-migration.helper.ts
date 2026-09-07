import { EntityManager } from 'typeorm';
import { Person } from '../../persons/entities/person.entity';
import { AffiliationHistory } from '../entities/affiliation-history.entity';
import { ContractPerson } from '../entities/contract-person.entity';
import { ContractStatus } from '../entities/contract.entity';
import { AffiliationAction } from '../enums/affiliation-action.enum';

export interface MigrationResult {
  /** Reason text describing source contracts, or null if no migration occurred */
  affiliationReason: string | null;
}

/**
 * Handles migration of a person from inactive contracts to a new contract.
 * Records CAMBIO_CONTRATO history entries and soft-removes old contract-person junctions.
 *
 * @param manager - Transactional EntityManager
 * @param person - The person being migrated
 * @param targetContractCode - The code of the new contract receiving the person
 */
export async function migrateFromInactiveContracts(
  manager: EntityManager,
  person: Person,
  targetContractCode: string,
): Promise<MigrationResult> {
  const cpRepo = manager.getRepository(ContractPerson);
  const historyRepo = manager.getRepository(AffiliationHistory);

  const inactiveAffiliations = await cpRepo.find({
    where: {
      person: { id: person.id },
      contract: { status: ContractStatus.INACTIVE },
    },
    relations: ['contract', 'person', 'person.plan', 'plan'],
  });

  for (const oldCp of inactiveAffiliations) {
    await historyRepo.save(
      historyRepo.create({
        contract: oldCp.contract,
        person,
        plan: oldCp.plan ?? oldCp.person?.plan ?? null,
        action: AffiliationAction.CAMBIO_CONTRATO,
        amount: Number(oldCp.plan?.amount ?? oldCp.person?.plan?.amount ?? 0),
        reason: `Migrado al contrato ${targetContractCode}`,
      }),
    );
    await cpRepo.softRemove(oldCp);
  }

  let affiliationReason: string | null = null;
  if (inactiveAffiliations.length > 0) {
    const oldCodes = inactiveAffiliations.map((cp) => cp.contract.code).join(', ');
    affiliationReason = `Proveniente del contrato ${oldCodes}`;
  }

  return { affiliationReason };
}
