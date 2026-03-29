/**
 * Mini App: Telegram WebApp + Supabase Edge Functions.
 *
 * Flujo:
 * 1) Telegram inyecta initData (cadena firmada con el token del bot).
 * 2) validate-telegram comprueba la firma en el servidor y crea/actualiza el usuario.
 * 3) get-clicks / update-clicks vuelven a verificar initData: en el servidor obtenemos
 *    el telegram_id del propio initData verificado, no de un número que mande el cliente
 *    (así nadie puede inflar los clicks de otra cuenta cambiando el userId en DevTools).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/** Se crea en init() tras cargar config.js (import dinámico → mensaje claro si falta el archivo). */
let supabase = null;

const tg = window.Telegram?.WebApp;

/** initData crudo de Telegram; lo mandamos al backend en cada acción que afecta a tu usuario. */
let telegramInitData = "";
let userId = null;
let userData = null;

/** Clicks confirmados por el servidor (último valor de get-clicks / update-clicks). */
let serverClicks = 0;
/** Clicks aún no enviados. */
let queuedClicks = 0;
/** Clicks ya enviados y pendientes de confirmación del servidor. */
let inFlightClicks = 0;
let flushTimer = null;
let flushInFlight = false;

/** Tiempo sin clic antes de enviar el lote al servidor (ms). */
const FLUSH_DELAY_MS = 280;

const loadingEl = document.getElementById("loading");
const mainEl = document.querySelector("main");
const usernameEl = document.getElementById("username");
const clickCountEl = document.getElementById("click-count");
const clickBtn = document.getElementById("click-btn");
const leaderboardBtn = document.getElementById("leaderboard-btn");
const modal = document.getElementById("leaderboard-modal");
const closeModal = document.getElementById("close-modal");
const leaderboardList = document.getElementById("leaderboard-list");

/**
 * Invoca una Edge Function. El cliente oficial serializa bien la clave publishable (sb_publishable…)
 * o la JWT (eyJ…), que es lo que el gateway de Supabase espera hoy.
 */
async function invokeFunction(name, invokeOptions = {}) {
  const { data, error } = await supabase.functions.invoke(name, invokeOptions);

  if (!error) return data;

  let message = error.message ?? "Error al llamar a Supabase";

  try {
    const ctx = error.context;
    if (ctx && typeof ctx.json === "function") {
      const body = await ctx.json();
      if (body && typeof body.error === "string") message = body.error;
      else if (body && typeof body.message === "string") message = body.message;
    }
  } catch {
    /** ignorar */
  }

  throw new Error(message);
}

function showFatal(html) {
  loadingEl.classList.add("active");
  loadingEl.innerHTML = html;
}

function escapeHtml(text) {
  if (text == null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function init() {
  loadingEl.classList.add("active");

  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import("./config.js");
    if (
      typeof SUPABASE_URL !== "string" ||
      !SUPABASE_URL.startsWith("https://") ||
      typeof SUPABASE_ANON_KEY !== "string" ||
      !SUPABASE_ANON_KEY.length
    ) {
      throw new Error(
        "Revisa SUPABASE_URL y SUPABASE_ANON_KEY en config.js (copia desde config.example.js).",
      );
    }
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (err) {
    const hint =
      err instanceof Error ? err.message : "No se pudo cargar config.js";
    showFatal(`<p style="color:red">❌ ${escapeHtml(hint)}</p>
      <p style="font-size:13px;margin-top:12px;line-height:1.4">
        Crea el archivo <code>config.js</code> copiando <code>config.example.js</code>
        y pon ahí la URL del proyecto y la clave anon/publishable (Settings → API en Supabase).
      </p>`);
    return;
  }

  if (!tg) {
    showFatal(
      "<p style=\"color:red\">Abre esta página desde Telegram (bot → Mini App).</p>",
    );
    return;
  }

  tg.ready();
  tg.expand();

  const initData = tg.initData;
  if (!initData) {
    showFatal(
      "<p style=\"color:red\">No hay sesión de Telegram. Entra desde el enlace del bot.</p>",
    );
    return;
  }

  try {
    const data = await invokeFunction("validate-telegram", {
      body: { initData },
    });

    telegramInitData = initData;
    userData = data.user;
    userId = data.user.id;
    usernameEl.textContent = `@${userData.username || userData.first_name}`;

    await loadClicks();

    loadingEl.classList.remove("active");
    mainEl.classList.add("active");
  } catch (err) {
    console.error(err);
    const msg =
      err instanceof Error ? err.message : "Error al inicializar la sesión";
    showFatal(
      `<p style="color:red">❌ ${escapeHtml(msg)}</p><p style="font-size:12px;margin-top:8px">Comprueba que las Edge Functions estén desplegadas y que <code>TELEGRAM_BOT_TOKEN</code> exista como secret en Supabase.</p>`,
    );
  }
}

function displayClickTotal() {
  clickCountEl.textContent = serverClicks + queuedClicks + inFlightClicks;
}

/** El número de clicks que devuelve una función; null si viene raro (evita “volver” al total viejo). */
function readClicksFromResponse(raw) {
  if (raw == null || typeof raw !== "object") return null;
  const n = Number(raw.clicks);
  return Number.isFinite(n) ? n : null;
}

/** Solo lee el total en servidor (no toca pending). Útil si hubo respuesta rara al guardar. */
async function pullServerClickCount() {
  const data = await invokeFunction("get-clicks", {
    body: { initData: telegramInitData },
  });
  const n = readClicksFromResponse(data);
  // Un clicker solo sube; si llega un valor menor, suele ser lectura retrasada.
  if (n !== null) serverClicks = Math.max(serverClicks, n);
}

async function loadClicks() {
  try {
    await pullServerClickCount();
    queuedClicks = 0;
    inFlightClicks = 0;
    displayClickTotal();
  } catch (err) {
    console.error(err);
    clickCountEl.textContent = "?";
  }
}

function scheduleFlushClicks() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPendingClicks();
  }, FLUSH_DELAY_MS);
}

/**
 * Envía los pendingClicks acumulados en una sola llamada (un solo viaje de red y una validación Telegram).
 * Importante: si la respuesta no trae `clicks` numérico, NO reutilizamos un serverClicks viejo:
 * ya vaciamos pending al empezar y eso era lo que provocaba que el contador “saltara atrás” (ej. 40 → 20).
 */
async function flushPendingClicks() {
  if (flushInFlight || queuedClicks === 0) return;

  flushInFlight = true;
  const delta = queuedClicks;
  queuedClicks = 0;
  inFlightClicks = delta;
  const expectedServerAfterFlush = serverClicks + inFlightClicks;

  try {
    const raw = await invokeFunction("update-clicks", {
      body: { initData: telegramInitData, delta },
    });
    const confirmed = readClicksFromResponse(raw);
    if (confirmed === null) {
      await pullServerClickCount();
      // Si aún no aparece el lote en el servidor, lo reencolamos.
      if (serverClicks < expectedServerAfterFlush) {
        queuedClicks += inFlightClicks;
      }
    } else {
      serverClicks = Math.max(serverClicks, confirmed);
    }
  } catch (err) {
    console.error(err);
    queuedClicks += inFlightClicks;
    try {
      await pullServerClickCount();
    } catch (e) {
      console.error(e);
    }
  } finally {
    inFlightClicks = 0;
    flushInFlight = false;
    displayClickTotal();
    // Si mientras guardábamos entraron más clics, enviamos en cadena (sin esperar otros 280ms).
    if (queuedClicks > 0) {
      queueMicrotask(() => void flushPendingClicks());
    }
  }
}

function updateClicks() {
  queuedClicks += 1;
  displayClickTotal();
  scheduleFlushClicks();

  clickBtn.style.transform = "scale(0.95)";
  setTimeout(() => {
    clickBtn.style.transform = "scale(1)";
  }, 100);
}

// Al minimizar o cerrar, intenta enviar lo pendiente (mejor esfuerzo; Telegram a veces mata el WebView rápido).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && queuedClicks > 0) {
    void flushPendingClicks();
  }
});

async function loadLeaderboard() {
  leaderboardList.innerHTML =
    '<div style="text-align:center;padding:20px">Cargando…</div>';

  try {
    const data = await invokeFunction("get-leaderboard", { method: "GET" });

    if (data.users?.length > 0) {
      leaderboardList.innerHTML = data.users
        .map((user, index) => {
          const rankClass =
            index === 0
              ? "gold"
              : index === 1
                ? "silver"
                : index === 2
                  ? "bronze"
                  : "";
          const isMe = user.id === userId ? "current-user" : "";
          const label = escapeHtml(user.username || user.first_name);
          return `
            <div class="leaderboard-item ${isMe}">
              <span class="leaderboard-rank ${rankClass}">#${index + 1}</span>
              <span class="leaderboard-user">${label}</span>
              <span class="leaderboard-clicks">${user.clicks} 👆</span>
            </div>`;
        })
        .join("");
    } else {
      leaderboardList.innerHTML =
        '<p style="text-align:center;padding:20px">Sin datos aún</p>';
    }
  } catch (err) {
    console.error(err);
    leaderboardList.innerHTML =
      '<p style="text-align:center;padding:20px;color:red">No se pudo cargar el ranking</p>';
  }
}

clickBtn.addEventListener("click", updateClicks);

leaderboardBtn.addEventListener("click", () => {
  modal.classList.add("active");
  loadLeaderboard();
});

closeModal.addEventListener("click", () => {
  modal.classList.remove("active");
});

modal.addEventListener("click", (e) => {
  if (e.target === modal) modal.classList.remove("active");
});

init();
