import { Test, TestingModule } from '@nestjs/testing';
import { ContractsController } from './contracts.controller';
import { ContractsService } from '../services/contracts.service';
import { CreateContractDto } from '../dto/create-contract.dto';
import { UpdateContractDto } from '../dto/update-contract.dto';
import { Contract, ContractStatus } from '../entities/contract.entity';

describe('ContractsController', () => {
  let controller: ContractsController;
  let service: ContractsService;

  const mockContract: Contract = {
    id: '1',
    code: '1',
    affiliationDate: new Date('2023-01-01'),
    monthlyAmount: 0,
    contractPersons: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    status: ContractStatus.ACTIVE,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContractsController],
      providers: [
        {
          provide: ContractsService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
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
    it('should create a contract', async () => {
      const createContractDto: CreateContractDto = { affiliationDate: '2023-01-01', code: '1' };
      jest.spyOn(service, 'create').mockResolvedValue(mockContract);

      const result = await controller.create(createContractDto);

      expect(service.create).toHaveBeenCalledWith(createContractDto);
      expect(result).toEqual(mockContract);
    });
  });

  describe('findAll', () => {
    it('should return an array of contracts', async () => {
      jest.spyOn(service, 'findAll').mockResolvedValue([mockContract]);

      const result = await controller.findAll();

      expect(service.findAll).toHaveBeenCalled();
      expect(result).toEqual([mockContract]);
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
});
