export interface TCMBCurrency {
  code: string;
  unit: number;
  name: string;
  nameTR: string;
  forexBuying: number | null;
  forexSelling: number | null;
  banknoteBuying: number | null;
  banknoteSelling: number | null;
  crossRateUSD: number | null;
  crossRateOther: number | null;
}

export interface TCMBResponse {
  date: string;
  bulletinNo: string;
  currencies: TCMBCurrency[];
}

export interface ExchangeRate {
  id?: number;
  currencyCode: string;
  rateDate: Date;
  forexBuying: number | null;
  forexSelling: number | null;
  banknoteBuying: number | null;
  banknoteSelling: number | null;
  unit: number;
  crossRateUSD: number | null;
  crossRateOther: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CurrencyType {
  id?: number;
  currencyCode: string;
  currencyName: string;
  currencyNameTR: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type FetchLogStatus = 'SUCCESS' | 'ERROR' | 'PARTIAL' | 'RUNNING';

export interface FetchLog {
  id?: number;
  fetchDate: Date;
  scheduledTime: Date;
  executionStart: Date;
  executionEnd?: Date;
  status: FetchLogStatus;
  recordsInserted: number;
  recordsUpdated: number;
  recordsFailed: number;
  executionTimeMs?: number;
  errorMessage?: string;
  errorStack?: string;
  tcmbResponseTimeMs?: number;
  createdAt?: Date;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max?: number;
}

export interface AppConfig {
  database: DatabaseConfig;
  tcmb: {
    todayUrl: string;
    requestTimeout: number;
    maxRetryAttempts: number;
    retryDelayMs: number;
  };
  scheduler: {
    cronSchedule: string;
    timezone: string;
    enabled: boolean;
  };
  logging: {
    level: string;
    dir: string;
  };
  nodeEnv: string;
}
