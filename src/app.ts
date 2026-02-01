import * as dotenv from 'dotenv';
dotenv.config();

import * as cron from 'node-cron';
import { connectDatabase, disconnectDatabase, getConfig } from './config';
import { executeFetchRatesJob } from './jobs/fetchRatesJob';
import logger from './utils/logger';

let scheduledTask: cron.ScheduledTask | null = null;

async function startScheduler(): Promise<void> {
  const config = getConfig();

  if (!config.scheduler.enabled) {
    logger.info('Scheduler is disabled');
    return;
  }

  const cronExpression = config.scheduler.cronSchedule;

  if (!cron.validate(cronExpression)) {
    throw new Error(`Invalid cron expression: ${cronExpression}`);
  }

  scheduledTask = cron.schedule(
    cronExpression,
    async () => {
      logger.info('Scheduled job triggered');
      try {
        await executeFetchRatesJob();
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error('Scheduled job failed', { error: err.message });
      }
    },
    {
      timezone: config.scheduler.timezone
    }
  );

  logger.info(`Scheduler started with cron: ${cronExpression} (${config.scheduler.timezone})`);
}

function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    logger.info('Scheduler stopped');
  }
}

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  stopScheduler();
  await disconnectDatabase();

  logger.info('Shutdown complete');
  process.exit(0);
}

async function main(): Promise<void> {
  logger.info('='.repeat(50));
  logger.info('TCMB Exchange Rates Fetcher starting...');
  logger.info('='.repeat(50));

  const config = getConfig();
  logger.info('Configuration loaded', {
    nodeEnv: config.nodeEnv,
    schedulerEnabled: config.scheduler.enabled,
    cronSchedule: config.scheduler.cronSchedule
  });

  // Connect to database
  await connectDatabase();

  // Start scheduler
  await startScheduler();

  // Handle graceful shutdown
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Check for manual run flag
  const args = process.argv.slice(2);
  if (args.includes('--run-now') || args.includes('-r')) {
    logger.info('Manual run flag detected, executing fetch job immediately...');
    try {
      await executeFetchRatesJob();
      logger.info('Manual fetch completed');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Manual fetch failed', { error: err.message });
    }

    // If only running once, exit
    if (args.includes('--once')) {
      await gracefulShutdown('MANUAL');
    }
  }

  logger.info('Application is running. Press Ctrl+C to stop.');
}

main().catch((error) => {
  logger.error('Application failed to start', { error: error.message, stack: error.stack });
  process.exit(1);
});
