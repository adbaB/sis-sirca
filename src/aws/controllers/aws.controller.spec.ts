import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AwsService } from '../aws.service';
import { FilesController } from './aws.controller';

describe('FilesController', () => {
  let controller: FilesController;
  let awsService: jest.Mocked<AwsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FilesController],
      providers: [
        {
          provide: AwsService,
          useValue: {
            uploadFile: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<FilesController>(FilesController);
    awsService = module.get(AwsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('uploadReceipt', () => {
    it('should throw BadRequestException when no file is provided', async () => {
      await expect(
        controller.uploadReceipt(undefined as unknown as Express.Multer.File),
      ).rejects.toThrow(BadRequestException);
    });

    it('should upload file and return url', async () => {
      const mockFile = { originalname: 'receipt.png' } as Express.Multer.File;
      awsService.uploadFile.mockResolvedValue('https://s3/receipt.png');

      const result = await controller.uploadReceipt(mockFile);
      expect(awsService.uploadFile).toHaveBeenCalledWith(mockFile);
      expect(result).toEqual({ url: 'https://s3/receipt.png' });
    });
  });
});
