import { Test, TestingModule } from '@nestjs/testing';
import { AwsService } from './aws.service';
import { InternalServerErrorException } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { ConfigType } from '@nestjs/config';
import config from '../config/configurations';

// Mock the AWS SDK
jest.mock('@aws-sdk/client-s3');

describe('AwsService', () => {
  let service: AwsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AwsService,
        {
          provide: config.KEY,
          useValue: {
            aws: {
              region: 'us-east-1',
              accessKeyId: 'mock-access-key',
              secretAccessKey: 'mock-secret',
              s3Bucket: 'test-bucket',
            },
          },
        },
      ],
    }).compile();

    service = module.get<AwsService>(AwsService);
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
      const mockSend = jest.fn().mockResolvedValue({});
      (S3Client as jest.Mock).mockImplementation(() => ({
        send: mockSend,
      }));

      // Re-initialize the service to use the mocked S3Client
      service = new AwsService({
        aws: {
          region: 'us-east-1',
          accessKeyId: 'mock-access-key',
          secretAccessKey: 'mock-secret',
          s3Bucket: 'test-bucket',
        },
      } as unknown as ConfigType<typeof config>);

      const result = await service.uploadFile(mockFile, 'test-folder');

      expect(mockSend).toHaveBeenCalledWith(expect.any(PutObjectCommand));
      expect(result).toMatch(
        /^https:\/\/test-bucket\.s3\.us-east-1\.amazonaws\.com\/test-folder\/.*\.png$/,
      );
    });

    it('should throw an error if AWS_S3_BUCKET is not configured', async () => {
      service = new AwsService({
        aws: {
          region: 'us-east-1',
          accessKeyId: 'mock-access-key',
          secretAccessKey: 'mock-secret',
          s3Bucket: undefined,
        },
      } as unknown as ConfigType<typeof config>);

      await expect(service.uploadFile(mockFile)).rejects.toThrow(InternalServerErrorException);
      await expect(service.uploadFile(mockFile)).rejects.toThrow(
        'Failed to upload file to S3: AWS_S3_BUCKET is not configured.',
      );
    });

    it('should throw InternalServerErrorException on S3 upload failure', async () => {
      const mockSend = jest.fn().mockRejectedValue(new Error('S3 Error'));
      (S3Client as jest.Mock).mockImplementation(() => ({
        send: mockSend,
      }));

      service = new AwsService({
        aws: {
          region: 'us-east-1',
          accessKeyId: 'mock-access-key',
          secretAccessKey: 'mock-secret',
          s3Bucket: 'test-bucket',
        },
      } as unknown as ConfigType<typeof config>);

      await expect(service.uploadFile(mockFile)).rejects.toThrow(InternalServerErrorException);
      await expect(service.uploadFile(mockFile)).rejects.toThrow(
        'Failed to upload file to S3: S3 Error',
      );
    });
  });
});
