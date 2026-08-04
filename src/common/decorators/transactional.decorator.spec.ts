import { DataSource, QueryRunner } from 'typeorm';
import { Transactional } from './transactional.decorator';
import {
  getQueryRunnerSafe,
  registerPostCommitHook,
  requestContextStorage,
} from '../context/request-context';

describe('Transactional Decorator', () => {
  let mockQueryRunner: Partial<QueryRunner>;

  beforeEach(() => {
    mockQueryRunner = {
      isTransactionActive: false,
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockImplementation(async () => {
        (mockQueryRunner as { isTransactionActive: boolean }).isTransactionActive = true;
      }),
      commitTransaction: jest.fn().mockImplementation(async () => {
        (mockQueryRunner as { isTransactionActive: boolean }).isTransactionActive = false;
      }),
      rollbackTransaction: jest.fn().mockImplementation(async () => {
        (mockQueryRunner as { isTransactionActive: boolean }).isTransactionActive = false;
      }),
      release: jest.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  class TestService {
    dataSource?: Partial<DataSource>;

    constructor(ds?: Partial<DataSource>) {
      this.dataSource = ds;
    }

    @Transactional()
    async doWork(): Promise<string> {
      return 'work-done';
    }

    @Transactional()
    async doWorkWithHook(): Promise<string> {
      registerPostCommitHook(() => {
        // hook
      });
      return 'work-with-hook';
    }

    @Transactional()
    async failingWork(): Promise<never> {
      throw new Error('Work failed');
    }

    @Transactional()
    async outerWork(): Promise<string> {
      const innerResult = await this.innerWork();
      return `outer-${innerResult}`;
    }

    @Transactional()
    async innerWork(): Promise<string> {
      // Verify that innerWork gets the active query runner from ALS
      const qr = getQueryRunnerSafe();
      if (!qr) throw new Error('No QR in innerWork');
      return 'inner';
    }
  }

  describe('When running inside ALS HTTP Context', () => {
    it('should start transaction, execute method, commit and run post-commit hooks if transaction is not active', async () => {
      const service = new TestService();
      const hookFn = jest.fn();

      await requestContextStorage.run(
        {
          queryRunner: mockQueryRunner as QueryRunner,
          requestId: 'test-req',
          startTime: Date.now(),
        },
        async () => {
          registerPostCommitHook(hookFn);
          const result = await service.doWork();

          expect(result).toBe('work-done');
          expect(mockQueryRunner.startTransaction).toHaveBeenCalledTimes(1);
          expect(mockQueryRunner.commitTransaction).toHaveBeenCalledTimes(1);
          expect(hookFn).toHaveBeenCalledTimes(1);
        },
      );
    });

    it('should NOT start a new transaction if one is already active', async () => {
      (mockQueryRunner as { isTransactionActive: boolean }).isTransactionActive = true;
      const service = new TestService();

      await requestContextStorage.run(
        {
          queryRunner: mockQueryRunner as QueryRunner,
          requestId: 'test-req',
          startTime: Date.now(),
        },
        async () => {
          const result = await service.doWork();

          expect(result).toBe('work-done');
          expect(mockQueryRunner.startTransaction).not.toHaveBeenCalled();
          expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
        },
      );
    });

    it('should rollback transaction if method throws an error', async () => {
      const service = new TestService();

      await requestContextStorage.run(
        {
          queryRunner: mockQueryRunner as QueryRunner,
          requestId: 'test-req',
          startTime: Date.now(),
        },
        async () => {
          await expect(service.failingWork()).rejects.toThrow('Work failed');

          expect(mockQueryRunner.startTransaction).toHaveBeenCalledTimes(1);
          expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
          expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
        },
      );
    });
  });

  describe('When running outside ALS Context (Cron/Test Fallback)', () => {
    it('should create a QueryRunner, start transaction, propagate ALS for nested calls, commit and release', async () => {
      const mockDs: Partial<DataSource> = {
        createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner as QueryRunner),
      };

      const service = new TestService(mockDs);
      const result = await service.outerWork();

      expect(result).toBe('outer-inner');
      expect(mockDs.createQueryRunner).toHaveBeenCalledTimes(1);
      expect(mockQueryRunner.connect).toHaveBeenCalledTimes(1);
      expect(mockQueryRunner.startTransaction).toHaveBeenCalledTimes(1);
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalledTimes(1);
      expect(mockQueryRunner.release).toHaveBeenCalledTimes(1);
    });

    it('should rollback and release QueryRunner if fallback execution throws an error', async () => {
      const mockDs: Partial<DataSource> = {
        createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner as QueryRunner),
      };

      const service = new TestService(mockDs);
      await expect(service.failingWork()).rejects.toThrow('Work failed');

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(mockQueryRunner.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('When running with no ALS and no DataSource', () => {
    it('should execute method directly without transaction management', async () => {
      const service = new TestService(undefined);
      const result = await service.doWork();

      expect(result).toBe('work-done');
      expect(mockQueryRunner.startTransaction).not.toHaveBeenCalled();
    });
  });
});
