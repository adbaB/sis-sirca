import { DomainException } from './domain-exception.base';
import { ErrorCode } from './error-codes.enum';

export class EntityNotFoundException extends DomainException {
  constructor(entityName: string, identifier: string | number, details?: unknown) {
    super(
      ErrorCode.RESOURCE_NOT_FOUND,
      `${entityName} con identificador "${identifier}" no fue encontrado.`,
      details,
    );
  }
}

export class EntityAlreadyExistsException extends DomainException {
  constructor(entityName: string, identifier: string | number, details?: unknown) {
    super(
      ErrorCode.DUPLICATE_RESOURCE,
      `${entityName} con identificador "${identifier}" ya existe en el sistema.`,
      details,
    );
  }
}

export class InvalidDomainOperationException extends DomainException {
  constructor(
    message: string,
    errorCode: ErrorCode = ErrorCode.INVALID_DOMAIN_OPERATION,
    details?: unknown,
  ) {
    super(errorCode, message, details);
  }
}

export class ExternalServiceException extends DomainException {
  public readonly serviceName: string;
  public readonly originalError?: Error;

  constructor(
    serviceName: string,
    message: string,
    errorCode: ErrorCode = ErrorCode.EXTERNAL_SERVICE_ERROR,
    originalError?: Error,
    details?: unknown,
  ) {
    super(errorCode, `Error en servicio externo [${serviceName}]: ${message}`, details);
    this.serviceName = serviceName;
    this.originalError = originalError;
    if (originalError?.stack) {
      this.stack = `${this.stack}\nCaused by: ${originalError.stack}`;
    }
  }
}

export class UnauthorizedDomainException extends DomainException {
  constructor(message = 'No tiene permisos para realizar esta operación.', details?: unknown) {
    super(ErrorCode.UNAUTHORIZED, message, details);
  }
}
