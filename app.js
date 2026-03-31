/**
 * Frontend principal de la Mini App.
 *
 * Idea clave:
 * - El cliente SIEMPRE muestra respuesta instantánea al clic.
 * - El servidor SIEMPRE decide el total real de clicks.
 * - El cliente envía clicks en lotes para reducir latencia percibida.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// ============================================================================
// Estado global de la app
// ============================================================================

/** Cliente Supabase. Se crea al leer config.js en runtime. */
let supabase = null;

const tg = window.Telegram?.WebApp;

/** initData firmado por Telegram; se manda al backend en cada operación sensible. */
let telegramInitData = "";
let userId = null;
let userData = null;

/** Clicks confirmados por backend. */
let serverClicks = 0;
/** Clicks acumulados localmente y aún no enviados. */
let queuedClicks = 0;
/** Clicks enviados y pendientes de respuesta del backend. */
let inFlightClicks = 0;
let flushTimer = null;
let flushInFlight = false;

/**
 * Persistencia de la cola de clicks en localStorage.
 * Si el usuario cierra la app con clicks pendientes, se recuperan al volver.
 */
const STORAGE_KEY = "pointhub_click_queue";

/** Clicks confirmados por backend al momento de guardar en localStorage (referencia). */
let savedServerClicks = 0;

function loadQueuedClicks() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed.queued === "number" && parsed.queued > 0) {
        queuedClicks = parsed.queued;
        savedServerClicks = typeof parsed.serverClicks === "number" ? parsed.serverClicks : 0;
      }
    }
  } catch {
    /** ignorar */
  }
}

function saveQueuedClicks() {
  try {
    if (queuedClicks > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ queued: queuedClicks, serverClicks: serverClicks }));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /** ignorar */
  }
}

function clearQueuedClicks() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /** ignorar */
  }
}

/**
 * Debounce del envío:
 * esperamos este tiempo tras el último clic para agrupar varios en una sola petición.
 */
const FLUSH_DELAY_MS = 280;

// ============================================================================
// Referencias del DOM
// ============================================================================

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
 * Wrapper de invocación de Edge Functions con manejo de errores consistente.
 * Si Supabase devuelve error con body JSON, intenta usar ese mensaje más específico.
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

/** Muestra error fatal (bloqueante) en el overlay de carga. */
function showFatal(html) {
  loadingEl.classList.add("active");
  loadingEl.innerHTML = html;
}

/** Escapa texto antes de insertarlo en innerHTML (evita XSS básico). */
function escapeHtml(text) {
  if (text == null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Carga configuración + valida entorno Telegram + autentica usuario en backend.
 * Este método deja la app lista para usarse.
 */
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
    // Esto crea/actualiza usuario en la base si la firma de Telegram es válida.
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

/** Pinta el total visible en pantalla.
 * Fórmula:
 * - serverClicks: lo confirmado por backend.
 * - queuedClicks: lo que ya tocó el usuario y aún no salió.
 * - inFlightClicks: lo ya enviado pero no confirmado todavía.
 */
function displayClickTotal() {
  clickCountEl.textContent = serverClicks + queuedClicks + inFlightClicks;
}

/** Intenta leer `{ clicks: number }` de una respuesta. */
function readClicksFromResponse(raw) {
  if (raw == null || typeof raw !== "object") return null;
  const n = Number(raw.clicks);
  return Number.isFinite(n) ? n : null;
}

/** Trae el contador real desde backend sin tocar cola local. */
async function pullServerClickCount() {
  const data = await invokeFunction("get-clicks", {
    body: { initData: telegramInitData },
  });
  const n = readClicksFromResponse(data);
  // Un clicker solo sube; si llega un valor menor, suele ser lectura retrasada.
  if (n !== null) serverClicks = Math.max(serverClicks, n);
}

/** Carga inicial del contador al entrar a la app. */
async function loadClicks() {
  try {
    loadQueuedClicks();
    await pullServerClickCount();
    // Detectar si los clicks pendientes ya fueron contados por el servidor
    // (puede pasar si la app se cerró mientras el flushPendingClicks del visibilitychange
    // ya había enviado pero la respuesta no llegó a tiempo).
    if (queuedClicks > 0 && serverClicks >= savedServerClicks + queuedClicks) {
      queuedClicks = 0;
      clearQueuedClicks();
    }
    displayClickTotal();
    // Si hay clicks pendientes al cargar, enviarlos inmediatamente
    if (queuedClicks > 0) {
      void flushPendingClicks();
    }
  } catch (err) {
    console.error(err);
    clickCountEl.textContent = "?";
  }
}

/** Programa el envío por lotes usando debounce. */
function scheduleFlushClicks() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPendingClicks();
  }, FLUSH_DELAY_MS);
  saveQueuedClicks();
}

/**
 * Envía una tanda de clicks al backend.
 *
 * Por qué este diseño:
 * 1) Mueve `queued -> inFlight` antes de llamar API para mantener UI reactiva.
 * 2) Si falla, devuelve ese lote a `queued` para reintento.
 * 3) Si respuesta llega rara, consulta backend y decide si reencolar.
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
    saveQueuedClicks();
    // Si mientras guardábamos entraron más clics, enviamos en cadena (sin esperar otros 280ms).
    if (queuedClicks > 0) {
      queueMicrotask(() => void flushPendingClicks());
    }
  }
}

/**
 * Limpia la cola de clicks pendientes al cerrar la app.
 * Se llama cuando la visibilidad cambia a "hidden" para evitar duplicados
 * si el flushPendingClicks ya fue enviado pero la respuesta no llegó.
 */
function clearPendingClicksOnClose() {
  if (queuedClicks > 0 || inFlightClicks > 0) {
    // No borramos la cola de localStorage aquí porque el flushPendingClicks
    // del visibilitychange ya se encargó de enviarla. Solo aseguramos que
    // si la app se vuelve a abrir, no se duplique nada.
    saveQueuedClicks();
  }
}

/** Handler del botón de click: suma instantánea + programa sync. */
function updateClicks() {
  queuedClicks += 1;
  displayClickTotal();
  scheduleFlushClicks();

  clickBtn.style.transform = "scale(0.95)";
  setTimeout(() => {
    clickBtn.style.transform = "scale(1)";
  }, 100);
}

// Al ocultar la app, intentamos enviar cola pendiente (best effort).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    if (queuedClicks > 0) {
      void flushPendingClicks();
    }
    clearPendingClicksOnClose();
  }
});

/** Carga y pinta el Top 10. */
async function loadLeaderboard() {
  leaderboardList.innerHTML =
    '<div style="text-align:center;padding:20px">Cargando…</div>';

  try {
    const data = await invokeFunction("get-leaderboard", {
      body: { initData: telegramInitData },
    });

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

// ============================================================================
// Eventos UI
// ============================================================================

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

// Punto de entrada.
init();
