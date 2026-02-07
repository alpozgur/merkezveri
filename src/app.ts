import * as dotenv from 'dotenv';
dotenv.config();

import * as cron from 'node-cron';
import { connectDatabase, disconnectDatabase, getConfig } from './config';
import { executeFetchRatesJob } from './jobs/fetchRatesJob';
import { executeFetchHistoricalJob } from './jobs/fetchHistoricalJob';
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
    () => {
      setImmediate(async () => {
        logger.info('Scheduled job triggered');
        try {
          await executeFetchRatesJob();
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          logger.error('Scheduled job failed', { error: err.message });
        }
      });
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

  const args = process.argv.slice(2);

  // Fill historical data (runs once and exits)
  if (args.includes('--fill-history')) {
    const fromArg = args.find((a) => a.startsWith('--from='));
    const toArg = args.find((a) => a.startsWith('--to='));
    const fillIdx = args.indexOf('--fill-history');
    const from = fromArg ? fromArg.split('=')[1] : args[fillIdx + 1];
    const to = toArg ? toArg.split('=')[1] : args[fillIdx + 2];

    if (!from || !to) {
      logger.error('Usage: --fill-history --from=YYYY-MM-DD --to=YYYY-MM-DD');
      process.exit(1);
    }

    try {
      const result = await executeFetchHistoricalJob(from, to);
      logger.info('Historical fill completed', result);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Historical fill failed', { error: err.message });
      process.exit(1);
    }

    await gracefulShutdown('FILL_HISTORY');
    return;
  }

  // Start scheduler
  await startScheduler();

  // Handle graceful shutdown
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Check for manual run flag
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
