# TCMB Döviz Kuru Toplama Sistemi - Proje Planı

## 📋 Genel Bakış

Türkiye Cumhuriyet Merkez Bankası (TCMB) web servislerinden günlük döviz kurlarını otomatik olarak çeken ve PostgreSQL veritabanına kaydeden sistem.

## 🎯 Proje Hedefleri

- Günlük döviz kurlarını TCMB'den otomatik çekmek
- Verileri PostgreSQL veritabanında saklamak
- Güvenilir ve hatasız çalışan bir scheduler sistemi
- Loglanmış ve izlenebilir süreç
- Geçmiş verileri analiz edebilecek yapı

## 🛠️ Teknoloji Stack

```
Backend Framework: Node.js + TypeScript
Scheduler: Bree.js (veya node-cron)
Database: PostgreSQL
HTTP Client: axios
Database Client: pg (native PostgreSQL client)
Logging: winston
Environment Config: dotenv
XML Parser: xml2js
Process Manager: PM2 (production için)
```

## 📁 Proje Yapısı

```
tcmb-exchange-rates/
├── src/
│   ├── config/
│   │   ├── database.ts          # PostgreSQL bağlantı ayarları
│   │   ├── scheduler.ts         # Bree/cron konfigürasyonu
│   │   └── index.ts             # Tüm config export
│   ├── services/
│   │   ├── tcmbService.ts       # TCMB API entegrasyonu
│   │   ├── databaseService.ts   # Database işlemleri
│   │   └── xmlParser.ts         # XML parsing utilities
│   ├── jobs/
│   │   ├── fetchRatesJob.ts     # Ana scheduled job
│   │   └── historicalDataJob.ts # Geçmiş veri çekme (opsiyonel)
│   ├── models/
│   │   ├── types.ts             # TypeScript interfaces & types
│   │   └── schemas.ts           # Validation schemas (Zod)
│   ├── utils/
│   │   ├── logger.ts            # Winston logger setup
│   │   ├── errorHandler.ts      # Error handling utilities
│   │   └── retry.ts             # Retry mechanism
│   ├── migrations/
│   │   └── init.sql             # Database initialization
│   └── app.ts                   # Ana uygulama entry point
├── logs/                        # Log dosyaları
├── .env.example                 # Environment variables template
├── .env                         # Actual environment variables
├── .gitignore
├── package.json
├── tsconfig.json
├── ecosystem.config.js          # PM2 config
└── README.md
```

## 🗄️ Veritabanı Tasarımı

### Tablo Yapıları

#### 1. currency_types (Döviz Türleri)
```sql
CREATE TABLE currency_types (
    id SERIAL PRIMARY KEY,
    currency_code VARCHAR(3) UNIQUE NOT NULL,  -- USD, EUR, GBP, etc.
    currency_name VARCHAR(100) NOT NULL,        -- United States Dollar, Euro, etc.
    currency_name_tr VARCHAR(100),              -- Türkçe isim
    symbol VARCHAR(5),                          -- $, €, £
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Örnek veriler
INSERT INTO currency_types (currency_code, currency_name, currency_name_tr, symbol) VALUES
('USD', 'United States Dollar', 'Amerikan Doları', '$'),
('EUR', 'Euro', 'Euro', '€'),
('GBP', 'British Pound', 'İngiliz Sterlini', '£'),
('CHF', 'Swiss Franc', 'İsviçre Frangı', 'Fr');
```

#### 2. exchange_rates (Döviz Kurları)
```sql
CREATE TABLE exchange_rates (
    id SERIAL PRIMARY KEY,
    currency_code VARCHAR(3) NOT NULL,
    rate_date DATE NOT NULL,
    
    -- TCMB kurları
    forex_buying NUMERIC(10,4),      -- Döviz Alış
    forex_selling NUMERIC(10,4),     -- Döviz Satış
    banknote_buying NUMERIC(10,4),   -- Efektif Alış
    banknote_selling NUMERIC(10,4),  -- Efektif Satış
    
    -- Metadata
    unit INTEGER DEFAULT 1,           -- Birim (bazı para birimleri için 100 olabilir)
    cross_rate_usd NUMERIC(10,6),    -- USD çapraz kuru
    cross_rate_other NUMERIC(10,6),  -- Diğer çapraz kur
    
    -- Audit fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT exchange_rates_currency_date_unique UNIQUE(currency_code, rate_date),
    CONSTRAINT fk_currency FOREIGN KEY (currency_code) 
        REFERENCES currency_types(currency_code) 
        ON DELETE CASCADE ON UPDATE CASCADE,
    
    -- Validations
    CONSTRAINT check_positive_rates CHECK (
        forex_buying > 0 AND 
        forex_selling > 0 AND 
        banknote_buying > 0 AND 
        banknote_selling > 0
    )
);
```

#### 3. fetch_logs (İşlem Logları)
```sql
CREATE TABLE fetch_logs (
    id SERIAL PRIMARY KEY,
    fetch_date DATE NOT NULL,
    scheduled_time TIMESTAMP NOT NULL,
    execution_start TIMESTAMP NOT NULL,
    execution_end TIMESTAMP,
    
    -- Status
    status VARCHAR(20) NOT NULL,  -- SUCCESS, ERROR, PARTIAL, RUNNING
    
    -- Metrics
    records_inserted INTEGER DEFAULT 0,
    records_updated INTEGER DEFAULT 0,
    records_failed INTEGER DEFAULT 0,
    execution_time_ms INTEGER,
    
    -- Details
    error_message TEXT,
    error_stack TEXT,
    tcmb_response_time_ms INTEGER,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT check_status CHECK (status IN ('SUCCESS', 'ERROR', 'PARTIAL', 'RUNNING'))
);
```

### İndeksler (Performance)
```sql
-- Exchange rates için indeksler
CREATE INDEX idx_exchange_rates_date ON exchange_rates(rate_date DESC);
CREATE INDEX idx_exchange_rates_currency ON exchange_rates(currency_code);
CREATE INDEX idx_exchange_rates_currency_date ON exchange_rates(currency_code, rate_date DESC);
CREATE INDEX idx_exchange_rates_created ON exchange_rates(created_at DESC);

-- Fetch logs için indeksler
CREATE INDEX idx_fetch_logs_date ON fetch_logs(fetch_date DESC);
CREATE INDEX idx_fetch_logs_status ON fetch_logs(status);
```

### Views (Kolay Sorgulama)
```sql
-- En son kurlar
CREATE VIEW latest_rates AS
SELECT 
    er.currency_code,
    ct.currency_name,
    ct.symbol,
    er.rate_date,
    er.forex_buying,
    er.forex_selling,
    er.banknote_buying,
    er.banknote_selling,
    (er.forex_selling - er.forex_buying) as spread
FROM exchange_rates er
INNER JOIN currency_types ct ON er.currency_code = ct.currency_code
WHERE er.rate_date = (SELECT MAX(rate_date) FROM exchange_rates)
ORDER BY er.currency_code;

-- Günlük değişimler
CREATE VIEW daily_changes AS
SELECT 
    today.currency_code,
    today.rate_date as today_date,
    today.forex_buying as today_buying,
    yesterday.forex_buying as yesterday_buying,
    ROUND(((today.forex_buying - yesterday.forex_buying) / yesterday.forex_buying * 100)::numeric, 2) as change_percentage,
    (today.forex_buying - yesterday.forex_buying) as change_amount
FROM exchange_rates today
LEFT JOIN exchange_rates yesterday ON 
    today.currency_code = yesterday.currency_code AND
    yesterday.rate_date = today.rate_date - INTERVAL '1 day'
WHERE today.rate_date = CURRENT_DATE;
```

## 🔌 TCMB API Entegrasyonu

### API Endpoint'leri

```typescript
// Güncel kurlar
const TCMB_TODAY_URL = 'https://www.tcmb.gov.tr/kurlar/today.xml';

// Tarihli kurlar (geçmiş veri)
const TCMB_DATE_URL = 'https://www.tcmb.gov.tr/kurlar/{YYYYMM}/{DDMMYYYY}.xml';
// Örnek: https://www.tcmb.gov.tr/kurlar/202401/15012024.xml
```

### XML Yapısı
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Tarih_Date Tarih="15.01.2024" Date="01/15/2024" Bulten_No="2024/11">
    <Currency CrossOrder="0" Kod="USD" CurrencyCode="USD">
        <Unit>1</Unit>
        <Isim>ABD DOLARI</Isim>
        <CurrencyName>US DOLLAR</CurrencyName>
        <ForexBuying>29.3250</ForexBuying>
        <ForexSelling>29.3850</ForexSelling>
        <BanknoteBuying>29.3100</BanknoteBuying>
        <BanknoteSelling>29.4100</BanknoteSelling>
        <CrossRateUSD/>
        <CrossRateOther/>
    </Currency>
    <!-- Diğer para birimleri... -->
</Tarih_Date>
```

## 📝 TypeScript Type Definitions

```typescript
// src/models/types.ts

export interface TCMBCurrency {
    code: string;
    unit: number;
    name: string;
    nameTR: string;
    forexBuying: number;
    forexSelling: number;
    banknoteBuying: number;
    banknoteSelling: number;
    crossRateUSD?: number;
    crossRateOther?: number;
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
    forexBuying: number;
    forexSelling: number;
    banknoteBuying: number;
    banknoteSelling: number;
    unit: number;
    crossRateUSD?: number;
    crossRateOther?: number;
}

export interface FetchLog {
    id?: number;
    fetchDate: Date;
    scheduledTime: Date;
    executionStart: Date;
    executionEnd?: Date;
    status: 'SUCCESS' | 'ERROR' | 'PARTIAL' | 'RUNNING';
    recordsInserted: number;
    recordsUpdated: number;
    recordsFailed: number;
    executionTimeMs?: number;
    errorMessage?: string;
    errorStack?: string;
    tcmbResponseTimeMs?: number;
}

export interface JobConfig {
    name: string;
    cronExpression: string;
    timezone: string;
    enabled: boolean;
}
```

## ⚙️ Configuration Files

### .env.example
```env
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=tcmb_exchange_rates
DB_USER=postgres
DB_PASSWORD=your_password
DB_MAX_CONNECTIONS=10

# Scheduler Configuration
CRON_SCHEDULE=30 15 * * *
TIMEZONE=Europe/Istanbul
ENABLE_SCHEDULER=true

# TCMB API Configuration
TCMB_TODAY_URL=https://www.tcmb.gov.tr/kurlar/today.xml
TCMB_REQUEST_TIMEOUT=10000
MAX_RETRY_ATTEMPTS=3
RETRY_DELAY_MS=2000

# Logging
LOG_LEVEL=info
LOG_DIR=./logs
LOG_MAX_FILES=30d

# Application
NODE_ENV=development
PORT=3000
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### package.json (bağımlılıklar)
```json
{
  "name": "tcmb-exchange-rates",
  "version": "1.0.0",
  "description": "TCMB döviz kurları otomatik toplama sistemi",
  "main": "dist/app.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/app.js",
    "dev": "ts-node src/app.ts",
    "dev:watch": "nodemon --exec ts-node src/app.ts",
    "migrate": "node dist/migrations/run.js",
    "test": "jest",
    "lint": "eslint src/**/*.ts",
    "format": "prettier --write src/**/*.ts"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "bree": "^9.2.0",
    "dotenv": "^16.3.1",
    "pg": "^8.11.0",
    "winston": "^3.11.0",
    "xml2js": "^0.6.2",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@types/pg": "^8.10.0",
    "@types/xml2js": "^0.4.14",
    "nodemon": "^3.0.0",
    "ts-node": "^10.9.0",
    "typescript": "^5.3.0"
  }
}
```

## 🔄 İş Akışı (Workflow)

### Ana İşlem Akışı

```
1. BAŞLAT
   ↓
2. Scheduler Tetiklenir (Günlük 15:30)
   ↓
3. Log Kaydı Oluştur (Status: RUNNING)
   ↓
4. TCMB XML Servisi Çağır
   ↓
5. Response Kontrolü
   ├─ Başarılı → Devam Et
   └─ Hata → Retry (max 3 deneme)
      └─ Hala Hata → Log Güncelle (Status: ERROR) → BİTİR
   ↓
6. XML Parse Et
   ↓
7. Her Bir Döviz İçin:
   ├─ Validasyon Yap
   ├─ UPSERT İşlemi (currency_code + rate_date)
   └─ Başarı/Hata Sayacını Güncelle
   ↓
8. Log Güncelle
   ├─ Tüm kayıtlar başarılı → Status: SUCCESS
   ├─ Bazı kayıtlar başarısız → Status: PARTIAL
   └─ Hiç kayıt yok → Status: ERROR
   ↓
9. BİTİR
```

### Retry Stratejisi

```typescript
// Exponential backoff with jitter
Attempt 1: 0ms gecikme
Attempt 2: 2000ms + random(0-500ms)
Attempt 3: 4000ms + random(0-1000ms)

Toplam max retry: 3
Timeout per request: 10 saniye
```

### Hata Yönetimi

```typescript
// Hata Tipleri
1. Network Error → Retry yapılır
2. Parse Error → Log'a kaydedilir, retry yapılmaz
3. Database Error → Log'a kaydedilir, retry yapılmaz
4. Validation Error → Sadece o kayıt atlanır, diğerleri devam eder
```

## 📅 Zamanlama Stratejisi

### Cron Expression
```
30 15 * * *
│  │  │ │ │
│  │  │ │ └─── Haftanın günü (0-7, 0 ve 7 Pazar)
│  │  │ └───── Ay (1-12)
│  │  └─────── Ayın günü (1-31)
│  └────────── Saat (0-23)
└───────────── Dakika (0-59)

Açıklama: Her gün saat 15:30'da çalışır
```

### Alternatif Zamanlamalar
```javascript
// Günde birden fazla çalışma (09:00, 12:00, 15:30)
'0 9,12,15:30 * * *'

// Sadece hafta içi
'30 15 * * 1-5'

// Her saat başı (test için)
'0 * * * *'
```

### Tatil ve Hafta Sonu Kontrolü

```typescript
// TCMB hafta sonu ve resmi tatillerde veri yayınlamaz
// İsteğe bağlı: İş günü kontrolü eklenebilir

function isBusinessDay(date: Date): boolean {
    const day = date.getDay();
    // 0 = Pazar, 6 = Cumartesi
    return day !== 0 && day !== 6;
}

// Resmi tatiller için bir liste tutulabilir
const holidays2024 = [
    '2024-01-01', // Yılbaşı
    '2024-04-23', // 23 Nisan
    // ... diğer tatiller
];
```

## 🎯 Temel Fonksiyonlar (Özet)

### tcmbService.ts
```typescript
- fetchTodayRates(): Promise<TCMBResponse>
- fetchRatesByDate(date: Date): Promise<TCMBResponse>
- parseXMLResponse(xmlString: string): Promise<TCMBResponse>
- validateCurrencyData(currency: TCMBCurrency): boolean
```

### databaseService.ts
```typescript
- connect(): Promise<void>
- disconnect(): Promise<void>
- upsertExchangeRate(rate: ExchangeRate): Promise<void>
- upsertExchangeRates(rates: ExchangeRate[]): Promise<void>
- getLatestRates(): Promise<ExchangeRate[]>
- getRatesByDate(date: Date): Promise<ExchangeRate[]>
- createFetchLog(log: FetchLog): Promise<number>
- updateFetchLog(id: number, updates: Partial<FetchLog>): Promise<void>
```

### fetchRatesJob.ts
```typescript
- execute(): Promise<void>
- handleSuccess(rates: ExchangeRate[], logId: number): Promise<void>
- handleError(error: Error, logId: number): Promise<void>
```

### logger.ts
```typescript
- info(message: string, meta?: any): void
- error(message: string, meta?: any): void
- warn(message: string, meta?: any): void
- debug(message: string, meta?: any): void
```

## 📊 Monitoring ve Raporlama

### Günlük Health Check Sorguları

```sql
-- Bugün çekim yapıldı mı?
SELECT * FROM fetch_logs 
WHERE fetch_date = CURRENT_DATE 
ORDER BY created_at DESC LIMIT 1;

-- Son 7 günün başarı oranı
SELECT 
    fetch_date,
    status,
    records_inserted,
    execution_time_ms
FROM fetch_logs
WHERE fetch_date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY fetch_date DESC;

-- Eksik günler var mı?
SELECT date_series::date as missing_date
FROM generate_series(
    CURRENT_DATE - INTERVAL '30 days',
    CURRENT_DATE,
    INTERVAL '1 day'
) AS date_series
WHERE date_series::date NOT IN (
    SELECT DISTINCT rate_date 
    FROM exchange_rates
)
AND EXTRACT(DOW FROM date_series) NOT IN (0, 6); -- Hafta sonu hariç
```

### Log Analizi
```sql
-- Ortalama çalışma süresi
SELECT 
    AVG(execution_time_ms) as avg_ms,
    MIN(execution_time_ms) as min_ms,
    MAX(execution_time_ms) as max_ms
FROM fetch_logs
WHERE status = 'SUCCESS'
AND fetch_date >= CURRENT_DATE - INTERVAL '30 days';

-- Hata oranı
SELECT 
    status,
    COUNT(*) as count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM fetch_logs
WHERE fetch_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY status;
```

## 🚀 Deployment

### PM2 Ecosystem Config (ecosystem.config.js)
```javascript
module.exports = {
  apps: [{
    name: 'tcmb-rates',
    script: './dist/app.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true
  }]
};
```

### Production Checklist
```
□ PostgreSQL veritabanı oluşturuldu
□ .env dosyası production değerleriyle dolduruldu
□ npm run build çalıştırıldı
□ Migration script'leri çalıştırıldı
□ PM2 kuruldu (npm install -g pm2)
□ pm2 start ecosystem.config.js
□ pm2 save (restart sonrası otomatik başlatma)
□ pm2 startup (sistem başlangıcında otomatik başlatma)
□ Log rotation ayarlandı
□ Backup stratejisi belirlendi
```

## 🔍 Testing Strategy

### Unit Tests
```typescript
// tcmbService.test.ts
- XML parsing doğruluğu
- Validation fonksiyonları
- Error handling

// databaseService.test.ts
- UPSERT işlemleri
- Connection pool yönetimi
- Transaction rollback
```

### Integration Tests
```typescript
// fetchRatesJob.test.ts
- End-to-end akış
- Database yazma
- Log kayıtları
```

## 📈 İyileştirme Önerileri (Phase 2)

### API Geliştirme
```typescript
// REST API endpoints
GET /api/rates/latest
GET /api/rates/date/:date
GET /api/rates/currency/:code
GET /api/rates/range?start=DATE&end=DATE
GET /api/health
```

### Dashboard
```typescript
// Frontend (React/Next.js)
- Günlük kur grafikleri
- Trend analizi
- Alert sistemi
- Historical data visualization
```

### Bildirim Sistemi
```typescript
// Email/Slack bildirimler
- Günlük özet
- Hata bildirimleri
- Kritik kur değişimleri
```

### Cache Mekanizması
```typescript
// Redis kullanarak
- API response cache
- Frequently accessed data
- Rate limiting
```

## 📚 Kaynaklar

- TCMB Resmi Sitesi: https://www.tcmb.gov.tr
- TCMB Kur Servisleri: https://www.tcmb.gov.tr/kurlar/
- PostgreSQL Docs: https://www.postgresql.org/docs/
- Bree.js Docs: https://github.com/breejs/bree

## 🎓 Geliştirme Adımları

1. **Proje Kurulumu**: `npm init` ve dependencies kurulumu
2. **Database Setup**: PostgreSQL kurulumu ve migration'lar
3. **Core Services**: TCMB service ve database service geliştirme
4. **Job Implementation**: Scheduled job kodlama
5. **Testing**: Unit ve integration testler
6. **Logging**: Winston entegrasyonu
7. **Error Handling**: Comprehensive error handling
8. **Deployment**: Production ortamına deploy
9. **Monitoring**: Health check ve alerting setup
10. **Documentation**: README ve API docs

---

## ✅ Başarı Kriterleri

- ✓ Her gün otomatik olarak kurlar çekiliyor
- ✓ %99.9 uptime sağlanıyor
- ✓ Hatalar loglanıyor ve bildiriliyor
- ✓ Database performansı optimize
- ✓ Kolay bakım ve genişletilebilir yapı

---

**Hazırlayan:** Claude  
**Tarih:** 2024  
**Versiyon:** 1.0
