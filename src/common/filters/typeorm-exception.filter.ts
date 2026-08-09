import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Response, Request } from 'express';
import { QueryFailedError } from 'typeorm';
import { ErrorCode } from '../exceptions/error-codes.enum';
import { getRequestId } from '../context/request-context';

interface PostgresDriverError extends Error {
  code?: string;
  detail?: string;
  constraint?: string;
  column?: string;
  table?: string;
}

@Catch(QueryFailedError)
export class TypeOrmExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(TypeOrmExceptionFilter.name);

  catch(exception: QueryFailedError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = getRequestId() ?? 'N/A';

    const driverError = exception.driverError as PostgresDriverError | undefined;
    const pgCode = driverError?.code;

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorCode = ErrorCode.INTERNAL_SERVER_ERROR;
    let message = 'Ocurrió un error en la base de datos.';
    let details: unknown = undefined;

    switch (pgCode) {
      case '23505': // unique_violation
        statusCode = HttpStatus.CONFLICT;
        errorCode = ErrorCode.DUPLICATE_RESOURCE;
        message = 'El registro ingresado ya existe en la base de datos.';
        details = driverError?.detail ? { info: driverError.detail } : undefined;
        break;

      case '23503': // foreign_key_violation
        statusCode = HttpStatus.BAD_REQUEST;
        errorCode = ErrorCode.FOREIGN_KEY_VIOLATION;
        message = 'La entidad referenciada no existe o no se puede eliminar por dependencias.';
        details = driverError?.detail ? { info: driverError.detail } : undefined;
        break;

      case '23502': // not_null_violation
        statusCode = HttpStatus.BAD_REQUEST;
        errorCode = ErrorCode.MISSING_REQUIRED_FIELD;
        message = `El campo '${driverError?.column ?? 'requerido'}' no puede ser nulo.`;
        break;

      default:
        this.logger.error(
          `[${requestId}] Database QueryFailedError: ${exception.message}`,
          exception.stack,
        );
        break;
    }

    if (statusCode >= 500) {
      this.logger.error(`[${requestId}] DB Error [${pgCode ?? 'UNKNOWN'}]: ${exception.message}`);
    } else {
      this.logger.warn(`[${requestId}] DB Warning [${pgCode ?? 'UNKNOWN'}]: ${message}`);
    }

    response.status(statusCode).json({
      success: false,
      statusCode,
      errorCode,
      message,
      ...(details ? { details } : {}),
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId,
    });
  }
}
