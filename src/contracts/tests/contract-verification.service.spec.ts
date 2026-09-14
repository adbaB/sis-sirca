import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Person, PersonStatus, TypeIdentityCard } from '../../persons/entities/person.entity';
import { PersonsService } from '../../persons/services/persons.service';
import { ContractPerson, Parentesco, PersonRole } from '../entities/contract-person.entity';
import { Contract, ContractStatus } from '../entities/contract.entity';
import {
  ContractVerificationResult,
  PersonVerificationResult,
  VerificationMode,
} from '../interfaces/person-verification.interface';
import { ContractVerificationService } from '../services/contract-verification.service';

describe('ContractVerificationService', () => {
  let service: ContractVerificationService;
  let contractsRepository: jest.Mocked<Repository<Contract>>;
  let contractPersonsRepository: jest.Mocked<Repository<ContractPerson>>;
  let personsService: jest.Mocked<PersonsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractVerificationService,
        {
          provide: getRepositoryToken(Contract),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(ContractPerson),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: PersonsService,
          useValue: {
            findByIdentityCard: jest.fn(),
            findByIdentityCardOnly: jest.fn(),
            findPNsByTitularIdentityCard: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ContractVerificationService>(ContractVerificationService);
    contractsRepository = module.get(getRepositoryToken(Contract));
    contractPersonsRepository = module.get(getRepositoryToken(ContractPerson));
    personsService = module.get(PersonsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('verifyPersonAffiliation', () => {
    it('should throw NotFoundException if person is not found', async () => {
      jest.spyOn(personsService, 'findByIdentityCard').mockResolvedValue(null);

      await expect(service.verifyPersonAffiliation(TypeIdentityCard.V, '99999999')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return person with empty beneficiaryContracts and ownerContracts if person has no affiliations', async () => {
      const mockPerson = {
        id: 'p-1',
        name: 'Carlos Ruiz',
        typeIdentityCard: TypeIdentityCard.V,
        identityCard: '12345678',
        phone: '04121234567',
        birthDate: new Date('1990-01-01'),
        status: PersonStatus.ACTIVE,
      } as Person;

      jest.spyOn(personsService, 'findByIdentityCard').mockResolvedValue(mockPerson);
      // Both queries (for AFILIADO and for TITULAR/isBillingOwner) return empty
      jest.spyOn(contractPersonsRepository, 'find').mockResolvedValue([]);

      const result = await service.verifyPersonAffiliation(TypeIdentityCard.V, '12345678');

      expect(result.mode).toBe(VerificationMode.BY_PERSON);
      expect(result.person.id).toBe('p-1');
      expect(result.beneficiaryContracts).toHaveLength(0);
      expect(result.ownerContracts).toHaveLength(0);
    });

    it('should return and prioritize beneficiaryContracts (ACTIVE first, then SUSPENDED, then INACTIVE)', async () => {
      const mockPerson = {
        id: 'p-1',
        name: 'Carlos Ruiz',
        typeIdentityCard: TypeIdentityCard.V,
        identityCard: '12345678',
        status: PersonStatus.ACTIVE,
      } as Person;

      const mockAffiliations = [
        {
          id: 'cp-old',
          role: PersonRole.AFILIADO,
          contract: {
            id: 'c-old',
            code: 'SIR-001-00001',
            status: ContractStatus.INACTIVE,
            affiliationDate: new Date('2024-01-01'),
          },
          plan: { name: 'Plan Básico' },
        },
        {
          id: 'cp-suspended',
          role: PersonRole.AFILIADO,
          contract: {
            id: 'c-susp',
            code: 'SIR-001-00002',
            status: ContractStatus.SUSPENDED,
            affiliationDate: new Date('2025-06-01'),
          },
          plan: { name: 'Plan Plus' },
        },
        {
          id: 'cp-active',
          role: PersonRole.AFILIADO,
          contract: {
            id: 'c-act',
            code: 'SIR-001-00003',
            status: ContractStatus.ACTIVE,
            affiliationDate: new Date('2026-01-01'),
          },
          plan: { name: 'Plan Premium' },
        },
      ] as unknown as ContractPerson[];

      jest.spyOn(personsService, 'findByIdentityCard').mockResolvedValue(mockPerson);
      // First call for AFILIADO returns mockAffiliations, second call for TITULAR/Billing returns empty
      jest
        .spyOn(contractPersonsRepository, 'find')
        .mockResolvedValueOnce(mockAffiliations)
        .mockResolvedValueOnce([]);

      const result = await service.verifyPersonAffiliation(TypeIdentityCard.V, '12345678');

      expect(result.mode).toBe(VerificationMode.BY_PERSON);
      expect(result.beneficiaryContracts).toHaveLength(3);

      expect(result.beneficiaryContracts[0].code).toBe('SIR-001-00003');
      expect(result.beneficiaryContracts[0].status).toBe(ContractStatus.ACTIVE);
      expect(result.beneficiaryContracts[0].isSuspended).toBe(false);
      expect(result.beneficiaryContracts[0].isEligible).toBe(true);

      expect(result.beneficiaryContracts[1].code).toBe('SIR-001-00002');
      expect(result.beneficiaryContracts[1].status).toBe(ContractStatus.SUSPENDED);
      expect(result.beneficiaryContracts[1].isSuspended).toBe(true);
      expect(result.beneficiaryContracts[1].isEligible).toBe(false);

      expect(result.beneficiaryContracts[2].code).toBe('SIR-001-00001');
      expect(result.beneficiaryContracts[2].status).toBe(ContractStatus.INACTIVE);
      expect(result.beneficiaryContracts[2].isSuspended).toBe(false);
      expect(result.beneficiaryContracts[2].isEligible).toBe(false);

      expect(result.ownerContracts).toHaveLength(0);
    });

    it('should return ownerContracts with beneficiaries when person is TITULAR', async () => {
      const mockPerson = {
        id: 'p-titular-1',
        name: 'Maria Titular',
        typeIdentityCard: TypeIdentityCard.V,
        identityCard: '15555555',
        status: PersonStatus.ACTIVE,
      } as Person;

      // First query: AFILIADO -> empty
      // Second query: TITULAR/BillingOwner -> returns affiliation as TITULAR
      const mockOwnerAffiliations = [
        {
          id: 'cp-owner-1',
          role: PersonRole.TITULAR,
          isBillingOwner: true,
          contract: { id: 'c-100' },
        },
      ] as unknown as ContractPerson[];

      const mockFullContract = {
        id: 'c-100',
        code: 'SIR-005-00010',
        status: ContractStatus.ACTIVE,
        affiliationDate: new Date('2026-02-01'),
        cutoffDay: 15,
        contractPersons: [
          {
            id: 'cp-owner-1',
            role: PersonRole.TITULAR,
            isBillingOwner: true,
            person: mockPerson,
          },
          {
            id: 'cp-ben-1',
            role: PersonRole.AFILIADO,
            relationship: Parentesco.HIJA,
            person: {
              id: 'p-ben-1',
              name: 'Hija Activa',
              typeIdentityCard: TypeIdentityCard.V,
              identityCard: '28111222',
              status: PersonStatus.ACTIVE,
            },
            plan: { name: 'Plan Familiar' },
          },
        ],
      } as unknown as Contract;

      jest.spyOn(personsService, 'findByIdentityCard').mockResolvedValue(mockPerson);
      jest
        .spyOn(contractPersonsRepository, 'find')
        .mockResolvedValueOnce([]) // AFILIADO query
        .mockResolvedValueOnce(mockOwnerAffiliations); // TITULAR / Billing query
      jest.spyOn(contractsRepository, 'find').mockResolvedValueOnce([mockFullContract]);

      const result = await service.verifyPersonAffiliation(TypeIdentityCard.V, '15555555');

      expect(result.mode).toBe(VerificationMode.BY_PERSON);
      expect(result.beneficiaryContracts).toHaveLength(0);
      expect(result.ownerContracts).toHaveLength(1);

      const ownerContract = result.ownerContracts[0];
      expect(ownerContract.code).toBe('SIR-005-00010');
      expect(ownerContract.isTitular).toBe(true);
      expect(ownerContract.isBillingOwner).toBe(true);
      expect(ownerContract.titular?.name).toBe('Maria Titular');
      expect(ownerContract.totalBeneficiaries).toBe(1);
      expect(ownerContract.beneficiaries[0].name).toBe('Hija Activa');
      expect(ownerContract.beneficiaries[0].isEligible).toBe(true);
      expect(ownerContract.beneficiaries[0].relationship).toBe(Parentesco.HIJA);
    });

    it('should return ownerContracts when person is isBillingOwner = true (e.g. corporate RIF)', async () => {
      const mockCompany = {
        id: 'p-company-1',
        name: 'Inversiones ABC C.A.',
        typeIdentityCard: TypeIdentityCard.J,
        identityCard: '301234567',
        status: PersonStatus.ACTIVE,
      } as Person;

      // Company is isBillingOwner = true, but role might be AFILIADO or not TITULAR
      const mockOwnerAffiliations = [
        {
          id: 'cp-billing-1',
          role: PersonRole.AFILIADO,
          isBillingOwner: true,
          contract: { id: 'c-corp-1' },
        },
      ] as unknown as ContractPerson[];

      const mockCorpContract = {
        id: 'c-corp-1',
        code: 'SIR-009-00999',
        status: ContractStatus.ACTIVE,
        affiliationDate: new Date('2026-03-01'),
        cutoffDay: 5,
        contractPersons: [
          {
            id: 'cp-billing-1',
            role: PersonRole.AFILIADO,
            isBillingOwner: true,
            person: mockCompany,
          },
          {
            id: 'cp-worker-1',
            role: PersonRole.AFILIADO,
            isBillingOwner: false,
            relationship: Parentesco.OTRO,
            person: {
              id: 'p-worker-1',
              name: 'Empleado 1',
              typeIdentityCard: TypeIdentityCard.V,
              identityCard: '19876543',
              status: PersonStatus.ACTIVE,
            },
            plan: { name: 'Plan Corporativo' },
          },
        ],
      } as unknown as Contract;

      jest.spyOn(personsService, 'findByIdentityCard').mockResolvedValue(mockCompany);
      jest
        .spyOn(contractPersonsRepository, 'find')
        .mockResolvedValueOnce([]) // AFILIADO query without billing filter
        .mockResolvedValueOnce(mockOwnerAffiliations); // TITULAR or Billing query
      jest.spyOn(contractsRepository, 'find').mockResolvedValueOnce([mockCorpContract]);

      const result = await service.verifyPersonAffiliation(TypeIdentityCard.J, '301234567');

      expect(result.mode).toBe(VerificationMode.BY_PERSON);
      expect(result.ownerContracts).toHaveLength(1);
      expect(result.ownerContracts[0].isBillingOwner).toBe(true);
      expect(result.ownerContracts[0].isTitular).toBe(false);
      expect(result.ownerContracts[0].totalBeneficiaries).toBe(2);
    });

    it('should return BOTH beneficiaryContracts and ownerContracts for dual-role person', async () => {
      const mockPerson = {
        id: 'p-dual',
        name: 'Doble Rol',
        typeIdentityCard: TypeIdentityCard.V,
        identityCard: '20000000',
        status: PersonStatus.ACTIVE,
      } as Person;

      // 1. As AFILIADO in contract A
      const mockBeneficiaryAffiliations = [
        {
          id: 'cp-ben-a',
          role: PersonRole.AFILIADO,
          contract: {
            id: 'c-contract-a',
            code: 'SIR-A-001',
            status: ContractStatus.ACTIVE,
            affiliationDate: new Date('2025-01-01'),
          },
          plan: { name: 'Plan Personal' },
        },
      ] as unknown as ContractPerson[];

      // 2. As TITULAR in contract B
      const mockOwnerAffiliations = [
        {
          id: 'cp-owner-b',
          role: PersonRole.TITULAR,
          isBillingOwner: true,
          contract: { id: 'c-contract-b' },
        },
      ] as unknown as ContractPerson[];

      const mockFullContractB = {
        id: 'c-contract-b',
        code: 'SIR-B-002',
        status: ContractStatus.ACTIVE,
        affiliationDate: new Date('2026-01-01'),
        cutoffDay: 5,
        contractPersons: [
          {
            id: 'cp-owner-b',
            role: PersonRole.TITULAR,
            isBillingOwner: true,
            person: mockPerson,
          },
          {
            id: 'cp-b-ben-1',
            role: PersonRole.AFILIADO,
            relationship: Parentesco.ESPOSO,
            person: {
              id: 'p-esposo',
              name: 'Esposo',
              typeIdentityCard: TypeIdentityCard.V,
              identityCard: '19000000',
              status: PersonStatus.ACTIVE,
            },
            plan: { name: 'Plan Familiar' },
          },
        ],
      } as unknown as Contract;

      jest.spyOn(personsService, 'findByIdentityCard').mockResolvedValue(mockPerson);
      jest
        .spyOn(contractPersonsRepository, 'find')
        .mockResolvedValueOnce(mockBeneficiaryAffiliations)
        .mockResolvedValueOnce(mockOwnerAffiliations);
      jest.spyOn(contractsRepository, 'find').mockResolvedValueOnce([mockFullContractB]);

      const result = await service.verifyPersonAffiliation(TypeIdentityCard.V, '20000000');

      expect(result.mode).toBe(VerificationMode.BY_PERSON);
      expect(result.beneficiaryContracts).toHaveLength(1);
      expect(result.beneficiaryContracts[0].code).toBe('SIR-A-001');

      expect(result.ownerContracts).toHaveLength(1);
      expect(result.ownerContracts[0].code).toBe('SIR-B-002');
      expect(result.ownerContracts[0].beneficiaries).toHaveLength(1);
      expect(result.ownerContracts[0].beneficiaries[0].name).toBe('Esposo');
    });

    it('should batch-load multiple owner contracts with In(ids) without duplicates', async () => {
      const mockPerson = {
        id: 'p-multi-owner',
        name: 'Empresario Exitoso',
        typeIdentityCard: TypeIdentityCard.V,
        identityCard: '99887766',
        status: PersonStatus.ACTIVE,
      } as Person;

      const mockOwnerAffiliations = [
        {
          id: 'cp-1',
          role: PersonRole.TITULAR,
          isBillingOwner: false,
          contract: { id: 'c-1' },
        },
        {
          id: 'cp-2',
          role: PersonRole.TITULAR,
          isBillingOwner: true,
          contract: { id: 'c-2' },
        },
        // Duplicate contract ID occurrence
        {
          id: 'cp-1-extra',
          role: PersonRole.TITULAR,
          isBillingOwner: true,
          contract: { id: 'c-1' },
        },
      ] as unknown as ContractPerson[];

      const mockContracts = [
        {
          id: 'c-1',
          code: 'SIR-001',
          status: ContractStatus.ACTIVE,
          contractPersons: [],
        },
        {
          id: 'c-2',
          code: 'SIR-002',
          status: ContractStatus.ACTIVE,
          contractPersons: [],
        },
      ] as unknown as Contract[];

      jest.spyOn(personsService, 'findByIdentityCard').mockResolvedValue(mockPerson);
      jest
        .spyOn(contractPersonsRepository, 'find')
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(mockOwnerAffiliations);
      const findContractsSpy = jest
        .spyOn(contractsRepository, 'find')
        .mockResolvedValueOnce(mockContracts);

      const result = await service.verifyPersonAffiliation(TypeIdentityCard.V, '99887766');

      expect(findContractsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: In(['c-1', 'c-2']) },
        }),
      );
      expect(result.ownerContracts).toHaveLength(2);
      const c1 = result.ownerContracts.find((c) => c.id === 'c-1');
      expect(c1?.isTitular).toBe(true);
      expect(c1?.isBillingOwner).toBe(true);
    });

    it('should filter out soft-deleted beneficiaries where person is null in ownerContracts', async () => {
      const mockPerson = {
        id: 'p-owner',
        name: 'Titular Activo',
        typeIdentityCard: TypeIdentityCard.V,
        identityCard: '11223344',
        status: PersonStatus.ACTIVE,
      } as Person;

      const mockOwnerAffiliations = [
        {
          id: 'cp-owner',
          role: PersonRole.TITULAR,
          isBillingOwner: true,
          contract: { id: 'c-del-test' },
        },
      ] as unknown as ContractPerson[];

      const mockContract = {
        id: 'c-del-test',
        code: 'SIR-DEL-01',
        status: ContractStatus.ACTIVE,
        contractPersons: [
          {
            id: 'cp-owner',
            role: PersonRole.TITULAR,
            isBillingOwner: true,
            person: mockPerson,
          },
          // Soft-deleted person (TypeORM excluded person from join relation)
          {
            id: 'cp-deleted-beneficiary',
            role: PersonRole.AFILIADO,
            person: null,
          },
          // Valid active beneficiary
          {
            id: 'cp-valid-beneficiary',
            role: PersonRole.AFILIADO,
            person: {
              id: 'p-valid',
              name: 'Beneficiario Vivo',
              typeIdentityCard: TypeIdentityCard.V,
              identityCard: '99001122',
              status: PersonStatus.ACTIVE,
            },
          },
        ],
      } as unknown as Contract;

      jest.spyOn(personsService, 'findByIdentityCard').mockResolvedValue(mockPerson);
      jest
        .spyOn(contractPersonsRepository, 'find')
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(mockOwnerAffiliations);
      jest.spyOn(contractsRepository, 'find').mockResolvedValueOnce([mockContract]);

      const result = await service.verifyPersonAffiliation(TypeIdentityCard.V, '11223344');

      expect(result.ownerContracts).toHaveLength(1);
      const beneficiaries = result.ownerContracts[0].beneficiaries;
      expect(beneficiaries).toHaveLength(1);
      expect(beneficiaries[0].name).toBe('Beneficiario Vivo');
      expect(result.ownerContracts[0].totalBeneficiaries).toBe(1);
    });
  });

  describe('verifyContractByCode', () => {
    it('should throw NotFoundException if contract is not found', async () => {
      jest.spyOn(contractsRepository, 'findOne').mockResolvedValue(null);

      await expect(service.verifyContractByCode('SIR-404')).rejects.toThrow(NotFoundException);
    });

    it('should return contract details, titular and beneficiaries with eligibility', async () => {
      const mockContract = {
        id: 'c-1',
        code: 'SIR-001-00001',
        status: ContractStatus.ACTIVE,
        affiliationDate: new Date('2026-01-15'),
        cutoffDay: 5,
        contractPersons: [
          {
            id: 'cp-titular',
            role: PersonRole.TITULAR,
            isBillingOwner: true,
            person: {
              id: 'p-titular',
              name: 'Pedro Titular',
              typeIdentityCard: TypeIdentityCard.V,
              identityCard: '11111111',
              phone: '04141111111',
            },
          },
          {
            id: 'cp-beneficiary-1',
            role: PersonRole.AFILIADO,
            relationship: Parentesco.HIJO,
            person: {
              id: 'p-ben-1',
              name: 'Hijo Activo',
              typeIdentityCard: TypeIdentityCard.V,
              identityCard: '22222222',
              status: PersonStatus.ACTIVE,
            },
            plan: { name: 'Plan Familiar' },
          },
        ],
      } as unknown as Contract;

      jest.spyOn(contractsRepository, 'findOne').mockResolvedValue(mockContract);

      const result = await service.verifyContractByCode('SIR-001-00001');

      expect(result.mode).toBe(VerificationMode.BY_CONTRACT);
      expect(result.contract.code).toBe('SIR-001-00001');
      expect(result.contract.isSuspended).toBe(false);
      expect(result.contract.titular?.name).toBe('Pedro Titular');
      expect(result.totalBeneficiaries).toBe(1);
      expect(result.beneficiaries[0].name).toBe('Hijo Activo');
      expect(result.beneficiaries[0].isEligible).toBe(true);
    });

    it('should mark beneficiaries as isEligible: false when contract is SUSPENDED', async () => {
      const mockContract = {
        id: 'c-susp',
        code: 'SIR-001-00002',
        status: ContractStatus.SUSPENDED,
        affiliationDate: new Date('2026-01-15'),
        cutoffDay: 10,
        contractPersons: [
          {
            id: 'cp-beneficiary-1',
            role: PersonRole.AFILIADO,
            relationship: Parentesco.ESPOSA,
            person: {
              id: 'p-ben-2',
              name: 'Esposa',
              typeIdentityCard: TypeIdentityCard.V,
              identityCard: '33333333',
              status: PersonStatus.ACTIVE,
            },
            plan: { name: 'Plan Oro' },
          },
        ],
      } as unknown as Contract;

      jest.spyOn(contractsRepository, 'findOne').mockResolvedValue(mockContract);

      const result = await service.verifyContractByCode('SIR-001-00002');

      expect(result.contract.isSuspended).toBe(true);
      expect(result.beneficiaries[0].isEligible).toBe(false);
    });

    it('should prioritize TITULAR role over isBillingOwner when contract has both', async () => {
      const mockContract = {
        id: 'c-order-test',
        code: 'SIR-ORDER-01',
        status: ContractStatus.ACTIVE,
        contractPersons: [
          // isBillingOwner appears first in array
          {
            id: 'cp-billing-first',
            role: PersonRole.AFILIADO,
            isBillingOwner: true,
            person: {
              id: 'p-billing',
              name: 'Pagador Empresa',
              typeIdentityCard: TypeIdentityCard.J,
              identityCard: '30000000',
            },
          },
          // TITULAR appears second in array
          {
            id: 'cp-titular-second',
            role: PersonRole.TITULAR,
            isBillingOwner: false,
            person: {
              id: 'p-titular-real',
              name: 'Titular Legítimo',
              typeIdentityCard: TypeIdentityCard.V,
              identityCard: '10000000',
            },
          },
        ],
      } as unknown as Contract;

      jest.spyOn(contractsRepository, 'findOne').mockResolvedValue(mockContract);

      const result = await service.verifyContractByCode('SIR-ORDER-01');

      expect(result.contract.titular?.name).toBe('Titular Legítimo');
      expect(result.contract.titular?.identityCard).toBe('10000000');
    });
  });

  describe('verifyUnified', () => {
    it('should throw BadRequestException if query is empty or whitespace', async () => {
      await expect(service.verifyUnified('')).rejects.toThrow(BadRequestException);
      await expect(service.verifyUnified('   ')).rejects.toThrow(BadRequestException);
    });

    it('should auto-detect contract code and delegate to verifyContractByCode', async () => {
      jest.spyOn(contractsRepository, 'findOne').mockResolvedValueOnce({
        id: 'c-1',
        code: 'SIR-001-00001',
      } as Contract);

      const mockContractResult: ContractVerificationResult = {
        mode: VerificationMode.BY_CONTRACT,
        contract: {
          id: 'c-1',
          code: 'SIR-001-00001',
          status: ContractStatus.ACTIVE,
          isSuspended: false,
          affiliationDate: new Date(),
          cutoffDay: 5,
          titular: null,
        },
        beneficiaries: [],
        totalBeneficiaries: 0,
      };

      const spy = jest.spyOn(service, 'verifyContractByCode').mockResolvedValue(mockContractResult);

      const result = await service.verifyUnified('SIR-001-00001');

      expect(spy).toHaveBeenCalledWith('SIR-001-00001');
      expect(result.mode).toBe(VerificationMode.BY_CONTRACT);
    });

    it('should auto-detect document with prefix and delegate to verifyPersonAffiliation', async () => {
      jest.spyOn(contractsRepository, 'findOne').mockResolvedValueOnce(null);

      const mockPersonResult: PersonVerificationResult = {
        mode: VerificationMode.BY_PERSON,
        person: {
          id: 'p-1',
          name: 'Carlos Ruiz',
          typeIdentityCard: TypeIdentityCard.V,
          identityCard: '12345678',
          status: PersonStatus.ACTIVE,
        },
        beneficiaryContracts: [],
        ownerContracts: [],
      };

      const spy = jest
        .spyOn(service, 'verifyPersonAffiliation')
        .mockResolvedValue(mockPersonResult);

      const result = await service.verifyUnified('V-12345678');

      expect(spy).toHaveBeenCalledWith(TypeIdentityCard.V, '12345678');
      expect(result.mode).toBe(VerificationMode.BY_PERSON);
    });

    it('should auto-detect PN document with prefix (PN-12345678-1) and delegate to verifyPersonAffiliation with TypeIdentityCard.PN', async () => {
      jest.spyOn(contractsRepository, 'findOne').mockResolvedValueOnce(null);

      const mockPNResult: PersonVerificationResult = {
        mode: VerificationMode.BY_PERSON,
        person: {
          id: 'p-pn-1',
          name: 'Sofia Victoria Corona',
          typeIdentityCard: TypeIdentityCard.PN,
          identityCard: '19626778-1',
          status: PersonStatus.ACTIVE,
        },
        beneficiaryContracts: [],
        ownerContracts: [],
      };

      const spy = jest.spyOn(service, 'verifyPersonAffiliation').mockResolvedValue(mockPNResult);

      const result = await service.verifyUnified('PN-19626778-1');

      expect(spy).toHaveBeenCalledWith(TypeIdentityCard.PN, '19626778-1');
      expect(result.mode).toBe(VerificationMode.BY_PERSON);
    });

    it('should auto-detect PN document without prefix (19626778-1) via findByIdentityCardOnly', async () => {
      jest.spyOn(contractsRepository, 'findOne').mockResolvedValueOnce(null);

      const mockPNPerson = {
        id: 'p-pn-1',
        name: 'Sofia Victoria Corona',
        typeIdentityCard: TypeIdentityCard.PN,
        identityCard: '19626778-1',
        status: PersonStatus.ACTIVE,
      } as Person;

      const mockPNResult: PersonVerificationResult = {
        mode: VerificationMode.BY_PERSON,
        person: {
          id: 'p-pn-1',
          name: 'Sofia Victoria Corona',
          typeIdentityCard: TypeIdentityCard.PN,
          identityCard: '19626778-1',
          status: PersonStatus.ACTIVE,
        },
        beneficiaryContracts: [],
        ownerContracts: [],
      };

      jest.spyOn(personsService, 'findByIdentityCardOnly').mockResolvedValueOnce([mockPNPerson]);
      const spy = jest.spyOn(service, 'verifyPersonAffiliation').mockResolvedValue(mockPNResult);

      const result = await service.verifyUnified('19626778-1');

      expect(personsService.findByIdentityCardOnly).toHaveBeenCalledWith('19626778-1');
      expect(spy).toHaveBeenCalledWith(TypeIdentityCard.PN, '19626778-1');
      expect(result.mode).toBe(VerificationMode.BY_PERSON);
    });

    it('should fallback to PN when wrong prefix V is provided (V-19626778-1)', async () => {
      jest.spyOn(contractsRepository, 'findOne').mockResolvedValueOnce(null);

      const mockPNPerson = {
        id: 'p-pn-1',
        name: 'Sofia Victoria Corona',
        typeIdentityCard: TypeIdentityCard.PN,
        identityCard: '19626778-1',
        status: PersonStatus.ACTIVE,
      } as Person;

      const mockPNResult: PersonVerificationResult = {
        mode: VerificationMode.BY_PERSON,
        person: {
          id: 'p-pn-1',
          name: 'Sofia Victoria Corona',
          typeIdentityCard: TypeIdentityCard.PN,
          identityCard: '19626778-1',
          status: PersonStatus.ACTIVE,
        },
        beneficiaryContracts: [],
        ownerContracts: [],
      };

      const spy = jest
        .spyOn(service, 'verifyPersonAffiliation')
        .mockRejectedValueOnce(new NotFoundException())
        .mockResolvedValueOnce(mockPNResult);

      jest.spyOn(personsService, 'findByIdentityCardOnly').mockResolvedValueOnce([mockPNPerson]);

      const result = await service.verifyUnified('V-19626778-1');

      expect(spy).toHaveBeenNthCalledWith(1, TypeIdentityCard.V, '19626778-1');
      expect(spy).toHaveBeenNthCalledWith(2, TypeIdentityCard.PN, '19626778-1');
      expect(result.mode).toBe(VerificationMode.BY_PERSON);
    });

    it('should resolve single PN when query has PN prefix without correlative (PN-19626778)', async () => {
      jest.spyOn(contractsRepository, 'findOne').mockResolvedValueOnce(null);

      const mockPNPerson = {
        id: 'p-pn-1',
        name: 'Sofia Victoria Corona',
        typeIdentityCard: TypeIdentityCard.PN,
        identityCard: '19626778-1',
        status: PersonStatus.ACTIVE,
      } as Person;

      const mockPNResult: PersonVerificationResult = {
        mode: VerificationMode.BY_PERSON,
        person: {
          id: 'p-pn-1',
          name: 'Sofia Victoria Corona',
          typeIdentityCard: TypeIdentityCard.PN,
          identityCard: '19626778-1',
          status: PersonStatus.ACTIVE,
        },
        beneficiaryContracts: [],
        ownerContracts: [],
      };

      jest
        .spyOn(service, 'verifyPersonAffiliation')
        .mockRejectedValueOnce(new NotFoundException())
        .mockResolvedValueOnce(mockPNResult);

      jest
        .spyOn(personsService, 'findPNsByTitularIdentityCard')
        .mockResolvedValueOnce([mockPNPerson]);

      const result = await service.verifyUnified('PN-19626778');

      expect(personsService.findPNsByTitularIdentityCard).toHaveBeenCalledWith('19626778');
      expect(result.mode).toBe(VerificationMode.BY_PERSON);
    });

    it('should resolve to contract when titular has multiple PNs (PN-26175756)', async () => {
      jest.spyOn(contractsRepository, 'findOne').mockResolvedValueOnce(null);

      const mockPN1 = {
        id: 'p-pn-1',
        identityCard: '26175756-1',
        typeIdentityCard: TypeIdentityCard.PN,
      } as Person;
      const mockPN2 = {
        id: 'p-pn-2',
        identityCard: '26175756-2',
        typeIdentityCard: TypeIdentityCard.PN,
      } as Person;

      jest.spyOn(service, 'verifyPersonAffiliation').mockRejectedValueOnce(new NotFoundException());
      jest
        .spyOn(personsService, 'findPNsByTitularIdentityCard')
        .mockResolvedValueOnce([mockPN1, mockPN2]);

      jest.spyOn(contractPersonsRepository, 'findOne').mockResolvedValueOnce({
        id: 'cp-1',
        contract: { id: 'c-1', code: 'SIR-009-00725' },
      } as unknown as ContractPerson);

      const mockContractResult: ContractVerificationResult = {
        mode: VerificationMode.BY_CONTRACT,
        contract: {
          id: 'c-1',
          code: 'SIR-009-00725',
          status: ContractStatus.ACTIVE,
          isSuspended: false,
          affiliationDate: new Date(),
          cutoffDay: 5,
          titular: null,
        },
        beneficiaries: [],
        totalBeneficiaries: 2,
      };

      const spyContract = jest
        .spyOn(service, 'verifyContractByCode')
        .mockResolvedValueOnce(mockContractResult);

      const result = await service.verifyUnified('PN-26175756');

      expect(spyContract).toHaveBeenCalledWith('SIR-009-00725');
      expect(result.mode).toBe(VerificationMode.BY_CONTRACT);
    });

    it('should throw NotFoundException if neither contract nor person is found', async () => {
      jest.spyOn(contractsRepository, 'findOne').mockResolvedValueOnce(null);
      jest.spyOn(personsService, 'findByIdentityCardOnly').mockResolvedValue([]);
      jest.spyOn(personsService, 'findPNsByTitularIdentityCard').mockResolvedValue([]);
      jest.spyOn(service, 'verifyPersonAffiliation').mockRejectedValue(new NotFoundException());

      await expect(service.verifyUnified('Z-99999999')).rejects.toThrow(NotFoundException);
    });
  });
});
