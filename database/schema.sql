-- Habilitar extensión UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tabla de usuarios
CREATE TABLE users (
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
CREATE INDEX idx_users_clicks ON users(clicks DESC);
CREATE INDEX idx_users_telegram_id ON users(telegram_id);

-- Función para actualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = TIMEZONE('utc', NOW());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para actualizar updated_at
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Política: Los usuarios pueden leer todos los datos (para leaderboard)
CREATE POLICY "Users can view all users" ON users
    FOR SELECT
    USING (true);

-- Política: Los usuarios solo pueden actualizar sus propios clicks
CREATE POLICY "Users can update own clicks" ON users
    FOR UPDATE
    USING (true); -- Validado en Edge Function

-- Política: Insertar nuevos usuarios
CREATE POLICY "Users can insert" ON users
    FOR INSERT
    WITH CHECK (true);

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