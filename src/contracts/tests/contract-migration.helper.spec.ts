import { EntityManager } from 'typeorm';
import { Person } from '../../persons/entities/person.entity';
import { AffiliationHistory } from '../entities/affiliation-history.entity';
import { ContractPerson } from '../entities/contract-person.entity';
import { ContractStatus } from '../entities/contract.entity';
import { AffiliationAction } from '../enums/affiliation-action.enum';
import { migrateFromInactiveContracts } from '../helpers/contract-migration.helper';

describe('migrateFromInactiveContracts', () => {
  let mockManager: jest.Mocked<EntityManager>;
  let mockCpRepo: Record<string, jest.Mock>;
  let mockHistoryRepo: Record<string, jest.Mock>;

  beforeEach(() => {
    mockCpRepo = {
      find: jest.fn(),
      softRemove: jest.fn().mockResolvedValue(true),
    };
    mockHistoryRepo = {
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation(async (entity) => entity),
    };

    mockManager = {
      getRepository: jest.fn().mockImplementation((target) => {
        if (target === ContractPerson) return mockCpRepo;
        if (target === AffiliationHistory) return mockHistoryRepo;
        return {};
      }),
    } as unknown as jest.Mocked<EntityManager>;
  });

  it('should return null affiliationReason if no inactive affiliations exist', async () => {
    mockCpRepo.find.mockResolvedValue([]);

    const person = { id: 'person-1', name: 'Carlos' } as Person;
    const result = await migrateFromInactiveContracts(mockManager, person, 'SIR-001-00002');

    expect(mockCpRepo.find).toHaveBeenCalledWith({
      where: {
        person: { id: 'person-1' },
        contract: { status: ContractStatus.INACTIVE },
      },
      relations: ['contract', 'person', 'person.plan', 'plan'],
    });
    expect(result.affiliationReason).toBeNull();
    expect(mockHistoryRepo.save).not.toHaveBeenCalled();
    expect(mockCpRepo.softRemove).not.toHaveBeenCalled();
  });

  it('should record CAMBIO_CONTRATO, soft-remove old contractPersons and return source codes', async () => {
    const oldCp1 = {
      id: 'cp-old-1',
      contract: { id: 'c-old-1', code: 'SIR-001-00001' },
      person: { id: 'person-1', plan: { amount: 25 } },
      plan: { amount: 25 },
    };
    const oldCp2 = {
      id: 'cp-old-2',
      contract: { id: 'c-old-2', code: 'SIR-002-00005' },
      person: { id: 'person-1', plan: { amount: 30 } },
      plan: null,
    };

    mockCpRepo.find.mockResolvedValue([oldCp1, oldCp2]);

    const person = { id: 'person-1', name: 'Carlos' } as Person;
    const result = await migrateFromInactiveContracts(mockManager, person, 'SIR-003-00010');

    expect(result.affiliationReason).toBe('Proveniente del contrato SIR-001-00001, SIR-002-00005');
    expect(mockHistoryRepo.save).toHaveBeenCalledTimes(2);
    expect(mockHistoryRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AffiliationAction.CAMBIO_CONTRATO,
        amount: 25,
        reason: 'Migrado al contrato SIR-003-00010',
      }),
    );
    expect(mockCpRepo.softRemove).toHaveBeenCalledWith(oldCp1);
    expect(mockCpRepo.softRemove).toHaveBeenCalledWith(oldCp2);
  });
});
