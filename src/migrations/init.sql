-- TCMB Exchange Rates Database Schema

-- Para birimi türleri tablosu
CREATE TABLE IF NOT EXISTS currency_types (
    id SERIAL PRIMARY KEY,
    currency_code VARCHAR(3) UNIQUE NOT NULL,
    currency_name VARCHAR(100) NOT NULL,
    currency_name_tr VARCHAR(100),
    is_active BOOLEAN DEFAULT true, 
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Döviz kurları tablosu
CREATE TABLE IF NOT EXISTS exchange_rates (
    id SERIAL PRIMARY KEY,
    currency_code VARCHAR(3) NOT NULL,
    rate_date DATE NOT NULL,

    -- TCMB kurları
    forex_buying NUMERIC(15,6),
    forex_selling NUMERIC(15,6),
    banknote_buying NUMERIC(15,6),
    banknote_selling NUMERIC(15,6),

    -- Metadata
    unit INTEGER DEFAULT 1,
    cross_rate_usd NUMERIC(15,6),
    cross_rate_other NUMERIC(15,6),

    -- Audit fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT exchange_rates_currency_date_unique UNIQUE(currency_code, rate_date),
    CONSTRAINT fk_currency FOREIGN KEY (currency_code)
        REFERENCES currency_types(currency_code)
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- İşlem logları tablosu
CREATE TABLE IF NOT EXISTS fetch_logs (
    id SERIAL PRIMARY KEY,
    fetch_date DATE NOT NULL,
    scheduled_time TIMESTAMP NOT NULL,
    execution_start TIMESTAMP NOT NULL,
    execution_end TIMESTAMP,

    -- Status
    status VARCHAR(20) NOT NULL,

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

-- İndeksler
CREATE INDEX IF NOT EXISTS idx_exchange_rates_date ON exchange_rates(rate_date DESC);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_currency ON exchange_rates(currency_code);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_currency_date ON exchange_rates(currency_code, rate_date DESC);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_created ON exchange_rates(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fetch_logs_date ON fetch_logs(fetch_date DESC);
CREATE INDEX IF NOT EXISTS idx_fetch_logs_status ON fetch_logs(status);

-- En son kurlar view'ı
CREATE OR REPLACE VIEW latest_rates AS
SELECT
    er.currency_code,
    ct.currency_name,
    ct.currency_name_tr,
    er.rate_date,
    er.unit,
    er.forex_buying,
    er.forex_selling,
    er.banknote_buying,
    er.banknote_selling,
    (er.forex_selling - er.forex_buying) as spread
FROM exchange_rates er
INNER JOIN currency_types ct ON er.currency_code = ct.currency_code
WHERE er.rate_date = (SELECT MAX(rate_date) FROM exchange_rates)
ORDER BY er.currency_code;

-- updated_at trigger fonksiyonu
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger'ları oluştur (eğer yoksa)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_currency_types_updated_at') THEN
        CREATE TRIGGER update_currency_types_updated_at
            BEFORE UPDATE ON currency_types
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_exchange_rates_updated_at') THEN
        CREATE TRIGGER update_exchange_rates_updated_at
            BEFORE UPDATE ON exchange_rates
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;
