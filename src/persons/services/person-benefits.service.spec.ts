import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  EntityNotFoundException,
  InvalidDomainOperationException,
} from '../../common/exceptions/domain-exceptions';
import { ContractPersonExclusion } from '../../contracts/entities/contract-person-exclusion.entity';
import { ExclusionSource } from '../../contracts/entities/exclusion-source.enum';
import { ContractPerson, PersonRole } from '../../contracts/entities/contract-person.entity';
import { Contract, ContractStatus } from '../../contracts/entities/contract.entity';
import { PlanService, PlanServiceLimitType } from '../../plans/entities/plan-service.entity';
import { Plan, PlanStatus } from '../../plans/entities/plan.entity';
import { Person, PersonStatus, TypeIdentityCard } from '../entities/person.entity';
import { PersonBenefitsService } from './person-benefits.service';

describe('PersonBenefitsService', () => {
  let service: PersonBenefitsService;
  let personRepo: jest.Mocked<Repository<Person>>;
  let contractPersonRepo: jest.Mocked<Repository<ContractPerson>>;
  let planServiceRepo: jest.Mocked<Repository<PlanService>>;
  let exclusionRepo: jest.Mocked<Repository<ContractPersonExclusion>>;

  const mockPersonId = '11111111-1111-1111-1111-111111111111';
  const mockContractId = '22222222-2222-2222-2222-222222222222';
  const mockPlanId = '33333333-3333-3333-3333-333333333333';
  const mockContractPersonId = '44444444-4444-4444-4444-444444444444';

  const mockPerson: Person = {
    id: mockPersonId,
    typeIdentityCard: TypeIdentityCard.V,
    identityCard: '12345678',
    name: 'Juan Alberto Pérez Gómez',
    status: PersonStatus.ACTIVE,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    deletedAt: null,
    contractPersons: [],
  } as unknown as Person;

  const mockPlan: Plan = {
    id: mockPlanId,
    name: 'Plan Oro Especial',
    maxAge: 65,
    minAge: 0,
    amount: 50,
    commissionAmount: 5,
    coverage: 10000,
    minMonths: 2,
    status: PlanStatus.ACTIVE,
    persons: [],
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    deletedAt: null,
  } as unknown as Plan;

  const mockContract: Contract = {
    id: mockContractId,
    code: 'CTR-2026-001',
    status: ContractStatus.ACTIVE,
    affiliationDate: new Date('2026-01-01'),
    cutoffDay: 5,
    retentionPercentage: 0,
    advisorCommission: 0,
    excludeFromNextBilling: false,
    monthlyAmount: 50,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    contractPersons: [],
  } as unknown as Contract;

  const mockContractPerson: ContractPerson = {
    id: mockContractPersonId,
    contract: mockContract,
    person: mockPerson,
    plan: mockPlan,
    role: PersonRole.TITULAR,
    isBillingOwner: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  } as unknown as ContractPerson;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonBenefitsService,
        {
          provide: getRepositoryToken(Person),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(ContractPerson),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(PlanService),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(ContractPersonExclusion),
          useValue: {
            find: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PersonBenefitsService>(PersonBenefitsService);
    personRepo = module.get(getRepositoryToken(Person));
    contractPersonRepo = module.get(getRepositoryToken(ContractPerson));
    planServiceRepo = module.get(getRepositoryToken(PlanService));
    exclusionRepo = module.get(getRepositoryToken(ContractPersonExclusion));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Validation & Error Scenarios', () => {
    it('should throw EntityNotFoundException (404) when person does not exist', async () => {
      personRepo.findOne.mockResolvedValue(null);

      await expect(service.getPersonBenefits('non-existent-id')).rejects.toThrow(
        EntityNotFoundException,
      );
      expect(personRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'non-existent-id' },
      });
    });

    it('should throw InvalidDomainOperationException (400) when person has no contract persons', async () => {
      personRepo.findOne.mockResolvedValue(mockPerson);
      contractPersonRepo.find.mockResolvedValue([]);

      await expect(service.getPersonBenefits(mockPersonId)).rejects.toThrow(
        InvalidDomainOperationException,
      );
      await expect(service.getPersonBenefits(mockPersonId)).rejects.toThrow(
        'La persona no posee un contrato activo en el sistema.',
      );
    });

    it('should throw InvalidDomainOperationException (400) when person has contracts but none are ACTIVE', async () => {
      personRepo.findOne.mockResolvedValue(mockPerson);
      const inactiveCp = {
        ...mockContractPerson,
        contract: { ...mockContract, status: ContractStatus.INACTIVE },
      } as ContractPerson;
      contractPersonRepo.find.mockResolvedValue([inactiveCp]);

      await expect(service.getPersonBenefits(mockPersonId)).rejects.toThrow(
        InvalidDomainOperationException,
      );
    });

    it('should throw InvalidDomainOperationException (400) when contract exists but has no plan assigned', async () => {
      personRepo.findOne.mockResolvedValue(mockPerson);
      const cpWithoutPlan = {
        ...mockContractPerson,
        plan: null,
        person: { ...mockPerson, plan: null } as unknown as Person,
      } as ContractPerson;
      contractPersonRepo.find.mockResolvedValue([cpWithoutPlan]);

      await expect(service.getPersonBenefits(mockPersonId)).rejects.toThrow(
        'El afiliado no posee un plan de salud asignado en su contrato activo.',
      );
    });
  });

  describe('Contract and Plan Resolution', () => {
    it('should fallback to person.plan when contractPerson.plan is null', async () => {
      personRepo.findOne.mockResolvedValue(mockPerson);
      const cpWithPersonPlan = {
        ...mockContractPerson,
        plan: null,
        person: { ...mockPerson, plan: mockPlan } as unknown as Person,
      } as ContractPerson;

      contractPersonRepo.find.mockResolvedValue([cpWithPersonPlan]);
      planServiceRepo.find.mockResolvedValue([]);
      exclusionRepo.find.mockResolvedValue([]);

      const result = await service.getPersonBenefits(mockPersonId);

      expect(result).toBeDefined();
      expect(result.plan.id).toBe(mockPlanId);
      expect(result.plan.name).toBe('Plan Oro Especial');
      expect(result.plan.code).toBe('Plan Oro Especial');
    });

    it('should pick the latest active contract by affiliationDate and createdAt when multiple exist', async () => {
      personRepo.findOne.mockResolvedValue(mockPerson);

      const olderContract: Contract = {
        ...mockContract,
        id: 'older-contract-id',
        code: 'CTR-OLD',
        affiliationDate: new Date('2024-01-01'),
      } as Contract;
      const olderCp: ContractPerson = {
        ...mockContractPerson,
        id: 'older-cp-id',
        contract: olderContract,
        createdAt: new Date('2024-01-01'),
      } as ContractPerson;

      const newerContract: Contract = {
        ...mockContract,
        id: 'newer-contract-id',
        code: 'CTR-NEW',
        affiliationDate: new Date('2026-05-01'),
      } as Contract;
      const newerCp: ContractPerson = {
        ...mockContractPerson,
        id: 'newer-cp-id',
        contract: newerContract,
        createdAt: new Date('2026-05-01'),
      } as ContractPerson;

      const sameDateContract1: Contract = {
        ...mockContract,
        id: 'same-date-1',
        code: 'CTR-SAME-1',
        affiliationDate: new Date('2026-05-01'),
      } as Contract;
      const sameDateCp1: ContractPerson = {
        ...mockContractPerson,
        id: 'same-cp-1',
        contract: sameDateContract1,
        createdAt: new Date('2026-05-02'),
      } as ContractPerson;

      contractPersonRepo.find.mockResolvedValue([olderCp, newerCp, sameDateCp1]);
      planServiceRepo.find.mockResolvedValue([]);
      exclusionRepo.find.mockResolvedValue([]);

      const result = await service.getPersonBenefits(mockPersonId);

      expect(result.contract.id).toBe('same-date-1');
      expect(result.contract.code).toBe('CTR-SAME-1');
    });

    it('should correctly handle contractPerson sorting when createdAt is undefined', async () => {
      personRepo.findOne.mockResolvedValue(mockPerson);
      const cp1: ContractPerson = {
        ...mockContractPerson,
        contract: { ...mockContract, affiliationDate: new Date('2026-01-01') },
        createdAt: undefined as unknown as Date,
      } as ContractPerson;
      const cp2: ContractPerson = {
        ...mockContractPerson,
        contract: { ...mockContract, affiliationDate: new Date('2026-01-01') },
        createdAt: new Date('2026-01-02'),
      } as ContractPerson;

      contractPersonRepo.find.mockResolvedValue([cp1, cp2]);
      planServiceRepo.find.mockResolvedValue([]);
      exclusionRepo.find.mockResolvedValue([]);

      const result = await service.getPersonBenefits(mockPersonId);
      expect(result).toBeDefined();
    });
  });

  describe('Tri-State Hierarchy Classification', () => {
    const medicalService1 = {
      id: 'srv-cardio-1',
      code: 'CARDIO-01',
      name: 'Consulta de Cardiología',
      categoryId: 'cat-cardio',
      category: { id: 'cat-cardio', name: 'Cardiología' },
    };

    const medicalService2 = {
      id: 'srv-trauma-2',
      code: 'TRAUMA-01',
      name: 'Traumatología General',
      categoryId: 'cat-trauma',
      category: { id: 'cat-trauma', name: 'Traumatología' },
    };

    const medicalService3 = {
      id: 'srv-pedia-3',
      code: 'PEDIA-01',
      name: 'Pediatría Preventiva',
      categoryId: 'cat-pedia',
      category: { id: 'cat-pedia', name: 'Pediatría' },
    };

    const medicalService4 = {
      id: 'srv-onc-4',
      code: 'ONC-01',
      name: 'Oncología Médica',
      categoryId: 'cat-onc',
      category: { id: 'cat-onc', name: 'Oncología' },
    };

    it('should classify services into EXCLUDED, WAITING_PERIOD, and COVERED correctly', async () => {
      personRepo.findOne.mockResolvedValue(mockPerson);

      // Affiliation date is 45 days ago
      const fortyFiveDaysAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      const contract45Days: Contract = {
        ...mockContract,
        affiliationDate: fortyFiveDaysAgo as unknown as Date,
      } as Contract;

      const cp: ContractPerson = {
        ...mockContractPerson,
        contract: contract45Days,
      } as ContractPerson;

      contractPersonRepo.find.mockResolvedValue([cp]);

      // Plan services:
      // 1. Cardio: has exclusion on service -> EXCLUDED (precedence 1 even if waiting period expired)
      // 2. Trauma: has exclusion on category -> EXCLUDED (precedence 1)
      // 3. Pedia: 90 days waiting period (elapsed 45 < 90) -> WAITING_PERIOD (precedence 2)
      // 4. Onc: 30 days waiting period (elapsed 45 >= 30) -> COVERED (precedence 3)
      const mockPlanServices: PlanService[] = [
        {
          id: 'ps-1',
          planId: mockPlanId,
          medicalServiceId: medicalService1.id,
          medicalService: medicalService1 as unknown,
          limitType: PlanServiceLimitType.MONTHLY,
          limitQuantity: 2,
          waitingPeriodDays: 30,
          copayAmount: 15.5,
          copayPercentage: 10,
        } as unknown as PlanService,
        {
          id: 'ps-2',
          planId: mockPlanId,
          medicalServiceId: medicalService2.id,
          medicalService: medicalService2 as unknown,
          limitType: PlanServiceLimitType.ANNUAL,
          limitQuantity: 10,
          waitingPeriodDays: 0,
          copayAmount: 0,
          copayPercentage: 0,
        } as unknown as PlanService,
        {
          id: 'ps-3',
          planId: mockPlanId,
          medicalServiceId: medicalService3.id,
          medicalService: medicalService3 as unknown,
          limitType: PlanServiceLimitType.UNLIMITED,
          limitQuantity: null,
          waitingPeriodDays: 90,
          copayAmount: 0,
          copayPercentage: 0,
        } as unknown as PlanService,
        {
          id: 'ps-4',
          planId: mockPlanId,
          medicalServiceId: medicalService4.id,
          medicalService: medicalService4 as unknown,
          limitType: PlanServiceLimitType.UNLIMITED,
          limitQuantity: null,
          waitingPeriodDays: 30,
          copayAmount: 25,
          copayPercentage: 20,
        } as unknown as PlanService,
      ];

      planServiceRepo.find.mockResolvedValue(mockPlanServices);

      // Exclusions
      const mockExclusions: ContractPersonExclusion[] = [
        {
          id: 'ex-1',
          contractPersonId: mockContractPersonId,
          medicalServiceId: medicalService1.id,
          reason: 'Patología cardiovascular previa declarada',
          source: ExclusionSource.AUTOMATIC,
        } as ContractPersonExclusion,
        {
          id: 'ex-2',
          contractPersonId: mockContractPersonId,
          serviceCategoryId: 'cat-trauma',
          reason: 'Exclusión de categoría traumatología por criterio médico',
          source: ExclusionSource.MANUAL,
        } as ContractPersonExclusion,
      ];

      exclusionRepo.find.mockResolvedValue(mockExclusions);

      const result = await service.getPersonBenefits(mockPersonId);

      expect(result).toBeDefined();
      expect(result.affiliationDaysElapsed).toBeGreaterThanOrEqual(44);
      expect(result.services).toHaveLength(4);

      // 1. Cardio: EXCLUDED
      const cardio = result.services.find((s) => s.medicalServiceId === medicalService1.id)!;
      expect(cardio.status).toBe('EXCLUDED');
      expect(cardio.isCovered).toBe(false);
      expect(cardio.exclusionReason).toBe('Patología cardiovascular previa declarada');
      expect(cardio.exclusionSource).toBe(ExclusionSource.AUTOMATIC);
      expect(cardio.remainingWaitingPeriodDays).toBe(0);
      expect(cardio.effectiveDate).toBeNull();
      expect(cardio.limitType).toBe(PlanServiceLimitType.MONTHLY);
      expect(cardio.limitQuantity).toBe(2);
      expect(cardio.copayAmount).toBe(15.5);
      expect(cardio.copayPercentage).toBe(10);

      // 2. Trauma: EXCLUDED via category
      const trauma = result.services.find((s) => s.medicalServiceId === medicalService2.id)!;
      expect(trauma.status).toBe('EXCLUDED');
      expect(trauma.isCovered).toBe(false);
      expect(trauma.exclusionReason).toBe(
        'Exclusión de categoría traumatología por criterio médico',
      );
      expect(trauma.exclusionSource).toBe(ExclusionSource.MANUAL);
      expect(trauma.remainingWaitingPeriodDays).toBe(0);

      // 3. Pedia: WAITING_PERIOD (45 days elapsed < 90 days required)
      const pedia = result.services.find((s) => s.medicalServiceId === medicalService3.id)!;
      expect(pedia.status).toBe('WAITING_PERIOD');
      expect(pedia.isCovered).toBe(false);
      expect(pedia.remainingWaitingPeriodDays).toBe(90 - result.affiliationDaysElapsed);
      expect(pedia.effectiveDate).toBeInstanceOf(Date);
      expect(pedia.exclusionReason).toBeNull();
      expect(pedia.limitType).toBe(PlanServiceLimitType.UNLIMITED);
      expect(pedia.limitQuantity).toBeNull();

      // 4. Onc: COVERED (45 days elapsed >= 30 days required)
      const onc = result.services.find((s) => s.medicalServiceId === medicalService4.id)!;
      expect(onc.status).toBe('COVERED');
      expect(onc.isCovered).toBe(true);
      expect(onc.remainingWaitingPeriodDays).toBe(0);
      expect(onc.effectiveDate).toBeDefined();
      expect(onc.exclusionReason).toBeNull();
      expect(onc.copayAmount).toBe(25);
      expect(onc.copayPercentage).toBe(20);
    });

    it('should clamp negative elapsed days to 0 when affiliation date is in the future', async () => {
      personRepo.findOne.mockResolvedValue(mockPerson);
      const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      const cp: ContractPerson = {
        ...mockContractPerson,
        contract: { ...mockContract, affiliationDate: futureDate as unknown as Date },
      } as ContractPerson;

      contractPersonRepo.find.mockResolvedValue([cp]);
      planServiceRepo.find.mockResolvedValue([
        {
          id: 'ps-zero',
          planId: mockPlanId,
          medicalServiceId: 'srv-0',
          waitingPeriodDays: 0,
          copayAmount: 0,
          copayPercentage: 0,
        } as unknown as PlanService,
      ]);
      exclusionRepo.find.mockResolvedValue([]);

      const result = await service.getPersonBenefits(mockPersonId);
      expect(result.affiliationDaysElapsed).toBe(0);
      expect(result.services[0].status).toBe('COVERED');
    });
  });

  describe('Name and Metadata Extraction', () => {
    it('should extract firstName and lastName from entity firstName / lastName fields when present', async () => {
      const personWithSeparateNames = {
        ...mockPerson,
        firstName: 'Carlos',
        lastName: 'Ramírez',
      };
      personRepo.findOne.mockResolvedValue(personWithSeparateNames as unknown as Person);
      contractPersonRepo.find.mockResolvedValue([mockContractPerson]);
      planServiceRepo.find.mockResolvedValue([]);
      exclusionRepo.find.mockResolvedValue([]);

      const result = await service.getPersonBenefits(mockPersonId);

      expect(result.person.firstName).toBe('Carlos');
      expect(result.person.lastName).toBe('Ramírez');
    });

    it('should extract single word name as firstName with empty lastName', async () => {
      const personSingleName = {
        ...mockPerson,
        name: 'Cher',
      };
      personRepo.findOne.mockResolvedValue(personSingleName as unknown as Person);
      contractPersonRepo.find.mockResolvedValue([mockContractPerson]);
      planServiceRepo.find.mockResolvedValue([]);
      exclusionRepo.find.mockResolvedValue([]);

      const result = await service.getPersonBenefits(mockPersonId);

      expect(result.person.firstName).toBe('Cher');
      expect(result.person.lastName).toBe('');
    });

    it('should handle plan with code and description metadata', async () => {
      personRepo.findOne.mockResolvedValue(mockPerson);
      const planWithMeta = {
        ...mockPlan,
        code: 'PLN-GOLD-001',
        description: 'Plan con cobertura completa y beneficios odontológicos',
      };
      const cpWithMetaPlan = {
        ...mockContractPerson,
        plan: planWithMeta,
      } as unknown as ContractPerson;

      contractPersonRepo.find.mockResolvedValue([cpWithMetaPlan]);
      planServiceRepo.find.mockResolvedValue([]);
      exclusionRepo.find.mockResolvedValue([]);

      const result = await service.getPersonBenefits(mockPersonId);

      expect(result.plan.code).toBe('PLN-GOLD-001');
      expect(result.plan.description).toBe(
        'Plan con cobertura completa y beneficios odontológicos',
      );
    });

    it('should handle planService with missing medicalService relation gracefully', async () => {
      personRepo.findOne.mockResolvedValue(mockPerson);
      contractPersonRepo.find.mockResolvedValue([mockContractPerson]);
      planServiceRepo.find.mockResolvedValue([
        {
          id: 'ps-bare',
          planId: mockPlanId,
          medicalServiceId: 'bare-srv-id',
          limitType: 'UNLIMITED',
          limitQuantity: undefined,
          waitingPeriodDays: 0,
        } as unknown as PlanService,
      ]);
      exclusionRepo.find.mockResolvedValue([]);

      const result = await service.getPersonBenefits(mockPersonId);

      expect(result.services).toHaveLength(1);
      expect(result.services[0].medicalServiceCode).toBe('');
      expect(result.services[0].medicalServiceName).toBe('');
      expect(result.services[0].serviceCategoryId).toBe('');
      expect(result.services[0].serviceCategoryName).toBe('');
      expect(result.services[0].limitQuantity).toBeNull();
      expect(result.services[0].copayAmount).toBe(0);
      expect(result.services[0].copayPercentage).toBe(0);
    });

    it('should handle person with only firstName or only lastName defined', async () => {
      // 1. Only firstName
      const personOnlyFirst = { ...mockPerson, firstName: 'Maria', lastName: undefined };
      personRepo.findOne.mockResolvedValue(personOnlyFirst as unknown as Person);
      contractPersonRepo.find.mockResolvedValue([mockContractPerson]);
      planServiceRepo.find.mockResolvedValue([]);
      exclusionRepo.find.mockResolvedValue([]);

      let result = await service.getPersonBenefits(mockPersonId);
      expect(result.person.firstName).toBe('Maria');
      expect(result.person.lastName).toBe('');

      // 2. Only lastName
      const personOnlyLast = { ...mockPerson, firstName: undefined, lastName: 'Gómez' };
      personRepo.findOne.mockResolvedValue(personOnlyLast as unknown as Person);
      result = await service.getPersonBenefits(mockPersonId);
      expect(result.person.firstName).toBe('');
      expect(result.person.lastName).toBe('Gómez');

      // 3. Neither firstName/lastName nor name defined
      const personNoName = { ...mockPerson, firstName: undefined, lastName: undefined, name: '' };
      personRepo.findOne.mockResolvedValue(personNoName as unknown as Person);
      result = await service.getPersonBenefits(mockPersonId);
      expect(result.person.firstName).toBe('');
      expect(result.person.lastName).toBe('');

      // 4. Whitespace-only name
      const personWhitespace = {
        ...mockPerson,
        firstName: undefined,
        lastName: undefined,
        name: '   ',
      };
      personRepo.findOne.mockResolvedValue(personWhitespace as unknown as Person);
      result = await service.getPersonBenefits(mockPersonId);
      expect(result.person.firstName).toBe('');
      expect(result.person.lastName).toBe('');
    });

    it('should handle sorting when b.createdAt is undefined and a.createdAt is defined', async () => {
      personRepo.findOne.mockResolvedValue(mockPerson);
      const cp1: ContractPerson = {
        ...mockContractPerson,
        contract: { ...mockContract, affiliationDate: new Date('2026-01-01') },
        createdAt: new Date('2026-01-02'),
      } as ContractPerson;
      const cp2: ContractPerson = {
        ...mockContractPerson,
        contract: { ...mockContract, affiliationDate: new Date('2026-01-01') },
        createdAt: undefined as unknown as Date,
      } as ContractPerson;

      contractPersonRepo.find.mockResolvedValue([cp1, cp2]);
      planServiceRepo.find.mockResolvedValue([]);
      exclusionRepo.find.mockResolvedValue([]);

      const result = await service.getPersonBenefits(mockPersonId);
      expect(result).toBeDefined();
    });

    it('should handle planService when waitingPeriodDays, copayAmount, copayPercentage are undefined', async () => {
      personRepo.findOne.mockResolvedValue(mockPerson);
      contractPersonRepo.find.mockResolvedValue([mockContractPerson]);
      planServiceRepo.find.mockResolvedValue([
        {
          id: 'ps-undefined-vals',
          planId: mockPlanId,
          medicalServiceId: 'srv-undef',
          waitingPeriodDays: undefined as unknown as number,
          copayAmount: undefined as unknown as number,
          copayPercentage: undefined as unknown as number,
          medicalService: {
            id: 'srv-undef',
            code: 'UNDEF',
            name: 'Undef Srv',
            categoryId: undefined,
            category: undefined,
          },
        } as unknown as PlanService,
      ]);
      exclusionRepo.find.mockResolvedValue([]);

      const result = await service.getPersonBenefits(mockPersonId);
      expect(result.services[0].waitingPeriodDays).toBe(0);
      expect(result.services[0].copayAmount).toBe(0);
      expect(result.services[0].copayPercentage).toBe(0);
      expect(result.services[0].status).toBe('COVERED');
    });
  });
});
