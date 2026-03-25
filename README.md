# PointHub-Miniapp# 🎮 Telegram Clicker Mini App

Una Mini App de Telegram simple donde los usuarios pueden hacer clicks y competir en un leaderboard.

## 🛠️ Stack Tecnológico

- **Frontend:** HTML, CSS, JavaScript
- **Hosting:** Cloudflare Pages
- **Backend:** Supabase Edge Functions
- **Base de Datos:** Supabase PostgreSQL

## 📋 Prerrequisitos

1. Cuenta de [Supabase](https://supabase.com)
2. Cuenta de [Cloudflare](https://cloudflare.com)
3. Bot de Telegram (de @BotFather)

## 🚀 Configuración

### 1. Supabase

1. Crea un nuevo proyecto en Supabase
2. Ve al SQL Editor y ejecuta `database/schema.sql`
3. Ve a Edge Functions y despliega las funciones en `supabase/functions/`
4. Configura los secrets:
   ```bash
   supabase secrets set TELEGRAM_BOT_TOKEN=your_token
   supabase secrets set SUPABASE_URL=your_url
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_key