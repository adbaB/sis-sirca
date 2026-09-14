import 'dotenv/config';
import * as Sentry from '@sentry/nestjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  integrations: [
    Sentry.postgresIntegration(),
    Sentry.redisIntegration(),
    Sentry.consoleLoggingIntegration({ levels: ['error', 'warn'] }),
  ],
  enableLogs: true,
  beforeSend(event) {
    // Sanitización de encabezados y tokens de autenticación
    if (event.request) {
      if (event.request.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['cookie'];
        delete event.request.headers['x-api-key'];
      }
      if (event.request.cookies) {
        delete (event.request.cookies as Record<string, unknown>)['access_token'];
      }
    }
    return event;
  },
});
