import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Contract, ContractStatus } from '../../contracts/entities/contract.entity';
import { EmailService } from '../../email/email.service';
import { ContractInactivationCronService } from './contract-inactivation-cron.service';

describe('ContractInactivationCronService', () => {
  let service: ContractInactivationCronService;
  let mockEmailService: { sendHtmlEmail: jest.Mock };

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    isTransactionActive: true,
    release: jest.fn(),
    manager: {
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue(undefined),
    },
  };

  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
  };

  const mockContractRepository = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    mockEmailService = { sendHtmlEmail: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractInactivationCronService,
        {
          provide: getRepositoryToken(Contract),
          useValue: mockContractRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: EmailService,
          useValue: mockEmailService,
        },
      ],
    }).compile();

    service = module.get<ContractInactivationCronService>(ContractInactivationCronService);

    jest.clearAllMocks();
  });

  const createMockContract = (id: string, code: string, titularName?: string): Contract => {
    const contractPersons = titularName
      ? [
          {
            isBillingOwner: true,
            role: 'TITULAR',
            person: { name: titularName },
          },
        ]
      : [];
    return {
      id,
      code,
      status: ContractStatus.ACTIVE,
      contractPersons,
    } as unknown as Contract;
  };

  describe('processContractInactivations', () => {
    it('should inactivate contracts with 3 or more unpaid invoices and send email', async () => {
      const mockContract = createMockContract('c-1', 'CON-001', 'Juan Pérez');

      mockContractRepository.find.mockResolvedValueOnce([mockContract]).mockResolvedValueOnce([]);

      mockQueryRunner.manager.count.mockResolvedValueOnce(3); // 3 unpaid invoices

      await service.processContractInactivations();

      expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(Contract, 'c-1', {
        status: ContractStatus.INACTIVE,
        inactivationReason: expect.stringContaining('3 facturas impagas'),
      });
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockEmailService.sendHtmlEmail).toHaveBeenCalledWith(
        'sircapagos@gmail.com',
        expect.stringContaining('Contratos Inactivados'),
        expect.stringContaining('CON-001'),
      );
    });

    it('should not inactivate contracts with fewer than 3 unpaid invoices', async () => {
      const mockContract = createMockContract('c-1', 'CON-001', 'Juan Pérez');

      mockContractRepository.find.mockResolvedValueOnce([mockContract]).mockResolvedValueOnce([]);

      mockQueryRunner.manager.count.mockResolvedValueOnce(2); // Only 2 unpaid invoices

      await service.processContractInactivations();

      expect(mockQueryRunner.manager.update).not.toHaveBeenCalled();
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockEmailService.sendHtmlEmail).not.toHaveBeenCalled();
    });

    it('should not send email when no contracts are inactivated', async () => {
      mockContractRepository.find.mockResolvedValueOnce([]);

      await service.processContractInactivations();

      expect(mockEmailService.sendHtmlEmail).not.toHaveBeenCalled();
    });

    it('should process multiple contracts and include all inactivated ones in email', async () => {
      const contract1 = createMockContract('c-1', 'CON-001', 'Juan Pérez');
      const contract2 = createMockContract('c-2', 'CON-002', 'María López');
      const contract3 = createMockContract('c-3', 'CON-003', 'Pedro García');

      mockContractRepository.find
        .mockResolvedValueOnce([contract1, contract2, contract3])
        .mockResolvedValueOnce([]);

      mockQueryRunner.manager.count
        .mockResolvedValueOnce(4) // c-1: 4 unpaid → inactivate
        .mockResolvedValueOnce(1) // c-2: 1 unpaid → skip
        .mockResolvedValueOnce(3); // c-3: 3 unpaid → inactivate

      await service.processContractInactivations();

      expect(mockQueryRunner.manager.update).toHaveBeenCalledTimes(2);
      expect(mockEmailService.sendHtmlEmail).toHaveBeenCalledTimes(1);

      const htmlBody = mockEmailService.sendHtmlEmail.mock.calls[0][2];
      expect(htmlBody).toContain('CON-001');
      expect(htmlBody).toContain('CON-003');
      expect(htmlBody).not.toContain('CON-002');
    });

    it('should handle email errors gracefully without affecting inactivation', async () => {
      const mockContract = createMockContract('c-1', 'CON-001', 'Juan Pérez');

      mockContractRepository.find.mockResolvedValueOnce([mockContract]).mockResolvedValueOnce([]);

      mockQueryRunner.manager.count.mockResolvedValueOnce(3);

      mockEmailService.sendHtmlEmail.mockRejectedValueOnce(new Error('SES failure'));

      const loggerSpy = jest.spyOn(service['logger'], 'error').mockImplementation(() => {});

      await service.processContractInactivations();

      // Contract should still be inactivated even though email failed
      expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(Contract, 'c-1', {
        status: ContractStatus.INACTIVE,
        inactivationReason: expect.stringContaining('3 facturas impagas'),
      });

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send inactivation summary email'),
        expect.anything(),
      );

      loggerSpy.mockRestore();
    });

    it('should handle errors during contract evaluation gracefully', async () => {
      const mockContract = createMockContract('c-1', 'CON-001', 'Juan Pérez');

      mockContractRepository.find.mockResolvedValueOnce([mockContract]).mockResolvedValueOnce([]);

      mockQueryRunner.manager.count.mockRejectedValueOnce(new Error('DB error'));

      const loggerSpy = jest.spyOn(service['logger'], 'error').mockImplementation(() => {});

      await service.processContractInactivations();

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
      expect(mockEmailService.sendHtmlEmail).not.toHaveBeenCalled();

      loggerSpy.mockRestore();
    });

    it('should use keyset (cursor) pagination with MoreThan when processing multiple chunks', async () => {
      const contract1 = createMockContract('c-1', 'CON-001', 'Juan Pérez');
      const contract2 = createMockContract('c-2', 'CON-002', 'María López');

      mockContractRepository.find
        .mockResolvedValueOnce([contract1])
        .mockResolvedValueOnce([contract2])
        .mockResolvedValueOnce([]);

      mockQueryRunner.manager.count
        .mockResolvedValueOnce(3) // c-1: 3 unpaid → inactivate
        .mockResolvedValueOnce(3); // c-2: 3 unpaid → inactivate

      await service.processContractInactivations();

      expect(mockContractRepository.find).toHaveBeenCalledTimes(3);

      // First call has no cursor
      expect(mockContractRepository.find.mock.calls[0][0].where).toEqual({
        status: ContractStatus.ACTIVE,
      });

      // Second call uses id: MoreThan('c-1')
      expect(mockContractRepository.find.mock.calls[1][0].where).toEqual({
        status: ContractStatus.ACTIVE,
        id: expect.anything(),
      });

      // Third call uses id: MoreThan('c-2')
      expect(mockContractRepository.find.mock.calls[2][0].where).toEqual({
        status: ContractStatus.ACTIVE,
        id: expect.anything(),
      });

      expect(mockQueryRunner.manager.update).toHaveBeenCalledTimes(2);
    });
  });
});
