/**
 * Config pública del frontend (sí va en git y en Cloudflare).
 *
 * SUPABASE_ANON_KEY es la clave anon o publishable del panel (Settings → API).
 * Esa clave está pensada para vivir en el navegador; la seguridad real es RLS +
 * validación en Edge Functions (nunca pongas aquí service_role).
 */
export const SUPABASE_URL = "https://fxtgotsnnsuqbynkbvik.supabase.co";
export const SUPABASE_ANON_KEY =
  "sb_publishable_rAWHFK8uUjUCWOdOibHEIw_nT0pEPWw";
