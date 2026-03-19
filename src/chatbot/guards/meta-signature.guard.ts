import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class MetaSignatureGuard implements CanActivate {
  private readonly logger = new Logger(MetaSignatureGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const signatureHeader = request.headers['x-hub-signature-256'];

    if (!signatureHeader) {
      this.logger.warn('Missing x-hub-signature-256 header.');
      throw new UnauthorizedException('Missing signature header.');
    }

    const appSecret = this.configService.get<string>('config.meta.appSecret');

    if (!appSecret) {
      this.logger.error(
        'Missing META_APP_SECRET in environment variables. Rejecting request for security.',
      );
      throw new UnauthorizedException('Server configuration error.');
    }

    const rawBody = request.rawBody;

    if (!rawBody) {
      this.logger.warn('Raw body is undefined. Check main.ts configuration (rawBody: true).');
      throw new UnauthorizedException('Missing raw body.');
    }

    const expectedSignature = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;

    // Use timingSafeEqual to prevent timing attacks
    try {
      if (expectedSignature.length !== signatureHeader.length) {
        throw new Error('Length mismatch');
      }

      const match = crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(signatureHeader),
      );
      if (!match) {
        throw new Error('Signature mismatch');
      }
    } catch (error) {
      this.logger.warn('Invalid signature received from Meta webhook.');
      throw new UnauthorizedException('Invalid signature.');
    }

    return true;
  }
}
