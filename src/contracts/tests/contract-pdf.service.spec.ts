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
    cutoffDay: 5,
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

    it('should generate PDF buffer successfully with formatted start, expiration dates and advisor details', async () => {
      contractsRepository.findOne.mockResolvedValue({
        ...mockContract,
        startDate: new Date('2026-06-28'),
        expirationDate: new Date('2027-05-31'),
        advisor: { id: 'adv-1', code: 'ADV-001', name: 'Asesor Carlos' },
      } as unknown as Contract);
      const res = await service.generateContractPdfBuffer('contract-1');
      expect(res).toBeInstanceOf(Buffer);
      expect(pdfService.generatePdf).toHaveBeenCalledWith(
        'contract-affiliation',
        expect.objectContaining({
          contractCode: 'SIR-001-00001',
          startDateFormatted: '28-06-2026',
          expirationDateFormatted: '31-05-2027',
          advisorCode: 'ADV-001',
          advisorName: 'Asesor Carlos',
        }),
      );
    });

    it('should format age in months for baby affiliate under 1 year old', async () => {
      contractsRepository.findOne.mockResolvedValue({
        ...mockContract,
        affiliationDate: new Date('2026-09-30'),
        contractPersons: [
          ...mockContract.contractPersons,
          {
            id: 'cp-2',
            role: PersonRole.AFILIADO,
            relationship: 'HIJO',
            person: {
              id: 'p-2',
              name: 'Bebe Perez',
              typeIdentityCard: 'PN',
              identityCard: '99999999',
              birthDate: new Date('2026-06-30'),
              plan: { id: 'plan-1', name: 'Plan Familiar', coverage: 5000, amount: 50 },
            },
          } as unknown as NonNullable<Contract['contractPersons']>[0],
          {
            id: 'cp-3',
            role: PersonRole.AFILIADO,
            relationship: 'ABUELO',
            person: {
              id: 'p-3',
              name: 'Abuelo Perez',
              typeIdentityCard: 'V',
              identityCard: '11111111',
              birthDate: new Date('1942-09-30'),
              plan: { id: 'plan-1', name: 'Plan Familiar', coverage: 5000, amount: 50 },
            },
          } as unknown as NonNullable<Contract['contractPersons']>[0],
        ],
      } as unknown as Contract);

      await service.generateContractPdfBuffer('contract-1');

      expect(pdfService.generatePdf).toHaveBeenCalledWith(
        'contract-affiliation',
        expect.objectContaining({
          beneficiaries: expect.arrayContaining([
            expect.objectContaining({
              name: 'Bebe Perez',
              age: '3 MESES',
            }),
            expect.objectContaining({
              name: 'Abuelo Perez',
              age: '84 AÑOS',
            }),
          ]),
          beneficiariesRow: expect.arrayContaining([
            expect.objectContaining({
              name: 'Bebe Perez',
              age: '3 MESES',
            }),
            expect.objectContaining({
              name: 'Abuelo Perez',
              age: '84 AÑOS',
            }),
          ]),
        }),
      );
    });

    it('should set titularRow to null when titular has no plan assigned, and not inherit beneficiary plan', async () => {
      contractsRepository.findOne.mockResolvedValue({
        ...mockContract,
        contractPersons: [
          {
            id: 'cp-titular',
            role: PersonRole.TITULAR,
            isBillingOwner: true,
            plan: null,
            person: {
              id: 'p-titular',
              name: 'Carlos Titular Sin Plan',
              typeIdentityCard: 'V',
              identityCard: '12345678',
              birthDate: new Date('1985-05-10'),
              plan: null,
            },
          } as unknown as NonNullable<Contract['contractPersons']>[0],
          {
            id: 'cp-beneficiary',
            role: PersonRole.AFILIADO,
            relationship: 'HIJO',
            plan: { id: 'plan-beneficiary', name: 'Plan Dorado', coverage: 10000, amount: 80 },
            person: {
              id: 'p-beneficiary',
              name: 'Hijo Beneficiario',
              typeIdentityCard: 'V',
              identityCard: '87654321',
              birthDate: new Date('2015-01-01'),
            },
          } as unknown as NonNullable<Contract['contractPersons']>[0],
        ],
      } as unknown as Contract);

      await service.generateContractPdfBuffer('contract-1');

      expect(pdfService.generatePdf).toHaveBeenCalledWith(
        'contract-affiliation',
        expect.objectContaining({
          titularRow: null,
          beneficiariesRow: [
            expect.objectContaining({
              name: 'Hijo Beneficiario',
              planName: 'Plan Dorado',
              coverage: '10,000.00',
              monthlyCost: '80.00',
            }),
          ],
        }),
      );
    });

    it('should include titularRow when titular has their own plan assigned', async () => {
      contractsRepository.findOne.mockResolvedValue({
        ...mockContract,
        contractPersons: [
          {
            id: 'cp-titular',
            role: PersonRole.TITULAR,
            isBillingOwner: true,
            plan: { id: 'plan-titular', name: 'Plan Platino', coverage: 15000, amount: 120 },
            person: {
              id: 'p-titular',
              name: 'Carlos Titular Con Plan',
              typeIdentityCard: 'V',
              identityCard: '12345678',
              birthDate: new Date('1985-05-10'),
            },
          } as unknown as NonNullable<Contract['contractPersons']>[0],
        ],
      } as unknown as Contract);

      await service.generateContractPdfBuffer('contract-1');

      expect(pdfService.generatePdf).toHaveBeenCalledWith(
        'contract-affiliation',
        expect.objectContaining({
          titularRow: expect.objectContaining({
            name: 'Carlos Titular Con Plan',
            planName: 'Plan Platino',
            coverage: '15,000.00',
            monthlyCost: '120.00',
          }),
        }),
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
