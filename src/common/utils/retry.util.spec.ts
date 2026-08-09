import { withRetry } from './retry.util';

describe('withRetry', () => {
  it('should return result on first attempt if successful', async () => {
    const fn = jest.fn().mockResolvedValue('success');
    const result = await withRetry(fn, { maxAttempts: 3, backoffMs: 10 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and return result when attempt succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('Transient failure'))
      .mockResolvedValueOnce('recovered');

    const result = await withRetry(fn, { maxAttempts: 3, backoffMs: 10, jitter: false });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should throw last error when maxAttempts is reached', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('Persistent error'));

    await expect(withRetry(fn, { maxAttempts: 3, backoffMs: 5, jitter: false })).rejects.toThrow(
      'Persistent error',
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
