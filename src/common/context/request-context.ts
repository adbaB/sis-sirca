import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { DataSource, QueryRunner } from 'typeorm';

/**
 * Estructura del contexto que viaja a lo largo del request HTTP.
 */
export interface RequestContext {
  queryRunner: QueryRunner;
  requestId: string;
  startTime: number;
  postCommitHooks?: Array<() => Promise<void> | void>;
}

/**
 * Singleton global de AsyncLocalStorage.
 * Una sola instancia en toda la aplicación. ALS garantiza aislamiento
 * entre requests concurrentes: cada cadena de async/await tiene su propio store.
 */
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Genera un ID único para el request actual.
 */
export function generateRequestId(): string {
  return randomUUID();
}

/**
 * Obtiene el contexto completo del request actual.
 * @throws Error si se llama fuera de un contexto ALS (p.ej. en un cron job).
 */
export function getContext(): RequestContext {
  const ctx = requestContextStorage.getStore();
  if (!ctx) {
    throw new Error(
      '[RequestContext] No RequestContext found. ' +
        'Asegúrate de que ContextInterceptor esté registrado y que ' +
        'este código se ejecute dentro de un request HTTP. ' +
        'Para cron jobs o workers usa getContextSafe() o this.dataSource directamente.',
    );
  }
  return ctx;
}

/**
 * Obtiene el contexto del request de forma segura.
 * @returns RequestContext o undefined si no hay contexto (p.ej. cron jobs).
 */
export function getContextSafe(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

/**
 * Obtiene el QueryRunner dedicado del request actual.
 * @throws Error si se llama fuera de un contexto ALS.
 */
export function getQueryRunner(): QueryRunner {
  return getContext().queryRunner;
}

/**
 * Obtiene el QueryRunner del request actual de forma segura.
 * @returns QueryRunner o undefined si no hay contexto.
 */
export function getQueryRunnerSafe(): QueryRunner | undefined {
  return getContextSafe()?.queryRunner;
}

/**
 * Registra un callback que se ejecutará inmediatamente después de que
 * la transacción principal realice su commit exitoso.
 */
export function registerPostCommitHook(hook: () => Promise<void> | void): void {
  const ctx = getContextSafe();
  if (ctx) {
    if (!ctx.postCommitHooks) {
      ctx.postCommitHooks = [];
    }
    ctx.postCommitHooks.push(hook);
  }
}

/**
 * Ejecuta todos los callbacks post-commit registrados en el contexto actual.
 */
export async function runPostCommitHooks(ctx?: RequestContext): Promise<void> {
  const currentCtx = ctx || getContextSafe();
  const hooks = currentCtx?.postCommitHooks;
  if (hooks && hooks.length > 0) {
    currentCtx.postCommitHooks = [];
    for (const hook of hooks) {
      try {
        await hook();
      } catch (err) {
        console.error('[RequestContext] Error in post-commit hook:', err);
      }
    }
  }
}

/**
 * Patrón puente para migración gradual.
 * Si se provee un QueryRunner explícito (de firmas heredadas), lo usa.
 * De lo contrario, intenta obtener el del contexto ALS.
 * Si no hay contexto ALS y se provee un fallback (DataSource u objeto con dataSource),
 * genera un nuevo QueryRunner del fallback.
 *
 * NOTA: Si se usa el fallback sin contexto ALS, la función llamadora es responsable de
 * conectar, gestionar transacciones y liberar el QueryRunner (`release()`) retornado.
 *
 * @param explicit - QueryRunner explícito (opcional, para compatibilidad)
 * @param fallback - DataSource u objeto que contiene dataSource (opcional)
 * @returns El QueryRunner a usar
 */
export function resolveQueryRunner(
  explicit?: QueryRunner,
  fallback?: DataSource | { dataSource: DataSource },
): QueryRunner {
  if (explicit) return explicit;
  const alsQr = getQueryRunnerSafe();
  if (alsQr) return alsQr;
  if (fallback) {
    const ds = 'createQueryRunner' in fallback ? fallback : fallback?.dataSource;
    if (ds && typeof ds.createQueryRunner === 'function') {
      return ds.createQueryRunner();
    }
  }
  return getQueryRunner();
}

/**
 * Obtiene el requestId único del request actual.
 * @returns string UUID del request o undefined.
 */
export function getRequestId(): string | undefined {
  return getContextSafe()?.requestId;
}
