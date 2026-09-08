import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Person, PersonStatus, TypeIdentityCard } from '../../persons/entities/person.entity';
import { PersonsService } from '../../persons/services/persons.service';
import { ContractPerson, Parentesco, PersonRole } from '../entities/contract-person.entity';
import { Contract, ContractStatus } from '../entities/contract.entity';
import {
  BeneficiaryVerificationResult,
  ContractVerificationResult,
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

    it('should return person with empty contracts if person has no beneficiary affiliations', async () => {
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
      jest.spyOn(contractPersonsRepository, 'find').mockResolvedValue([]);

      const result = await service.verifyPersonAffiliation(TypeIdentityCard.V, '12345678');

      expect(result.person.id).toBe('p-1');
      expect(result.contracts).toHaveLength(0);
      expect(result.hasActiveContract).toBe(false);
      expect(result.hasSuspendedContract).toBe(false);
    });

    it('should return and prioritize contracts (ACTIVE first, then SUSPENDED, then INACTIVE)', async () => {
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
      jest.spyOn(contractPersonsRepository, 'find').mockResolvedValue(mockAffiliations);

      const result = await service.verifyPersonAffiliation(TypeIdentityCard.V, '12345678');

      expect(result.contracts).toHaveLength(3);
      expect(result.contracts[0].code).toBe('SIR-001-00003');
      expect(result.contracts[0].status).toBe(ContractStatus.ACTIVE);
      expect(result.contracts[0].isSuspended).toBe(false);

      expect(result.contracts[1].code).toBe('SIR-001-00002');
      expect(result.contracts[1].status).toBe(ContractStatus.SUSPENDED);
      expect(result.contracts[1].isSuspended).toBe(true);

      expect(result.contracts[2].code).toBe('SIR-001-00001');
      expect(result.contracts[2].status).toBe(ContractStatus.INACTIVE);
      expect(result.contracts[2].isSuspended).toBe(false);

      expect(result.hasActiveContract).toBe(true);
      expect(result.hasSuspendedContract).toBe(true);
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

      expect(result.mode).toBe('BY_CONTRACT');
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
        mode: 'BY_CONTRACT',
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
      expect(result.mode).toBe('BY_CONTRACT');
    });

    it('should auto-detect document with prefix and delegate to verifyPersonAffiliation', async () => {
      jest.spyOn(contractsRepository, 'findOne').mockResolvedValueOnce(null);

      const mockPersonResult: BeneficiaryVerificationResult = {
        mode: 'BY_BENEFICIARY',
        person: {
          id: 'p-1',
          name: 'Carlos Ruiz',
          typeIdentityCard: TypeIdentityCard.V,
          identityCard: '12345678',
          status: PersonStatus.ACTIVE,
        },
        contracts: [],
        hasActiveContract: false,
        hasSuspendedContract: false,
      };

      const spy = jest
        .spyOn(service, 'verifyPersonAffiliation')
        .mockResolvedValue(mockPersonResult);

      const result = await service.verifyUnified('V-12345678');

      expect(spy).toHaveBeenCalledWith(TypeIdentityCard.V, '12345678');
      expect(result.mode).toBe('BY_BENEFICIARY');
    });

    it('should auto-detect PN document with prefix (PN-12345678-1) and delegate to verifyPersonAffiliation with TypeIdentityCard.PN', async () => {
      jest.spyOn(contractsRepository, 'findOne').mockResolvedValueOnce(null);

      const mockPNResult: BeneficiaryVerificationResult = {
        mode: 'BY_BENEFICIARY',
        person: {
          id: 'p-pn-1',
          name: 'Sofia Victoria Corona',
          typeIdentityCard: TypeIdentityCard.PN,
          identityCard: '19626778-1',
          status: PersonStatus.ACTIVE,
        },
        contracts: [],
        hasActiveContract: true,
        hasSuspendedContract: false,
      };

      const spy = jest.spyOn(service, 'verifyPersonAffiliation').mockResolvedValue(mockPNResult);

      const result = await service.verifyUnified('PN-19626778-1');

      expect(spy).toHaveBeenCalledWith(TypeIdentityCard.PN, '19626778-1');
      expect(result.mode).toBe('BY_BENEFICIARY');
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

      const mockPNResult: BeneficiaryVerificationResult = {
        mode: 'BY_BENEFICIARY',
        person: {
          id: 'p-pn-1',
          name: 'Sofia Victoria Corona',
          typeIdentityCard: TypeIdentityCard.PN,
          identityCard: '19626778-1',
          status: PersonStatus.ACTIVE,
        },
        contracts: [],
        hasActiveContract: true,
        hasSuspendedContract: false,
      };

      jest.spyOn(personsService, 'findByIdentityCardOnly').mockResolvedValueOnce([mockPNPerson]);
      const spy = jest.spyOn(service, 'verifyPersonAffiliation').mockResolvedValue(mockPNResult);

      const result = await service.verifyUnified('19626778-1');

      expect(personsService.findByIdentityCardOnly).toHaveBeenCalledWith('19626778-1');
      expect(spy).toHaveBeenCalledWith(TypeIdentityCard.PN, '19626778-1');
      expect(result.mode).toBe('BY_BENEFICIARY');
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

      const mockPNResult: BeneficiaryVerificationResult = {
        mode: 'BY_BENEFICIARY',
        person: {
          id: 'p-pn-1',
          name: 'Sofia Victoria Corona',
          typeIdentityCard: TypeIdentityCard.PN,
          identityCard: '19626778-1',
          status: PersonStatus.ACTIVE,
        },
        contracts: [],
        hasActiveContract: true,
        hasSuspendedContract: false,
      };

      // Direct verification with V fails with NotFoundException
      const spy = jest
        .spyOn(service, 'verifyPersonAffiliation')
        .mockRejectedValueOnce(new NotFoundException())
        .mockResolvedValueOnce(mockPNResult);

      jest.spyOn(personsService, 'findByIdentityCardOnly').mockResolvedValueOnce([mockPNPerson]);

      const result = await service.verifyUnified('V-19626778-1');

      expect(spy).toHaveBeenNthCalledWith(1, TypeIdentityCard.V, '19626778-1');
      expect(spy).toHaveBeenNthCalledWith(2, TypeIdentityCard.PN, '19626778-1');
      expect(result.mode).toBe('BY_BENEFICIARY');
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

      const mockPNResult: BeneficiaryVerificationResult = {
        mode: 'BY_BENEFICIARY',
        person: {
          id: 'p-pn-1',
          name: 'Sofia Victoria Corona',
          typeIdentityCard: TypeIdentityCard.PN,
          identityCard: '19626778-1',
          status: PersonStatus.ACTIVE,
        },
        contracts: [],
        hasActiveContract: true,
        hasSuspendedContract: false,
      };

      // Direct lookup with 19626778 throws NotFound
      jest
        .spyOn(service, 'verifyPersonAffiliation')
        .mockRejectedValueOnce(new NotFoundException())
        .mockResolvedValueOnce(mockPNResult);

      jest
        .spyOn(personsService, 'findPNsByTitularIdentityCard')
        .mockResolvedValueOnce([mockPNPerson]);

      const result = await service.verifyUnified('PN-19626778');

      expect(personsService.findPNsByTitularIdentityCard).toHaveBeenCalledWith('19626778');
      expect(result.mode).toBe('BY_BENEFICIARY');
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

      // Direct lookup fails
      jest.spyOn(service, 'verifyPersonAffiliation').mockRejectedValueOnce(new NotFoundException());
      jest
        .spyOn(personsService, 'findPNsByTitularIdentityCard')
        .mockResolvedValueOnce([mockPN1, mockPN2]);

      jest.spyOn(contractPersonsRepository, 'findOne').mockResolvedValueOnce({
        id: 'cp-1',
        contract: { id: 'c-1', code: 'SIR-009-00725' },
      } as unknown as ContractPerson);

      const mockContractResult: ContractVerificationResult = {
        mode: 'BY_CONTRACT',
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
      expect(result.mode).toBe('BY_CONTRACT');
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
