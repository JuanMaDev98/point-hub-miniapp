-- Habilitar extensión UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tabla de usuarios
CREATE TABLE IF NOT EXISTS users (
    id BIGINT PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    clicks INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Índices para rendimiento
CREATE INDEX IF NOT EXISTS idx_users_clicks ON users(clicks DESC);
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);

-- Función para actualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = TIMEZONE('utc', NOW());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para actualizar updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Política: Los usuarios pueden leer todos los datos (para leaderboard)
DROP POLICY IF EXISTS "Users can view all users" ON users;
CREATE POLICY "Users can view all users" ON users
    FOR SELECT
    USING (true);

-- Política: Los usuarios solo pueden actualizar sus propios clicks
DROP POLICY IF EXISTS "Users can update own clicks" ON users;
CREATE POLICY "Users can update own clicks" ON users
    FOR UPDATE
    USING (true); -- Validado en Edge Function

-- Política: Insertar nuevos usuarios
DROP POLICY IF EXISTS "Users can insert" ON users;
CREATE POLICY "Users can insert" ON users
    FOR INSERT
    WITH CHECK (true);

-- Tabla para rate limiting de clicks (ventana de 60 segundos)
CREATE TABLE IF NOT EXISTS click_rate_log (
    telegram_id BIGINT NOT NULL,
    click_time TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_click_rate_log_telegram ON click_rate_log(telegram_id, click_time);

-- Función para verificar y registrar rate limit
-- Permite 400 clicks por minuto (suficiente para usuarios reales, bloquea bots agresivos)
CREATE OR REPLACE FUNCTION check_click_rate_limit(
    user_telegram_id BIGINT,
    max_clicks INTEGER DEFAULT 400,
    window_seconds INTEGER DEFAULT 60
) RETURNS BOOLEAN AS $$
DECLARE
    recent_count INTEGER;
    cutoff TIMESTAMP WITH TIME ZONE;
BEGIN
    cutoff = TIMEZONE('utc', NOW()) - (window_seconds || ' seconds')::INTERVAL;
    
    DELETE FROM click_rate_log
    WHERE telegram_id = user_telegram_id AND click_time < cutoff;
    
    SELECT COUNT(*) INTO recent_count
    FROM click_rate_log
    WHERE telegram_id = user_telegram_id AND click_time >= cutoff;
    
    IF recent_count >= max_clicks THEN
        RETURN FALSE;
    END IF;
    
    INSERT INTO click_rate_log (telegram_id) VALUES (user_telegram_id);
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Política RLS para click_rate_log
ALTER TABLE click_rate_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own rate log" ON click_rate_log;
CREATE POLICY "Users can insert own rate log" ON click_rate_log
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Users can read own rate log" ON click_rate_log;
CREATE POLICY "Users can read own rate log" ON click_rate_log
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can delete own rate log" ON click_rate_log;
CREATE POLICY "Users can delete own rate log" ON click_rate_log
    FOR DELETE USING (true);

-- +1 (legacy / otros usos)
CREATE OR REPLACE FUNCTION increment_clicks(user_telegram_id BIGINT)
RETURNS INTEGER AS $$
DECLARE
    new_clicks INTEGER;
BEGIN
    UPDATE users
    SET clicks = clicks + 1
    WHERE telegram_id = user_telegram_id
    RETURNING clicks INTO new_clicks;

    RETURN new_clicks;
END;
$$ LANGUAGE plpgsql;

-- Varios clicks en un solo UPDATE (la Mini App agrupa ráfagas en el cliente).
-- El servidor limita cuántos suma por llamada para evitar abusos.
CREATE OR REPLACE FUNCTION increment_clicks_by(user_telegram_id BIGINT, delta INTEGER)
RETURNS INTEGER AS $$
DECLARE
    d INTEGER;
    new_clicks INTEGER;
BEGIN
    d := LEAST(GREATEST(delta, 1), 500);
    UPDATE users
    SET clicks = clicks + d
    WHERE telegram_id = user_telegram_id
    RETURNING clicks INTO new_clicks;

    RETURN new_clicks;
END;
$$ LANGUAGE plpgsql;
