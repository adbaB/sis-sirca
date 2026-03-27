import { registerAs } from '@nestjs/config';

export default registerAs('config', () => {
  return {
    server: {
      port: parseInt(process.env.PORT ?? '3000', 10),
    },
    db: {
      database: process.env.POSTGRES_DB,
      host: process.env.POSTGRES_HOST,
      password: process.env.POSTGRES_PASSWORD,
      port: parseInt(process.env.POSTGRES_PORT, 10),
      username: process.env.POSTGRES_USER,
    },
    file: {
      maxSize: parseInt(process.env.FILE_MAX_SIZE, 10) || 100 * 1024 * 1024,
    },
    drive: {
      clientEmail: process.env.GOOGLE_DRIVE_CLIENT_EMAIL,
      privateKey: process.env.GOOGLE_DRIVE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      excelFileId: process.env.GOOGLE_DRIVE_EXCEL_FILE_ID,
      clientId: process.env.GOOGLE_DRIVE_CLIENT_ID,
    },

    openrouter: {
      apiKey: process.env.OPENROUTER_API_KEY,
    },

    meta: {
      appSecret: process.env.META_APP_SECRET,
      accessToken: process.env.META_ACCESS_TOKEN,
      phoneNumberId: process.env.META_PHONE_NUMBER_ID,
      flowId: process.env.META_FLOW_ID,
      verifyToken: process.env.META_VERIFY_TOKEN,
      flowPrivateKey: process.env.META_FLOW_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      flowPassphrase: process.env.META_FLOW_PASSPHRASE,
    },

    aws: {
      region: process.env.AWS_REGION,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sesFromEmail: process.env.SES_FROM_EMAIL || 'noreply@sirca.com.ve',
      s3Bucket: process.env.AWS_S3_BUCKET,
      notificationEmail: process.env.NOTIFICATION_EMAIL,
    },

    googleSpreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
    googleClientEmail: process.env.GOOGLE_CLIENT_EMAIL,
    googlePrivateKey: process.env.GOOGLE_PRIVATE_KEY,

    env: process.env.NODE_ENV || 'development',
  };
});
