import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PaymentTypesService } from './payment-types.service';
import { PaymentType } from './entities/payment-type.entity';

describe('PaymentTypesService', () => {
  let service: PaymentTypesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentTypesService,
        {
          provide: getRepositoryToken(PaymentType),
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<PaymentTypesService>(PaymentTypesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
