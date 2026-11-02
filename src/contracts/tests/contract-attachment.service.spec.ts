import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AwsService } from '../../aws/aws.service';
import { Contract } from '../entities/contract.entity';
import { ContractAttachmentService } from '../services/contract-attachment.service';

describe('ContractAttachmentService', () => {
  let service: ContractAttachmentService;
  let contractsRepository: jest.Mocked<Repository<Contract>>;
  let awsService: jest.Mocked<AwsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractAttachmentService,
        {
          provide: getRepositoryToken(Contract),
          useValue: {
            findOne: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: AwsService,
          useValue: {
            uploadFile: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ContractAttachmentService>(ContractAttachmentService);
    contractsRepository = module.get(getRepositoryToken(Contract));
    awsService = module.get(AwsService);
  });

  describe('uploadAttachment', () => {
    it('should throw BadRequestException if file is null/undefined', async () => {
      await expect(
        service.uploadAttachment(undefined as unknown as Express.Multer.File),
      ).rejects.toThrow(BadRequestException);
    });

    it('should upload file with cleaned filename to contracts folder and return url', async () => {
      const mockFile = {
        originalname: 'my document report.pdf',
        buffer: Buffer.from('test'),
        mimetype: 'application/pdf',
      } as Express.Multer.File;

      awsService.uploadFile.mockResolvedValue(
        'https://sirca-bucket-s3.s3.us-east-1.amazonaws.com/contracts/test.pdf',
      );

      const result = await service.uploadAttachment(mockFile);

      expect(awsService.uploadFile).toHaveBeenCalledWith(
        mockFile,
        'contracts',
        expect.stringMatching(/^\d+-my_document_report$/),
      );
      expect(result).toEqual({
        url: 'https://sirca-bucket-s3.s3.us-east-1.amazonaws.com/contracts/test.pdf',
      });
    });
  });

  describe('addAttachment', () => {
    it('should throw NotFoundException if contract does not exist', async () => {
      contractsRepository.findOne.mockResolvedValue(null);
      const mockFile = {
        originalname: 'doc.pdf',
      } as Express.Multer.File;

      await expect(service.addAttachment('non-existent-id', mockFile)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should upload and append to existing contract attachments', async () => {
      const mockContract = {
        id: 'c-1',
        attachments: ['https://s3/existing.pdf'],
      } as Contract;

      contractsRepository.findOne.mockResolvedValue(mockContract);
      awsService.uploadFile.mockResolvedValue('https://s3/new.pdf');

      const mockFile = {
        originalname: 'new.pdf',
      } as Express.Multer.File;

      const result = await service.addAttachment('c-1', mockFile);

      expect(contractsRepository.update).toHaveBeenCalledWith('c-1', {
        attachments: ['https://s3/existing.pdf', 'https://s3/new.pdf'],
      });
      expect(result).toEqual({
        url: 'https://s3/new.pdf',
        attachments: ['https://s3/existing.pdf', 'https://s3/new.pdf'],
      });
    });
  });
});
