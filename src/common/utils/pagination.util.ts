import { SelectQueryBuilder, FindManyOptions, Repository } from 'typeorm';
import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { PaginatedResult } from '../interfaces/paginated-result.interface';

/**
 * Paginates a TypeORM QueryBuilder.
 */
export async function paginateQueryBuilder<T>(
  queryBuilder: SelectQueryBuilder<T>,
  paginationQuery: PaginationQueryDto,
): Promise<PaginatedResult<T>> {
  const page = paginationQuery.page || 1;
  const limit = paginationQuery.limit || 10;
  const skip = (page - 1) * limit;

  queryBuilder.skip(skip).take(limit);

  const [data, totalItems] = await queryBuilder.getManyAndCount();

  return createPaginatedResult(data, totalItems, page, limit);
}

/**
 * Paginates a standard TypeORM Repository find.
 */
export async function paginateRepository<T>(
  repository: Repository<T>,
  options: FindManyOptions<T>,
  paginationQuery: PaginationQueryDto,
): Promise<PaginatedResult<T>> {
  const page = paginationQuery.page || 1;
  const limit = paginationQuery.limit || 10;
  const skip = (page - 1) * limit;

  const findOptions: FindManyOptions<T> = {
    ...options,
    skip,
    take: limit,
  };

  const [data, totalItems] = await repository.findAndCount(findOptions);

  return createPaginatedResult(data, totalItems, page, limit);
}

function createPaginatedResult<T>(
  data: T[],
  totalItems: number,
  page: number,
  limit: number,
): PaginatedResult<T> {
  const totalPages = Math.ceil(totalItems / limit);

  return {
    data,
    meta: {
      totalItems,
      itemCount: data.length,
      itemsPerPage: limit,
      totalPages,
      currentPage: page,
    },
  };
}
