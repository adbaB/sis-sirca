import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, finalize } from 'rxjs';
import { DataSource } from 'typeorm';
import { generateRequestId, requestContextStorage } from '../context/request-context';

const TIMEOUT_WARNING_MS = 30_000;

/**
 * Interceptor que crea un QueryRunner dedicado por request HTTP,
 * propaga el contexto usando AsyncLocalStorage y libera la conexión
 * al pool al finalizar (éxito o error).
 *
 * Debe registrarse como APP_INTERCEPTOR en AppModule.
 * Los guards (AuthGuard, PermissionsGuard) se ejecutan ANTES que los
 * interceptores en el pipeline de NestJS, por lo que req.user siempre
 * estará disponible si se necesita en el futuro.
 */
@Injectable()
export class ContextInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ContextInterceptor.name);

  constructor(private readonly dataSource: DataSource) {}

  intercept(executionContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Solo aplica a requests HTTP
    if (executionContext.getType() !== 'http') {
      return next.handle();
    }

    const requestId = generateRequestId();
    const startTime = Date.now();

    // Crear y conectar el QueryRunner dedicado para este request.
    // La conexión se establece de forma lazy por TypeORM al primer uso.
    const queryRunner = this.dataSource.createQueryRunner();

    // Alerta si un request retiene la conexión demasiado tiempo
    const timeoutHandle = setTimeout(() => {
      this.logger.warn(
        `[${requestId}] Request retiene una conexión de DB por más de ${TIMEOUT_WARNING_MS}ms`,
      );
    }, TIMEOUT_WARNING_MS);

    const ctx = {
      queryRunner,
      requestId,
      startTime,
    };

    return new Observable((subscriber) => {
      // Conectar y luego ejecutar el request dentro del contexto ALS
      queryRunner
        .connect()
        .then(() => {
          requestContextStorage.run(ctx, () => {
            next
              .handle()
              .pipe(
                finalize(() => {
                  const duration = Date.now() - startTime;
                  clearTimeout(timeoutHandle);
                  this.logger.debug(`[${requestId}] Request finalizado en ${duration}ms`);

                  // Liberar la conexión de forma segura (sin async dangling)
                  queryRunner.release().catch((err: Error) => {
                    this.logger.error(
                      `[${requestId}] Error al liberar QueryRunner: ${err.message}`,
                    );
                  });
                }),
              )
              .subscribe(subscriber);
          });
        })
        .catch((err: Error) => {
          clearTimeout(timeoutHandle);
          this.logger.error(`[${requestId}] Error al conectar QueryRunner: ${err.message}`);
          subscriber.error(err);
        });
    });
  }
}
