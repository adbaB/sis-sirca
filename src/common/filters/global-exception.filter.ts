import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Request, Response } from 'express';
import { getRequestId } from '../context/request-context';
import {
  DomainException,
  EntityAlreadyExistsException,
  EntityNotFoundException,
  ExternalServiceException,
  UnauthorizedDomainException,
} from '../exceptions';
import { ErrorCode } from '../exceptions/error-codes.enum';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = getRequestId() ?? 'N/A';

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorCode: string = ErrorCode.INTERNAL_SERVER_ERROR;
    let message: string;
    let details: unknown = undefined;

    if (exception instanceof DomainException) {
      statusCode = this.mapDomainExceptionToHttpStatus(exception);
      errorCode = exception.errorCode;
      message = exception.message;
      details = exception.details;

      if (statusCode >= 500 || exception instanceof ExternalServiceException) {
        this.logger.error(
          `[${requestId}] DomainException [${errorCode}]: ${message}`,
          exception.stack,
        );
        this.reportToSentry(exception, requestId, request);
      } else {
        this.logger.warn(`[${requestId}] DomainException [${errorCode}]: ${message}`);
      }
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, unknown>;
        message = (resObj.message as string) || exception.message;
        details = Array.isArray(resObj.message) ? resObj.message : resObj.details;
        errorCode = (resObj.error as string) || this.mapStatusToErrorCode(statusCode);
      } else {
        message = typeof res === 'string' ? res : exception.message;
        errorCode = this.mapStatusToErrorCode(statusCode);
      }

      if (statusCode >= 500) {
        this.logger.error(
          `[${requestId}] HttpException [${statusCode}]: ${message}`,
          exception.stack,
        );
        this.reportToSentry(exception, requestId, request);
      } else {
        this.logger.warn(`[${requestId}] HttpException [${statusCode}]: ${message}`);
      }
    } else {
      // Unhandled unknown error (JS Error, etc.)
      const err = exception instanceof Error ? exception : new Error(String(exception));
      message = 'Ocurrió un error inesperado en el servidor.';

      this.logger.error(`[${requestId}] UnhandledException: ${err.message}`, err.stack);
      this.reportToSentry(err, requestId, request);
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

  private mapDomainExceptionToHttpStatus(exception: DomainException): number {
    if (exception instanceof EntityNotFoundException) return HttpStatus.NOT_FOUND;
    if (exception instanceof EntityAlreadyExistsException) return HttpStatus.CONFLICT;
    if (exception instanceof UnauthorizedDomainException) return HttpStatus.UNAUTHORIZED;
    if (exception instanceof ExternalServiceException) return HttpStatus.BAD_GATEWAY;
    return HttpStatus.BAD_REQUEST;
  }

  private mapStatusToErrorCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.INVALID_INPUT;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.RESOURCE_NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.DUPLICATE_RESOURCE;
      default:
        return ErrorCode.INTERNAL_SERVER_ERROR;
    }
  }

  private reportToSentry(exception: Error, requestId: string, request: Request): void {
    Sentry.withScope((scope) => {
      scope.setTag('requestId', requestId);
      scope.setExtra('url', request.url);
      scope.setExtra('method', request.method);
      Sentry.captureException(exception);
    });
  }
}
