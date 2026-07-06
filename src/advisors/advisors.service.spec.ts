import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AdvisorsService } from './advisors.service';
import { Advisor } from './entities/advisor.entity';

describe('AdvisorsService', () => {
  let service: AdvisorsService;
  //let repository: Repository<Advisor>;

  const mockRepository = {
    create: jest.fn().mockImplementation((dto) => dto),
    save: jest
      .fn()
      .mockImplementation((advisor) => Promise.resolve({ id: 'some-uuid', ...advisor })),
    findOneBy: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    merge: jest.fn().mockImplementation((target, source) => Object.assign(target, source)),
    remove: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdvisorsService,
        {
          provide: getRepositoryToken(Advisor),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<AdvisorsService>(AdvisorsService);
    //repository = module.get<Repository<Advisor>>(getRepositoryToken(Advisor));
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create an advisor successfully', async () => {
      const dto = { name: 'Juan Asesor' };
      const result = await service.create(dto);
      expect(result).toBeDefined();
      expect(result.name).toBe(dto.name);
      expect(result.codeNumber).toBeUndefined(); // Delegated to sequence default
    });
  });

  describe('Advisor Entity Code Formatting', () => {
    it('should format codeNumber < 1000 with zero padding to 3 digits', () => {
      const advisor = new Advisor();
      advisor.codeNumber = 7;
      expect(advisor.code).toBe('007');

      advisor.codeNumber = 95;
      expect(advisor.code).toBe('095');

      advisor.codeNumber = 999;
      expect(advisor.code).toBe('999');
    });

    it('should not pad codeNumber >= 1000', () => {
      const advisor = new Advisor();
      advisor.codeNumber = 1000;
      expect(advisor.code).toBe('1000');

      advisor.codeNumber = 54321;
      expect(advisor.code).toBe('54321');
    });

    it('should return empty string if codeNumber is not set', () => {
      const advisor = new Advisor();
      expect(advisor.code).toBe('');
    });
  });
});
