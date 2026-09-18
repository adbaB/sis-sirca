import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityNotFoundException } from '../common/exceptions';
import { SystemSetting } from './entities/system-setting.entity';
import { SystemSettingsService } from './system-settings.service';

describe('SystemSettingsService', () => {
  let service: SystemSettingsService;
  let repository: {
    find: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  };

  const mockSetting: SystemSetting = {
    key: 'DEFAULT_SERVICE_PRICE_FACTOR',
    value: '2.00',
    description: 'Default factor',
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    repository = {
      find: vi.fn().mockResolvedValue([mockSetting]),
      findOne: vi.fn().mockResolvedValue(mockSetting),
      save: vi.fn().mockImplementation((entity) => Promise.resolve(entity)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemSettingsService,
        {
          provide: getRepositoryToken(SystemSetting),
          useValue: repository,
        },
      ],
    }).compile();

    service = module.get<SystemSettingsService>(SystemSettingsService);
  });

  afterEach(() => {
    service.clearCache();
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all settings', async () => {
      const result = await service.findAll();
      expect(result).toEqual([mockSetting]);
      expect(repository.find).toHaveBeenCalledWith({ order: { key: 'ASC' } });
    });
  });

  describe('findOne', () => {
    it('should return a setting by key', async () => {
      const result = await service.findOne('DEFAULT_SERVICE_PRICE_FACTOR');
      expect(result).toEqual(mockSetting);
    });

    it('should throw EntityNotFoundException if key does not exist', async () => {
      repository.findOne.mockResolvedValue(null);
      await expect(service.findOne('NON_EXISTENT')).rejects.toThrow(EntityNotFoundException);
    });
  });

  describe('get', () => {
    it('should return value and cache it', async () => {
      const val1 = await service.get('DEFAULT_SERVICE_PRICE_FACTOR');
      expect(val1).toBe('2.00');
      expect(repository.findOne).toHaveBeenCalledTimes(1);

      // Second call should hit cache
      const val2 = await service.get('DEFAULT_SERVICE_PRICE_FACTOR');
      expect(val2).toBe('2.00');
      expect(repository.findOne).toHaveBeenCalledTimes(1);
    });

    it('should return defaultValue when not found if provided', async () => {
      repository.findOne.mockResolvedValue(null);
      const val = await service.get('NOT_FOUND', 'fallback');
      expect(val).toBe('fallback');
    });

    it('should throw when not found and no defaultValue provided', async () => {
      repository.findOne.mockResolvedValue(null);
      await expect(service.get('NOT_FOUND')).rejects.toThrow(EntityNotFoundException);
    });
  });

  describe('getNumeric', () => {
    it('should return parsed numeric value', async () => {
      const num = await service.getNumeric('DEFAULT_SERVICE_PRICE_FACTOR', 1.0);
      expect(num).toBe(2.0);
    });

    it('should return defaultValue if value is not a number', async () => {
      repository.findOne.mockResolvedValue({ ...mockSetting, value: 'invalid_number' });
      const num = await service.getNumeric('DEFAULT_SERVICE_PRICE_FACTOR', 1.5);
      expect(num).toBe(1.5);
    });

    it('should return defaultValue if setting not found', async () => {
      repository.findOne.mockResolvedValue(null);
      const num = await service.getNumeric('NOT_FOUND', 1.3);
      expect(num).toBe(1.3);
    });
  });

  describe('update', () => {
    it('should update setting, save, and update cache', async () => {
      const updated = await service.update('DEFAULT_SERVICE_PRICE_FACTOR', {
        value: '2.50',
      });
      expect(updated.value).toBe('2.50');
      expect(repository.save).toHaveBeenCalled();

      // Next get should return 2.50 from cache without calling findOne again
      repository.findOne.mockClear();
      const val = await service.get('DEFAULT_SERVICE_PRICE_FACTOR');
      expect(val).toBe('2.50');
      expect(repository.findOne).not.toHaveBeenCalled();
    });
  });
});
