import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { TCMBResponse, TCMBCurrency, ExchangeRate, CurrencyType } from '../models/types';
import { getConfig } from '../config';
import { withRetry } from '../utils/retry';
import logger from '../utils/logger';

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

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_'
});

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

  const parsedResponse = parseXMLResponse(xmlData);

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

  const parsedResponse = parseXMLResponse(xmlData);

  return { response: parsedResponse, responseTimeMs };
}

export function parseXMLResponse(xmlString: string): TCMBResponse {
  const result = xmlParser.parse(xmlString);

  const root = result.Tarih_Date;
  const dateStr = root['@_Tarih'] ?? '';
  const bulletinNo = root['@_Bulten_No'] ?? '';

  const currencyList = root.Currency;
  const currencyArray = Array.isArray(currencyList) ? currencyList : currencyList ? [currencyList] : [];

  const getText = (val: unknown): string => {
    if (val === undefined || val === null) return '';
    if (typeof val === 'string') return val;
    if (typeof val === 'object' && val !== null && '#text' in val) return String((val as { '#text': string })['#text']);
    return String(val);
  };

  const currencies: TCMBCurrency[] = currencyArray.map((curr: Record<string, unknown>) => ({
    code: (curr['@_CurrencyCode'] ?? curr['@_Kod'] ?? '') as string,
    unit: parseInt(getText(curr.Unit) || '1', 10),
    name: getText(curr.CurrencyName),
    nameTR: getText(curr.Isim),
    forexBuying: parseNumber(getText(curr.ForexBuying)),
    forexSelling: parseNumber(getText(curr.ForexSelling)),
    banknoteBuying: parseNumber(getText(curr.BanknoteBuying)),
    banknoteSelling: parseNumber(getText(curr.BanknoteSelling)),
    crossRateUSD: parseNumber(getText(curr.CrossRateUSD)),
    crossRateOther: parseNumber(getText(curr.CrossRateOther))
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
