import { describe, it, expect, vi } from 'vitest';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { ContractQueryRepository } from './contract-query.repository';
import { Contract } from '../entities/contract.entity';
import { RenewalPhase } from '../dto/find-renewals.dto';

describe('ContractQueryRepository', () => {
  it('findRenewalsPaginated applies addSelect and orders by effective_expiration for PENDING_RENEWAL', async () => {
    const qbMock = {
      leftJoin: vi.fn().mockReturnThis(),
      leftJoinAndSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      getRawOne: vi.fn().mockResolvedValue({ expiringSoon: '5', pendingRenewal: '10' }),
      addSelect: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      addOrderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
    } as unknown as SelectQueryBuilder<Contract>;
    const repoMock = {
      createQueryBuilder: vi.fn().mockReturnValue(qbMock),
    } as unknown as Repository<Contract>;
    const repository = new ContractQueryRepository(repoMock);
    const result = await repository.findRenewalsPaginated({
      phase: RenewalPhase.PENDING_RENEWAL,
      page: 1,
      limit: 10,
    });

    expect(qbMock.addSelect).toHaveBeenCalledWith(
      expect.stringContaining('COALESCE(contract.expiration_date'),
      'effective_expiration',
    );
    expect(qbMock.orderBy).toHaveBeenCalledWith('effective_expiration', 'DESC');
    expect(qbMock.addOrderBy).toHaveBeenCalledWith('contract.affiliationDate', 'DESC');
    expect(result.counts).toEqual({ expiringSoon: 5, pendingRenewal: 10 });
  });

  it('findRenewalsPaginated applies addSelect and orders by effective_expiration ASC for EXPIRING_SOON', async () => {
    const qbMock = {
      leftJoin: vi.fn().mockReturnThis(),
      leftJoinAndSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      getRawOne: vi.fn().mockResolvedValue({ expiringSoon: '3', pendingRenewal: '7' }),
      addSelect: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      addOrderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
    } as unknown as SelectQueryBuilder<Contract>;
    const repoMock = {
      createQueryBuilder: vi.fn().mockReturnValue(qbMock),
    } as unknown as Repository<Contract>;
    const repository = new ContractQueryRepository(repoMock);
    const result = await repository.findRenewalsPaginated({
      phase: RenewalPhase.EXPIRING_SOON,
      page: 1,
      limit: 10,
    });

    expect(qbMock.addSelect).toHaveBeenCalledWith(
      expect.stringContaining('COALESCE(contract.expiration_date'),
      'effective_expiration',
    );
    expect(qbMock.orderBy).toHaveBeenCalledWith('effective_expiration', 'ASC');
    expect(qbMock.addOrderBy).toHaveBeenCalledWith('contract.affiliationDate', 'ASC');
    expect(result.counts).toEqual({ expiringSoon: 3, pendingRenewal: 7 });
  });
});
