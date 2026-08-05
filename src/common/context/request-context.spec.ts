import { DataSource, QueryRunner } from 'typeorm';
import {
  generateRequestId,
  getContext,
  getContextSafe,
  getQueryRunner,
  getQueryRunnerSafe,
  getRequestId,
  requestContextStorage,
  resolveQueryRunner,
} from './request-context';

describe('RequestContext & resolveQueryRunner', () => {
  it('should generate a unique requestId', () => {
    const id1 = generateRequestId();
    const id2 = generateRequestId();
    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toEqual(id2);
  });

  it('should return undefined for getContextSafe when no context is active', () => {
    expect(getContextSafe()).toBeUndefined();
    expect(getQueryRunnerSafe()).toBeUndefined();
    expect(getRequestId()).toBeUndefined();
  });

  it('should throw error for getContext when no context is active', () => {
    expect(() => getContext()).toThrow('[RequestContext] No RequestContext found.');
    expect(() => getQueryRunner()).toThrow('[RequestContext] No RequestContext found.');
  });

  it('should resolve explicit QueryRunner when provided', () => {
    const mockQr = {} as QueryRunner;
    const resolved = resolveQueryRunner(mockQr);
    expect(resolved).toBe(mockQr);
  });

  it('should resolve ALS QueryRunner when context is active', async () => {
    const mockQr = {} as QueryRunner;
    const ctx = {
      queryRunner: mockQr,
      requestId: 'test-req-123',
      startTime: Date.now(),
    };

    await requestContextStorage.run(ctx, async () => {
      expect(getContextSafe()).toEqual(ctx);
      expect(getQueryRunner()).toBe(mockQr);
      expect(getRequestId()).toBe('test-req-123');
      expect(resolveQueryRunner()).toBe(mockQr);
    });
  });

  it('should resolve fallback DataSource when no ALS context exists', () => {
    const mockQr = {} as QueryRunner;
    const mockDs = {
      createQueryRunner: jest.fn().mockReturnValue(mockQr),
    } as unknown as DataSource;

    const resolved = resolveQueryRunner(undefined, mockDs);
    expect(resolved).toBe(mockQr);
    expect(mockDs.createQueryRunner).toHaveBeenCalled();
  });

  it('should resolve fallback target object with dataSource when no ALS context exists', () => {
    const mockQr = {} as QueryRunner;
    const mockDs = {
      createQueryRunner: jest.fn().mockReturnValue(mockQr),
    } as unknown as DataSource;

    const resolved = resolveQueryRunner(undefined, { dataSource: mockDs });
    expect(resolved).toBe(mockQr);
    expect(mockDs.createQueryRunner).toHaveBeenCalled();
  });
});
