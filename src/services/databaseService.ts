import { getPool } from '../config';
import { ExchangeRate, CurrencyType, FetchLog, FetchLogStatus } from '../models/types';
import logger from '../utils/logger';

export async function upsertCurrencyType(currency: CurrencyType): Promise<void> {
  const pool = getPool();

  const query = `
    INSERT INTO currency_types (currency_code, currency_name, currency_name_tr, is_active)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (currency_code)
    DO UPDATE SET
      currency_name = EXCLUDED.currency_name,
      currency_name_tr = EXCLUDED.currency_name_tr,
      is_active = EXCLUDED.is_active,
      updated_at = CURRENT_TIMESTAMP
  `;

  await pool.query(query, [
    currency.currencyCode,
    currency.currencyName,
    currency.currencyNameTR,
    currency.isActive
  ]);
}

export async function upsertExchangeRate(rate: ExchangeRate): Promise<{ inserted: boolean }> {
  const pool = getPool();

  const query = `
    INSERT INTO exchange_rates (
      currency_code, rate_date, forex_buying, forex_selling,
      banknote_buying, banknote_selling, unit, cross_rate_usd, cross_rate_other
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (currency_code, rate_date)
    DO UPDATE SET
      forex_buying = EXCLUDED.forex_buying,
      forex_selling = EXCLUDED.forex_selling,
      banknote_buying = EXCLUDED.banknote_buying,
      banknote_selling = EXCLUDED.banknote_selling,
      unit = EXCLUDED.unit,
      cross_rate_usd = EXCLUDED.cross_rate_usd,
      cross_rate_other = EXCLUDED.cross_rate_other,
      updated_at = CURRENT_TIMESTAMP
    RETURNING (xmax = 0) as inserted
  `;

  const result = await pool.query(query, [
    rate.currencyCode,
    rate.rateDate,
    rate.forexBuying,
    rate.forexSelling,
    rate.banknoteBuying,
    rate.banknoteSelling,
    rate.unit,
    rate.crossRateUSD,
    rate.crossRateOther
  ]);

  return { inserted: result.rows[0]?.inserted ?? true };
}

export async function upsertExchangeRates(
  rates: ExchangeRate[]
): Promise<{ inserted: number; updated: number; failed: number }> {
  let inserted = 0;
  let updated = 0;
  let failed = 0;

  for (const rate of rates) {
    try {
      const result = await upsertExchangeRate(rate);
      if (result.inserted) {
        inserted++;
      } else {
        updated++;
      }
    } catch (error) {
      failed++;
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`Failed to upsert rate for ${rate.currencyCode}`, {
        error: err.message
      });
    }
  }

  return { inserted, updated, failed };
}

export async function createFetchLog(log: Omit<FetchLog, 'id' | 'createdAt'>): Promise<number> {
  const pool = getPool();

  const query = `
    INSERT INTO fetch_logs (
      fetch_date, scheduled_time, execution_start, execution_end,
      status, records_inserted, records_updated, records_failed,
      execution_time_ms, error_message, error_stack, tcmb_response_time_ms
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING id
  `;

  const result = await pool.query(query, [
    log.fetchDate,
    log.scheduledTime,
    log.executionStart,
    log.executionEnd,
    log.status,
    log.recordsInserted,
    log.recordsUpdated,
    log.recordsFailed,
    log.executionTimeMs,
    log.errorMessage,
    log.errorStack,
    log.tcmbResponseTimeMs
  ]);

  return result.rows[0].id;
}

export async function updateFetchLog(
  id: number,
  updates: Partial<FetchLog>
): Promise<void> {
  const pool = getPool();

  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.executionEnd !== undefined) {
    fields.push(`execution_end = $${paramIndex++}`);
    values.push(updates.executionEnd);
  }
  if (updates.status !== undefined) {
    fields.push(`status = $${paramIndex++}`);
    values.push(updates.status);
  }
  if (updates.recordsInserted !== undefined) {
    fields.push(`records_inserted = $${paramIndex++}`);
    values.push(updates.recordsInserted);
  }
  if (updates.recordsUpdated !== undefined) {
    fields.push(`records_updated = $${paramIndex++}`);
    values.push(updates.recordsUpdated);
  }
  if (updates.recordsFailed !== undefined) {
    fields.push(`records_failed = $${paramIndex++}`);
    values.push(updates.recordsFailed);
  }
  if (updates.executionTimeMs !== undefined) {
    fields.push(`execution_time_ms = $${paramIndex++}`);
    values.push(updates.executionTimeMs);
  }
  if (updates.errorMessage !== undefined) {
    fields.push(`error_message = $${paramIndex++}`);
    values.push(updates.errorMessage);
  }
  if (updates.errorStack !== undefined) {
    fields.push(`error_stack = $${paramIndex++}`);
    values.push(updates.errorStack);
  }
  if (updates.tcmbResponseTimeMs !== undefined) {
    fields.push(`tcmb_response_time_ms = $${paramIndex++}`);
    values.push(updates.tcmbResponseTimeMs);
  }

  if (fields.length === 0) return;

  values.push(id);
  const query = `UPDATE fetch_logs SET ${fields.join(', ')} WHERE id = $${paramIndex}`;

  await pool.query(query, values);
}

export async function getLatestRates(): Promise<ExchangeRate[]> {
  const pool = getPool();

  const query = `
    SELECT
      id, currency_code, rate_date,
      forex_buying, forex_selling,
      banknote_buying, banknote_selling,
      unit, cross_rate_usd, cross_rate_other,
      created_at, updated_at
    FROM exchange_rates
    WHERE rate_date = (SELECT MAX(rate_date) FROM exchange_rates)
    ORDER BY currency_code
  `;

  const result = await pool.query(query);

  return result.rows.map(row => ({
    id: row.id,
    currencyCode: row.currency_code,
    rateDate: row.rate_date,
    forexBuying: parseFloat(row.forex_buying),
    forexSelling: parseFloat(row.forex_selling),
    banknoteBuying: parseFloat(row.banknote_buying),
    banknoteSelling: parseFloat(row.banknote_selling),
    unit: row.unit,
    crossRateUSD: row.cross_rate_usd ? parseFloat(row.cross_rate_usd) : null,
    crossRateOther: row.cross_rate_other ? parseFloat(row.cross_rate_other) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function getRatesByDate(date: Date): Promise<ExchangeRate[]> {
  const pool = getPool();

  const query = `
    SELECT
      id, currency_code, rate_date,
      forex_buying, forex_selling,
      banknote_buying, banknote_selling,
      unit, cross_rate_usd, cross_rate_other,
      created_at, updated_at
    FROM exchange_rates
    WHERE rate_date = $1
    ORDER BY currency_code
  `;

  const result = await pool.query(query, [date]);

  return result.rows.map(row => ({
    id: row.id,
    currencyCode: row.currency_code,
    rateDate: row.rate_date,
    forexBuying: parseFloat(row.forex_buying),
    forexSelling: parseFloat(row.forex_selling),
    banknoteBuying: parseFloat(row.banknote_buying),
    banknoteSelling: parseFloat(row.banknote_selling),
    unit: row.unit,
    crossRateUSD: row.cross_rate_usd ? parseFloat(row.cross_rate_usd) : null,
    crossRateOther: row.cross_rate_other ? parseFloat(row.cross_rate_other) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function getLastSuccessfulFetch(): Promise<FetchLog | null> {
  const pool = getPool();

  const query = `
    SELECT * FROM fetch_logs
    WHERE status = 'SUCCESS'
    ORDER BY fetch_date DESC, created_at DESC
    LIMIT 1
  `;

  const result = await pool.query(query);

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    fetchDate: row.fetch_date,
    scheduledTime: row.scheduled_time,
    executionStart: row.execution_start,
    executionEnd: row.execution_end,
    status: row.status as FetchLogStatus,
    recordsInserted: row.records_inserted,
    recordsUpdated: row.records_updated,
    recordsFailed: row.records_failed,
    executionTimeMs: row.execution_time_ms,
    errorMessage: row.error_message,
    errorStack: row.error_stack,
    tcmbResponseTimeMs: row.tcmb_response_time_ms,
    createdAt: row.created_at
  };
}
