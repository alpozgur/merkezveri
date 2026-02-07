import { FetchLogStatus } from '../models/types';
import {
  fetchTodayRates,
  transformToExchangeRates,
  transformToCurrencyTypes
} from '../services/tcmbService';
import {
  upsertCurrencyType,
  upsertExchangeRates,
  createFetchLog,
  updateFetchLog
} from '../services/databaseService';
import logger from '../utils/logger';

let isJobRunning = false;

export async function executeFetchRatesJob(): Promise<void> {
  if (isJobRunning) {
    logger.warn('Fetch job already running, skipping scheduled execution');
    return;
  }
  isJobRunning = true;

  let logId: number | undefined;
  const executionStart = new Date();

  try {
    const fetchDate = new Date();
    fetchDate.setHours(0, 0, 0, 0);

    logger.info('Starting fetch rates job');

    // Create initial log entry
    logId = await createFetchLog({
      fetchDate,
      scheduledTime: executionStart,
      executionStart,
      status: 'RUNNING',
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsFailed: 0
    });
    // Fetch rates from TCMB
    logger.info('Fetching rates from TCMB...');
    const { response, responseTimeMs } = await fetchTodayRates();

    logger.info(`TCMB response received in ${responseTimeMs}ms`, {
      date: response.date,
      bulletinNo: response.bulletinNo,
      currencyCount: response.currencies.length
    });

    // Update log with response time
    await updateFetchLog(logId, { tcmbResponseTimeMs: responseTimeMs });

    // Transform and save currency types
    const currencyTypes = transformToCurrencyTypes(response);
    for (const currencyType of currencyTypes) {
      try {
        await upsertCurrencyType(currencyType);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.warn(`Failed to upsert currency type: ${currencyType.currencyCode}`, {
          error: err.message
        });
      }
    }

    // Transform and save exchange rates
    const exchangeRates = transformToExchangeRates(response);
    const { inserted, updated, failed } = await upsertExchangeRates(exchangeRates);

    const executionEnd = new Date();
    const executionTimeMs = executionEnd.getTime() - executionStart.getTime();

    // Determine final status
    let status: FetchLogStatus;
    if (failed === 0) {
      status = 'SUCCESS';
    } else if (inserted + updated > 0) {
      status = 'PARTIAL';
    } else {
      status = 'ERROR';
    }

    // Update log with final results
    await updateFetchLog(logId, {
      executionEnd,
      status,
      recordsInserted: inserted,
      recordsUpdated: updated,
      recordsFailed: failed,
      executionTimeMs
    });

    logger.info('Fetch rates job completed', {
      status,
      inserted,
      updated,
      failed,
      executionTimeMs
    });

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const executionEnd = new Date();
    const executionTimeMs = executionEnd.getTime() - executionStart.getTime();

    logger.error('Fetch rates job failed', {
      error: err.message,
      stack: err.stack
    });

    // Update log with error (only if log was created)
    if (logId !== undefined) {
      await updateFetchLog(logId, {
        executionEnd,
        status: 'ERROR',
        executionTimeMs,
        errorMessage: err.message,
        errorStack: err.stack
      });
    }

    throw err;
  } finally {
    isJobRunning = false;
  }
}

export async function runManualFetch(): Promise<void> {
  logger.info('Manual fetch triggered');
  await executeFetchRatesJob();
}
