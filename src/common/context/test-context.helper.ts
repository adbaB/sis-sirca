import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { requestContextStorage } from './request-context';

/**
 * Helper para ejecutar pruebas unitarias o de integración dentro de un
 * contexto ALS simulado. Permite testear servicios que usen getQueryRunner()
 * sin necesidad de un request HTTP real.
 *
 * @param dataSource - DataSource de TypeORM para crear el QueryRunner
 * @param fn - Función async a ejecutar dentro del contexto ALS
 * @returns El resultado de fn
 *
 * @example
 * ```typescript
 * it('should create invoice', async () => {
 *   const result = await runInContext(dataSource, async () => {
 *     return invoiceService.generateInvoiceForContract(contractId);
 *   });
 *   expect(result).toBeDefined();
 * });
 * ```
 */
export async function runInContext<T>(dataSource: DataSource, fn: () => Promise<T>): Promise<T> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  try {
    return await requestContextStorage.run(
      {
        queryRunner,
        requestId: `test-${randomUUID()}`,
        startTime: Date.now(),
      },
      fn,
    );
  } finally {
    await queryRunner.release();
  }
}
