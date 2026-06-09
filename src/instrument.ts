// Import with `const Sentry = require("@sentry/nestjs");` if you are using CJS
import * as Sentry from '@sentry/nestjs';

Sentry.init({
  dsn:
    process.env.SENTRY_DSN ||
    'https://03feb03ca1fb8ae238c4681eb7546b9a@o4511531474550784.ingest.us.sentry.io/4511531506008064',
  environment: process.env.NODE_ENV || 'development',
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  // To disable sending user data, uncomment the line below. For more info visit:
  // https://docs.sentry.io/platforms/javascript/guides/node/configuration/options/#dataCollection
  // dataCollection: { userInfo: false },
});
