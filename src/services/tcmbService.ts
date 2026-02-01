import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import { TCMBResponse, TCMBCurrency, ExchangeRate, CurrencyType } from '../models/types';
import { getConfig } from '../config';
import { withRetry } from '../utils/retry';
import logger from '../utils/logger';

interface TCMBXMLCurrency {
  $: {
    Kod: string;
    CurrencyCode: string;
    CrossOrder: string;
  };
  Unit: string[];
  Isim: string[];
  CurrencyName: string[];
  ForexBuying: string[];
  ForexSelling: string[];
  BanknoteBuying: string[];
  BanknoteSelling: string[];
  CrossRateUSD: string[];
  CrossRateOther: string[];
}

interface TCMBXMLResponse {
  Tarih_Date: {
    $: {
      Tarih: string;
      Date: string;
      Bulten_No: string;
    };
    Currency: TCMBXMLCurrency[];
  };
}

function parseNumber(value: string | undefined): number | null {
  if (!value || value.trim() === '') return null;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

function parseTCMBDate(dateStr: string): Date {
  // Format: DD.MM.YYYY
  const [day, month, year] = dateStr.split('.');
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
}

export async function fetchTodayRates(): Promise<{ response: TCMBResponse; responseTimeMs: number }> {
  const config = getConfig();

  const startTime = Date.now();

  const fetchData = async () => {
    const response = await axios.get<string>(config.tcmb.todayUrl, {
      timeout: config.tcmb.requestTimeout,
      headers: {
        'Accept': 'application/xml',
        'User-Agent': 'TCMB-Exchange-Rates-Fetcher/1.0'
      },
      responseType: 'text'
    });
    return response.data;
  };

  const xmlData = await withRetry(fetchData, {
    maxAttempts: config.tcmb.maxRetryAttempts,
    delayMs: config.tcmb.retryDelayMs
  });

  const responseTimeMs = Date.now() - startTime;

  const parsedResponse = await parseXMLResponse(xmlData);

  return { response: parsedResponse, responseTimeMs };
}

export async function fetchRatesByDate(date: Date): Promise<{ response: TCMBResponse; responseTimeMs: number }> {
  const config = getConfig();

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  const url = `https://www.tcmb.gov.tr/kurlar/${year}${month}/${day}${month}${year}.xml`;

  const startTime = Date.now();

  const fetchData = async () => {
    const response = await axios.get<string>(url, {
      timeout: config.tcmb.requestTimeout,
      headers: {
        'Accept': 'application/xml',
        'User-Agent': 'TCMB-Exchange-Rates-Fetcher/1.0'
      },
      responseType: 'text'
    });
    return response.data;
  };

  const xmlData = await withRetry(fetchData, {
    maxAttempts: config.tcmb.maxRetryAttempts,
    delayMs: config.tcmb.retryDelayMs
  });

  const responseTimeMs = Date.now() - startTime;

  const parsedResponse = await parseXMLResponse(xmlData);

  return { response: parsedResponse, responseTimeMs };
}

export async function parseXMLResponse(xmlString: string): Promise<TCMBResponse> {
  const result = await parseStringPromise(xmlString) as TCMBXMLResponse;

  const root = result.Tarih_Date;
  const dateStr = root.$.Tarih;
  const bulletinNo = root.$.Bulten_No;

  const currencies: TCMBCurrency[] = root.Currency.map(curr => ({
    code: curr.$.CurrencyCode || curr.$.Kod,
    unit: parseInt(curr.Unit?.[0] || '1', 10),
    name: curr.CurrencyName?.[0] || '',
    nameTR: curr.Isim?.[0] || '',
    forexBuying: parseNumber(curr.ForexBuying?.[0]),
    forexSelling: parseNumber(curr.ForexSelling?.[0]),
    banknoteBuying: parseNumber(curr.BanknoteBuying?.[0]),
    banknoteSelling: parseNumber(curr.BanknoteSelling?.[0]),
    crossRateUSD: parseNumber(curr.CrossRateUSD?.[0]),
    crossRateOther: parseNumber(curr.CrossRateOther?.[0])
  }));

  logger.info(`Parsed ${currencies.length} currencies for date ${dateStr}`);

  return {
    date: dateStr,
    bulletinNo,
    currencies
  };
}

export function transformToExchangeRates(tcmbResponse: TCMBResponse): ExchangeRate[] {
  const rateDate = parseTCMBDate(tcmbResponse.date);

  return tcmbResponse.currencies.map(curr => ({
    currencyCode: curr.code,
    rateDate,
    forexBuying: curr.forexBuying,
    forexSelling: curr.forexSelling,
    banknoteBuying: curr.banknoteBuying,
    banknoteSelling: curr.banknoteSelling,
    unit: curr.unit,
    crossRateUSD: curr.crossRateUSD,
    crossRateOther: curr.crossRateOther
  }));
}

export function transformToCurrencyTypes(tcmbResponse: TCMBResponse): CurrencyType[] {
  return tcmbResponse.currencies.map(curr => ({
    currencyCode: curr.code,
    currencyName: curr.name,
    currencyNameTR: curr.nameTR,
    isActive: true
  }));
}
