import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AwsService } from './aws.service';
import { InternalServerErrorException } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// Mock the AWS SDK
jest.mock('@aws-sdk/client-s3');

describe('AwsService', () => {
  let service: AwsService;
  let configService: ConfigService;

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AwsService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<AwsService>(AwsService);
    configService = module.get<ConfigService>(ConfigService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('uploadFile', () => {
    const mockFile = {
      buffer: Buffer.from('test'),
      originalname: 'test.png',
      mimetype: 'image/png',
    } as Express.Multer.File;

    it('should successfully upload a file and return the URL', async () => {
      mockConfigService.get.mockImplementation((key) => {
        if (key === 'AWS_S3_BUCKET') return 'test-bucket';
        if (key === 'AWS_REGION') return 'us-east-1';
        return 'mock-value';
      });

      const mockSend = jest.fn().mockResolvedValue({});
      (S3Client as jest.Mock).mockImplementation(() => ({
        send: mockSend,
      }));

      // Re-initialize the service to use the mocked S3Client
      service = new AwsService(configService);

      const result = await service.uploadFile(mockFile, 'test-folder');

      expect(mockSend).toHaveBeenCalledWith(expect.any(PutObjectCommand));
      expect(result).toMatch(
        /^https:\/\/test-bucket\.s3\.us-east-1\.amazonaws\.com\/test-folder\/.*\.png$/,
      );
    });

    it('should throw an error if AWS_S3_BUCKET is not configured', async () => {
      mockConfigService.get.mockImplementation((key) => {
        if (key === 'AWS_S3_BUCKET') return undefined; // Missing bucket
        return 'mock-value';
      });

      await expect(service.uploadFile(mockFile)).rejects.toThrow(InternalServerErrorException);
      await expect(service.uploadFile(mockFile)).rejects.toThrow(
        'Failed to upload file to S3: AWS_S3_BUCKET is not configured.',
      );
    });

    it('should throw InternalServerErrorException on S3 upload failure', async () => {
      mockConfigService.get.mockImplementation((key) => {
        if (key === 'AWS_S3_BUCKET') return 'test-bucket';
        if (key === 'AWS_REGION') return 'us-east-1';
        return 'mock-value';
      });

      const mockSend = jest.fn().mockRejectedValue(new Error('S3 Error'));
      (S3Client as jest.Mock).mockImplementation(() => ({
        send: mockSend,
      }));

      service = new AwsService(configService);

      await expect(service.uploadFile(mockFile)).rejects.toThrow(InternalServerErrorException);
      await expect(service.uploadFile(mockFile)).rejects.toThrow(
        'Failed to upload file to S3: S3 Error',
      );
    });
  });
});
