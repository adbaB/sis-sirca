import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BulkUpdateBeneficiariesDto } from '../dto/bulk-update-beneficiaries.dto';
import { CreateBeneficiaryDto } from '../dto/create-beneficiary.dto';
import { CreateContractFullDto } from '../dto/create-contract-full.dto';
import { InactivateContractDto } from '../dto/inactivate-contract.dto';
import { UpdateBeneficiaryDto } from '../dto/update-beneficiary.dto';
import { UpdateContractDto } from '../dto/update-contract.dto';
import { Contract, ContractStatus } from '../entities/contract.entity';
import { ContractPerson, PersonRole } from '../entities/contract-person.entity';
import { Person, PersonStatus, TypeIdentityCard } from '../../persons/entities/person.entity';
import {
  ContractVerificationResult,
  PersonVerificationResult,
  VerificationMode,
} from '../interfaces/person-verification.interface';
import { ContractsService } from '../services/contracts.service';
import { ContractsController } from './contracts.controller';

describe('ContractsController', () => {
  let controller: ContractsController;
  let service: ContractsService;

  const mockContract: Contract = {
    id: '1',
    code: '1',
    affiliationDate: new Date('2023-01-01'),
    monthlyAmount: 0,
    retentionPercentage: 0,
    contractPersons: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    status: ContractStatus.ACTIVE,
    inactivationReason: null,
    advisorCommission: 0,
    excludeFromNextBilling: false,
    cutoffDay: 5,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContractsController],
      providers: [
        {
          provide: ContractsService,
          useValue: {
            create: jest.fn(),
            createFull: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
            inactivate: jest.fn(),
            activate: jest.fn(),
            addBeneficiary: jest.fn(),
            updateBeneficiary: jest.fn(),
            bulkUpdateBeneficiaries: jest.fn(),
            setContractTitular: jest.fn(),
            setBillingOwner: jest.fn(),
            removeAffiliate: jest.fn(),
            verifyPersonAffiliation: jest.fn(),
            verifyUnified: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<ContractsController>(ContractsController);
    service = module.get<ContractsService>(ContractsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create a contract with affiliates', async () => {
      const dto: CreateContractFullDto = {
        affiliationDate: '2023-01-01',
        advisorId: '1',
        affiliates: [
          {
            typeIdentityCard: TypeIdentityCard.V,
            identityCard: '12345678',
            name: 'Juan Perez',
            role: PersonRole.TITULAR,
            isBillingOwner: true,
          },
        ],
      };
      jest.spyOn(service, 'createFull').mockResolvedValue(mockContract);

      const result = await controller.create(dto);

      expect(service.createFull).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockContract);
    });
  });

  describe('inactivate', () => {
    it('should delegate to service.inactivate', async () => {
      const dto: InactivateContractDto = { reason: 'Test inactivation reason' };
      jest.spyOn(service, 'inactivate').mockResolvedValue(mockContract);

      const result = await controller.inactivate('1', dto);

      expect(service.inactivate).toHaveBeenCalledWith('1', dto);
      expect(result).toEqual(mockContract);
    });
  });

  describe('activate', () => {
    it('should delegate to service.activate', async () => {
      jest.spyOn(service, 'activate').mockResolvedValue(mockContract);

      const result = await controller.activate('1');

      expect(service.activate).toHaveBeenCalledWith('1', undefined, undefined);
      expect(result).toEqual(mockContract);
    });
  });

  describe('findAll', () => {
    it('should return a paginated result of contracts', async () => {
      const paginatedResult = {
        data: [mockContract],
        meta: {
          totalItems: 1,
          itemCount: 1,
          itemsPerPage: 10,
          totalPages: 1,
          currentPage: 1,
        },
      };
      jest.spyOn(service, 'findAll').mockResolvedValue(paginatedResult);

      const result = await controller.findAll({});

      expect(service.findAll).toHaveBeenCalled();
      expect(result).toEqual(paginatedResult);
    });
  });

  describe('findOne', () => {
    it('should return a single contract', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(mockContract);

      const result = await controller.findOne('1');

      expect(service.findOne).toHaveBeenCalledWith('1');
      expect(result).toEqual(mockContract);
    });
  });

  describe('update', () => {
    it('should update a contract', async () => {
      const updateContractDto: UpdateContractDto = { affiliationDate: '2023-02-01' };
      const updatedContract = {
        ...mockContract,
        ...updateContractDto,
        affiliationDate: new Date('2023-02-01'),
      } as Contract;
      jest.spyOn(service, 'update').mockResolvedValue(updatedContract);

      const result = await controller.update('1', updateContractDto);

      expect(service.update).toHaveBeenCalledWith('1', updateContractDto);
      expect(result).toEqual(updatedContract);
    });
  });

  describe('remove', () => {
    it('should remove a contract', async () => {
      jest.spyOn(service, 'remove').mockResolvedValue(undefined);

      await controller.remove('1');

      expect(service.remove).toHaveBeenCalledWith('1');
    });
  });

  describe('addBeneficiary', () => {
    it('should delegate adding beneficiary to service.addBeneficiary', async () => {
      const dto: CreateBeneficiaryDto = {
        name: 'Maria Perez',
        typeIdentityCard: TypeIdentityCard.V,
        identityCard: '99999999',
        planId: 'plan-1',
        role: PersonRole.AFILIADO,
        isBillingOwner: false,
        contractId: '1',
      };
      const mockCreatedPerson = {
        id: 'person-1',
        name: 'Maria Perez',
      } as unknown as Person;
      jest.spyOn(service, 'addBeneficiary').mockResolvedValue(mockCreatedPerson);

      const result = await controller.addBeneficiary('1', dto);

      expect(service.addBeneficiary).toHaveBeenCalledWith('1', dto);
      expect(result).toEqual(mockCreatedPerson);
    });
  });

  describe('setContractTitular', () => {
    it('should delegate to service.setContractTitular', async () => {
      const dto = { contractPersonId: 'cp-1' };
      jest.spyOn(service, 'setContractTitular').mockResolvedValue(undefined);

      await controller.setContractTitular('contract-1', dto);

      expect(service.setContractTitular).toHaveBeenCalledWith('contract-1', dto);
    });
  });

  describe('setBillingOwner', () => {
    it('should delegate to service.setBillingOwner', async () => {
      const dto = { contractPersonId: 'cp-1' };
      jest.spyOn(service, 'setBillingOwner').mockResolvedValue(undefined);

      await controller.setBillingOwner('contract-1', dto);

      expect(service.setBillingOwner).toHaveBeenCalledWith('contract-1', dto);
    });
  });

  describe('removeBeneficiary', () => {
    it('should delegate to service.removeAffiliate with contractPersonId and contractId', async () => {
      jest.spyOn(service, 'removeAffiliate').mockResolvedValue(undefined);

      await controller.removeBeneficiary('contract-1', 'cp-1');

      expect(service.removeAffiliate).toHaveBeenCalledWith('cp-1', 'contract-1');
    });
  });

  describe('updateBeneficiary', () => {
    it('should delegate to service.updateBeneficiary', async () => {
      const dto: UpdateBeneficiaryDto = {
        name: 'Juan Carlos',
        relationship: undefined,
        planId: 'plan-1',
      };
      const mockResult = { id: 'cp-1' } as unknown as ContractPerson;
      jest.spyOn(service, 'updateBeneficiary').mockResolvedValue(mockResult);

      const result = await controller.updateBeneficiary('contract-1', 'cp-1', dto);

      expect(service.updateBeneficiary).toHaveBeenCalledWith('contract-1', 'cp-1', dto);
      expect(result).toEqual(mockResult);
    });
  });

  describe('bulkUpdateBeneficiaries', () => {
    it('should delegate to service.bulkUpdateBeneficiaries', async () => {
      const dto: BulkUpdateBeneficiariesDto = {
        beneficiaries: [{ contractPersonId: 'cp-1', name: 'Juan Carlos' }],
      };
      const mockResult = [{ id: 'cp-1' }] as unknown as ContractPerson[];
      jest.spyOn(service, 'bulkUpdateBeneficiaries').mockResolvedValue(mockResult);

      const result = await controller.bulkUpdateBeneficiaries('contract-1', dto);

      expect(service.bulkUpdateBeneficiaries).toHaveBeenCalledWith('contract-1', dto);
      expect(result).toEqual(mockResult);
    });
  });

  describe('verifyPersonAffiliation', () => {
    it('should delegate to service.verifyPersonAffiliation', async () => {
      const mockResult: PersonVerificationResult = {
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

      jest.spyOn(service, 'verifyPersonAffiliation').mockResolvedValue(mockResult);

      const result = await controller.verifyPersonAffiliation(TypeIdentityCard.V, '12345678');

      expect(service.verifyPersonAffiliation).toHaveBeenCalledWith(TypeIdentityCard.V, '12345678');
      expect(result).toEqual(mockResult);
    });
  });

  describe('verifyUnified', () => {
    it('should throw BadRequestException if query is empty or undefined', () => {
      expect(() => controller.verifyUnified('')).toThrow(BadRequestException);
      expect(() => controller.verifyUnified('   ')).toThrow(BadRequestException);
      expect(() => controller.verifyUnified(undefined)).toThrow(BadRequestException);
    });

    it('should delegate to service.verifyUnified when valid query is provided', async () => {
      const mockResult: ContractVerificationResult = {
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

      jest.spyOn(service, 'verifyUnified').mockResolvedValue(mockResult);

      const result = await controller.verifyUnified('SIR-001-00001');

      expect(service.verifyUnified).toHaveBeenCalledWith('SIR-001-00001');
      expect(result).toEqual(mockResult);
    });
  });

  describe('verifyUnifiedParam', () => {
    it('should delegate to service.verifyUnified with path param', async () => {
      const mockResult: PersonVerificationResult = {
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

      jest.spyOn(service, 'verifyUnified').mockResolvedValue(mockResult);

      const result = await controller.verifyUnifiedParam('V-12345678');

      expect(service.verifyUnified).toHaveBeenCalledWith('V-12345678');
      expect(result).toEqual(mockResult);
    });
  });
});
