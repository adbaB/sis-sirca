import { Test, TestingModule } from '@nestjs/testing';
import { GoogleDriveService } from './google-drive.service';
import config from '../../config/configurations';
import { google } from 'googleapis';

const mockExport = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: {
      JWT: jest.fn().mockImplementation(() => ({})),
    },
    drive: jest.fn().mockImplementation(() => ({
      files: {
        export: mockExport,
      },
    })),
  },
}));

describe('GoogleDriveService', () => {
  let service: GoogleDriveService;

  const mockConfig = {
    drive: {
      clientEmail: 'test@serviceaccount.com',
      privateKey: 'private_key',
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleDriveService,
        {
          provide: config.KEY,
          useValue: mockConfig,
        },
      ],
    }).compile();

    service = module.get<GoogleDriveService>(GoogleDriveService);

    jest.spyOn(service['logger'], 'error').mockImplementation(() => {});
    jest.spyOn(service['logger'], 'log').mockImplementation(() => {});
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => {});
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('initClient', () => {
    it('should initialize the drive client if credentials exist', () => {
      // It is initialized in constructor
      expect(google.auth.JWT).toHaveBeenCalledWith({
        client_id: undefined,
        email: 'test@serviceaccount.com',
        key: 'private_key',
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      });
      expect(google.drive).toHaveBeenCalled();
    });

    it('should not initialize the drive client if credentials are missing', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          GoogleDriveService,
          {
            provide: config.KEY,
            useValue: { drive: {} },
          },
        ],
      }).compile();

      const emptyService = module.get<GoogleDriveService>(GoogleDriveService);
      expect(emptyService['driveClient']).toBeUndefined();
    });
  });

  describe('downloadExcelFile', () => {
    it('should successfully download a file', async () => {
      const mockBuffer = new ArrayBuffer(8);
      mockExport.mockResolvedValueOnce({ data: mockBuffer });

      const result = await service.downloadExcelFile('file_id_123');

      expect(mockExport).toHaveBeenCalledWith(
        {
          fileId: 'file_id_123',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        { responseType: 'arraybuffer' },
      );
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should return null if client is not initialized', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          GoogleDriveService,
          {
            provide: config.KEY,
            useValue: { drive: {} },
          },
        ],
      }).compile();

      const emptyService = module.get<GoogleDriveService>(GoogleDriveService);
      const result = await emptyService.downloadExcelFile('file_id_123');

      expect(result).toBeNull();
    });

    it('should return null if an error occurs during download', async () => {
      mockExport.mockRejectedValueOnce(new Error('Download failed'));

      const result = await service.downloadExcelFile('file_id_123');

      expect(result).toBeNull();
    });
  });
});
