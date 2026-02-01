import { Pool, PoolConfig } from 'pg';
import { DatabaseConfig } from '../models/types';
import logger from '../utils/logger';

let pool: Pool | null = null;

export function getDatabaseConfig(): DatabaseConfig {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'tcmb_exchange_rates',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    max: parseInt(process.env.DB_MAX_CONNECTIONS || '10', 10)
  };
}

export function getPool(): Pool {
  if (!pool) {
    const config = getDatabaseConfig();
    const poolConfig: PoolConfig = {
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: config.max
    };

    pool = new Pool(poolConfig);

    pool.on('error', (err) => {
      logger.error('Unexpected database pool error', { error: err.message });
    });

    pool.on('connect', () => {
      logger.debug('New database connection established');
    });
  }

  return pool;
}

export async function connectDatabase(): Promise<void> {
  const db = getPool();
  try {
    const client = await db.connect();
    logger.info('Database connection successful');
    client.release();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Database connection failed', { error: err.message });
    throw err;
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database connection closed');
  }
}
