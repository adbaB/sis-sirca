import { ErrorCode } from './error-codes.enum';

/**
 * Base domain exception for all business and application errors.
 * Independent of HTTP frameworks (Clean Architecture).
 */
export abstract class DomainException extends Error {
  public readonly timestamp: string;

  constructor(
    public readonly errorCode: ErrorCode | string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = new Date().toISOString();
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
