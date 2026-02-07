import {
  fetchRatesByDate,
  transformToExchangeRates,
  transformToCurrencyTypes
} from '../services/tcmbService';
import {
  upsertCurrencyType,
  upsertExchangeRates,
  getExistingRateDates
} from '../services/databaseService';
import logger from '../utils/logger';

function parseDate(str: string): Date {
  const d = new Date(str);
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${str}`);
  d.setHours(0, 0, 0, 0);
  return d;
}

function* dateRange(from: Date, to: Date): Generator<Date> {
  const current = new Date(from);
  current.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);

  while (current <= end) {
    yield new Date(current);
    current.setDate(current.getDate() + 1);
  }
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeFetchHistoricalJob(
  fromStr: string,
  toStr: string,
  options?: { delayBetweenRequestsMs?: number }
): Promise<{ fetched: number; skipped: number; failed: number }> {
  const fromDate = parseDate(fromStr);
  const toDate = parseDate(toStr);

  if (fromDate > toDate) {
    throw new Error('from date must be before or equal to to date');
  }

  const delayMs = options?.delayBetweenRequestsMs ?? 500;

  logger.info('Starting historical fetch job', {
    from: fromStr,
    to: toStr
  });

  const existingDates = await getExistingRateDates(fromDate, toDate);
  logger.info(`Found ${existingDates.size} existing dates in range`);

  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const date of dateRange(fromDate, toDate)) {
    const key = toDateKey(date);

    if (existingDates.has(key)) {
      skipped++;
      continue;
    }

    try {
      const { response } = await fetchRatesByDate(date);

      logger.info(`Fetched ${key}`, { currencyCount: response.currencies.length });

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

      const exchangeRates = transformToExchangeRates(response);
      const { inserted, updated } = await upsertExchangeRates(exchangeRates);

      logger.info(`Saved ${key}`, { inserted, updated });

      fetched++;
      existingDates.add(key);
    } catch (error) {
      failed++;
      const err = error instanceof Error ? error : new Error(String(error));
      const msg = err.message.toLowerCase();

      if (msg.includes('404') || msg.includes('not found')) {
        logger.debug(`No data for ${key} (weekend/holiday?)`, { error: err.message });
      } else {
        logger.warn(`Failed to fetch ${key}`, { error: err.message });
      }
    }

    await sleep(delayMs);
  }

  logger.info('Historical fetch job completed', {
    fetched,
    skipped,
    failed
  });

  return { fetched, skipped, failed };
}
