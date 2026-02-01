import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { getPool, connectDatabase, disconnectDatabase } from '../config';
import logger from '../utils/logger';

dotenv.config();

async function runMigrations(): Promise<void> {
  logger.info('Starting database migrations...');

  try {
    await connectDatabase();
    const pool = getPool();

    const migrationFile = path.join(__dirname, 'init.sql');
    const sql = fs.readFileSync(migrationFile, 'utf-8');

    await pool.query(sql);

    logger.info('Database migrations completed successfully');
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Migration failed', { error: err.message, stack: err.stack });
    throw err;
  } finally {
    await disconnectDatabase();
  }
}

runMigrations()
  .then(() => {
    logger.info('Migration process finished');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Migration process failed', { error: error.message });
    process.exit(1);
  });
