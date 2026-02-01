import { AppConfig } from '../models/types';
import { getDatabaseConfig } from './database';

export function getConfig(): AppConfig {
  return {
    database: getDatabaseConfig(),
    tcmb: {
      todayUrl: process.env.TCMB_TODAY_URL || 'https://www.tcmb.gov.tr/kurlar/today.xml',
      requestTimeout: parseInt(process.env.TCMB_REQUEST_TIMEOUT || '10000', 10),
      maxRetryAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS || '3', 10),
      retryDelayMs: parseInt(process.env.RETRY_DELAY_MS || '2000', 10)
    },
    scheduler: {
      cronSchedule: process.env.CRON_SCHEDULE || '30 15 * * *',
      timezone: process.env.TIMEZONE || 'Europe/Istanbul',
      enabled: process.env.ENABLE_SCHEDULER !== 'false'
    },
    logging: {
      level: process.env.LOG_LEVEL || 'info',
      dir: process.env.LOG_DIR || './logs'
    },
    nodeEnv: process.env.NODE_ENV || 'development'
  };
}

export { getPool, connectDatabase, disconnectDatabase, getDatabaseConfig } from './database';
