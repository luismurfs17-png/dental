import 'dotenv/config';
import path from 'node:path';

const dataDir = path.resolve(process.env.DATA_DIR || './data');

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  dataDir,
  dbFile: path.join(dataDir, 'dentista.sqlite'),
  uploadDir: path.join(dataDir, 'uploads'),
  jwtSecret: process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'clave-local-desarrollo-no-usar-en-produccion'),
  jwtDays: Number(process.env.JWT_DAYS || 7),
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/auth/google/callback'
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'SONRIDENT <no-reply@example.com>',
    cron: process.env.REMINDER_CRON || '0 * * * *',
    hours: Number(process.env.REMINDER_HOURS || 24)
  }
};

if (!config.jwtSecret) throw new Error('JWT_SECRET es obligatorio en producción');
