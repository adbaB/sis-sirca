import { DataSource } from 'typeorm';
import { getQueryRunnerSafe, requestContextStorage } from '../context/request-context';

/**
 * Decorador de método que gestiona automáticamente el ciclo de vida de
 * una transacción de base de datos usando el QueryRunner del contexto ALS.
 *
 * - Si ya hay una transacción activa en el QueryRunner, ejecuta el método
 *   directamente sin anidar (respeta transacciones existentes).
 * - Si no hay transacción activa, inicia una nueva, realiza commit en éxito
 *   y rollback automático en caso de excepción.
 * - Si se ejecuta fuera de un request HTTP (ej: en tests unitarios o crons),
 *   utiliza el `dataSource` de la instancia para crear un QueryRunner temporal.
 *
 * IMPORTANTE: Es un Method Decorator (function wrapper), NO un interceptor
 * de NestJS. Esto lo hace aplicable a métodos de cualquier clase (services,
 * handlers, etc.), no solo en controllers.
 */
export function Transactional(): MethodDecorator {
  return function (_target: object, _key: string | symbol, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>;

    descriptor.value = async function (...args: unknown[]): Promise<unknown> {
      const alsQr = getQueryRunnerSafe();

      if (alsQr) {
        // Ejecución dentro de un request HTTP (ALS activo)
        if (alsQr.isTransactionActive) {
          return originalMethod.apply(this, args);
        }
        await alsQr.startTransaction();
        try {
          const result = await originalMethod.apply(this, args);
          await alsQr.commitTransaction();
          return result;
        } catch (err) {
          if (alsQr.isTransactionActive) {
            await alsQr.rollbackTransaction();
          }
          throw err;
        }
      }

      // Si no hay contexto ALS (ej: tests unitarios, scripts, crons):
      // Si la clase del servicio posee `dataSource`, creamos un QueryRunner temporal.
      const dataSource = (this as Record<string, unknown>)?.dataSource as DataSource | undefined;
      if (dataSource && typeof dataSource.createQueryRunner === 'function') {
        const qr = dataSource.createQueryRunner();
        await qr.connect();
        await qr.startTransaction();
        try {
          const result = await requestContextStorage.run(
            { queryRunner: qr, requestId: `cron-${Date.now()}`, startTime: Date.now() },
            () => originalMethod.apply(this, args),
          );
          await qr.commitTransaction();
          return result;
        } catch (err) {
          if (qr.isTransactionActive) {
            await qr.rollbackTransaction();
          }
          throw err;
        } finally {
          await qr.release();
        }
      }

      // Si no hay ni ALS ni dataSource, ejecutar el método directamente
      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}
