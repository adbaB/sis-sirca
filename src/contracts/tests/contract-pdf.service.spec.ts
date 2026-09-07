import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AwsService } from '../../aws/aws.service';
import { PdfService } from '../../pdf/services/pdf.service';
import { PersonRole } from '../entities/contract-person.entity';
import { Contract, ContractStatus } from '../entities/contract.entity';
import { ContractPdfService } from '../services/contract-pdf.service';

describe('ContractPdfService', () => {
  let service: ContractPdfService;
  let contractsRepository: jest.Mocked<Repository<Contract>>;
  let pdfService: jest.Mocked<PdfService>;
  let awsService: jest.Mocked<AwsService>;

  const mockContract: Contract = {
    id: 'contract-1',
    code: 'SIR-001-00001',
    status: ContractStatus.ACTIVE,
    monthlyAmount: 100,
    retentionPercentage: 0,
    advisorCommission: 0,
    excludeFromNextBilling: false,
    affiliationDate: new Date('2026-08-01'),
    inactivationReason: null as unknown as string,
    contractPersons: [
      {
        id: 'cp-1',
        role: PersonRole.TITULAR,
        isBillingOwner: true,
        person: {
          id: 'p-1',
          name: 'Juan Perez',
          typeIdentityCard: 'V',
          identityCard: '12345678',
          birthDate: new Date('1990-01-01'),
          plan: { id: 'plan-1', name: 'Plan Familiar', coverage: 5000, amount: 50 },
        },
      } as unknown as NonNullable<Contract['contractPersons']>[0],
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null as unknown as Date,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractPdfService,
        {
          provide: getRepositoryToken(Contract),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: PdfService,
          useValue: {
            generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf-binary')),
          },
        },
        {
          provide: AwsService,
          useValue: {
            uploadFile: jest
              .fn()
              .mockResolvedValue('https://s3.amazonaws.com/contracts/SIR-001-00001.pdf'),
          },
        },
      ],
    }).compile();

    service = module.get<ContractPdfService>(ContractPdfService);
    contractsRepository = module.get(getRepositoryToken(Contract));
    pdfService = module.get(PdfService);
    awsService = module.get(AwsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateContractPdfBuffer', () => {
    it('should return null if contract not found', async () => {
      contractsRepository.findOne.mockResolvedValue(null);
      const res = await service.generateContractPdfBuffer('invalid-id');
      expect(res).toBeNull();
    });

    it('should generate PDF buffer successfully', async () => {
      contractsRepository.findOne.mockResolvedValue(mockContract);
      const res = await service.generateContractPdfBuffer('contract-1');
      expect(res).toBeInstanceOf(Buffer);
      expect(pdfService.generatePdf).toHaveBeenCalledWith(
        'contract-affiliation',
        expect.any(Object),
      );
    });
  });

  describe('generateAndUploadContractPdf', () => {
    it('should generate buffer and upload to S3', async () => {
      contractsRepository.findOne.mockResolvedValue(mockContract);
      const res = await service.generateAndUploadContractPdf('contract-1');
      expect(res).toBe('https://s3.amazonaws.com/contracts/SIR-001-00001.pdf');
      expect(awsService.uploadFile).toHaveBeenCalled();
    });
  });
});
