import { Test, TestingModule } from '@nestjs/testing';
import { SystemSettingsController } from './system-settings.controller';
import { SystemSettingsService } from './system-settings.service';

describe('SystemSettingsController', () => {
  let controller: SystemSettingsController;
  let service: {
    findAll: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };

  const mockSetting = {
    key: 'DEFAULT_SERVICE_PRICE_FACTOR',
    value: '2.00',
    description: 'Default factor',
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    service = {
      findAll: vi.fn().mockResolvedValue([mockSetting]),
      findOne: vi.fn().mockResolvedValue(mockSetting),
      update: vi.fn().mockResolvedValue({ ...mockSetting, value: '2.50' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SystemSettingsController],
      providers: [
        {
          provide: SystemSettingsService,
          useValue: service,
        },
      ],
    }).compile();

    controller = module.get<SystemSettingsController>(SystemSettingsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should find all settings', async () => {
    const result = await controller.findAll();
    expect(result).toEqual([mockSetting]);
    expect(service.findAll).toHaveBeenCalled();
  });

  it('should find one setting by key', async () => {
    const result = await controller.findOne('DEFAULT_SERVICE_PRICE_FACTOR');
    expect(result).toEqual(mockSetting);
    expect(service.findOne).toHaveBeenCalledWith('DEFAULT_SERVICE_PRICE_FACTOR');
  });

  it('should update setting', async () => {
    const result = await controller.update('DEFAULT_SERVICE_PRICE_FACTOR', { value: '2.50' });
    expect(result.value).toBe('2.50');
    expect(service.update).toHaveBeenCalledWith('DEFAULT_SERVICE_PRICE_FACTOR', { value: '2.50' });
  });
});
