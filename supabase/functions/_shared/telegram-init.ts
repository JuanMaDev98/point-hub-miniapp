/**
 * Valida la cadena initData que envía Telegram WebApp (Mini App).
 * Solo Telegram puede firmarla con el token de tu bot → si el hash cuadra, el body es auténtico.
 * @see https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
 */

export type TelegramUserPayload = {
  id: number;
  username?: string;
  first_name: string;
  last_name?: string;
};

/** initData viejo podría reutilizarse; Telegram recomienda comprobar auth_date. */
const MAX_INIT_AGE_SEC = 24 * 60 * 60;

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

/**
 * Devuelve el objeto de usuario de Telegram tras validar firma y antigüedad.
 */
export async function verifyTelegramWebAppInitData(
  initData: string,
  botToken: string,
): Promise<TelegramUserPayload> {
  if (!initData?.trim() || !botToken) {
    throw new Error("Faltan initData o token del bot");
  }

  const params = new URLSearchParams(initData);
  const userStr = params.get("user");
  const hash = params.get("hash");
  const authDateRaw = params.get("auth_date");

  if (!userStr || !hash) throw new Error("initData incompleto");

  const authDate = authDateRaw ? parseInt(authDateRaw, 10) : NaN;
  if (!Number.isFinite(authDate)) throw new Error("auth_date inválido");

  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - authDate > MAX_INIT_AGE_SEC) {
    throw new Error("Sesión caducada; vuelve a abrir la app desde Telegram");
  }

  const dataCheckString = Array.from(params.entries())
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const secretRaw = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(botToken),
  );

  const secretKey = await crypto.subtle.importKey(
    "raw",
    secretRaw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    secretKey,
    new TextEncoder().encode(dataCheckString),
  );

  const calculatedHex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Telegram manda el hash en hex (suele ser minúsculas; normalizamos por si acaso).
  if (
    !timingSafeEqualHex(calculatedHex.toLowerCase(), hash.toLowerCase())
  ) {
    throw new Error("Firma de Telegram no válida");
  }

  let user: TelegramUserPayload;
  try {
    user = JSON.parse(userStr) as TelegramUserPayload;
  } catch {
    throw new Error("Campo user inválido");
  }
  if (!user?.id || typeof user.id !== "number") {
    throw new Error("Usuario inválido en initData");
  }

  return user;
}
