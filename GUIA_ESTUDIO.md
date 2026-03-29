# Guia de estudio - Clicker Mini App

Este documento explica las piezas importantes del proyecto y por que estan hechas asi.

## 1) Flujo general

1. Telegram abre la Mini App y entrega `initData` (datos firmados).
2. `app.js` llama `validate-telegram` para validar firma en servidor.
3. Si todo va bien, el frontend carga clicks actuales (`get-clicks`).
4. Cada click sube instantaneamente en UI y se agrupa en lotes.
5. Cada lote se manda a `update-clicks` con `delta`.
6. El leaderboard se consulta con `get-leaderboard`.

## 2) Frontend (`app.js`)

### Estado clave

- `serverClicks`: total confirmado por servidor.
- `queuedClicks`: clicks locales aun no enviados.
- `inFlightClicks`: clicks ya enviados esperando respuesta.

Total visible:

- `serverClicks + queuedClicks + inFlightClicks`

Por que funciona bien:

- Nunca esperas a red para ver que un click "conto".
- Si red falla, `inFlight` vuelve a `queued` y se reintenta.
- Se evita disparar una request por click (menos latencia y menos carga).

### Funciones importantes

- `init()`:
  - Carga `config.js`.
  - Verifica que se abrio desde Telegram.
  - Valida usuario con `validate-telegram`.
  - Carga clicks iniciales.

- `invokeFunction(name, options)`:
  - Llama Edge Functions de forma centralizada.
  - Normaliza errores para no repetir logica en cada llamada.

- `updateClicks()`:
  - Incrementa `queuedClicks`.
  - Refresca UI inmediatamente.
  - Programa envio por debounce.

- `flushPendingClicks()`:
  - Mueve `queued -> inFlight`.
  - Envia lote al backend.
  - Si falla, reencola y reintenta.

## 3) Backend (Supabase Edge Functions)

- `validate-telegram`:
  - Verifica firma HMAC del `initData`.
  - Crea/actualiza usuario en tabla `users`.

- `get-clicks`:
  - Vuelve a validar `initData`.
  - Lee clicks del usuario autenticado.

- `update-clicks`:
  - Vuelve a validar `initData`.
  - Aplica `delta` en SQL con `increment_clicks_by`.

- `get-leaderboard`:
  - Devuelve Top 10 por clicks.

## 4) Base de datos

Funcion SQL importante:

- `increment_clicks_by(user_telegram_id, delta)`:
  - Incremento atomico.
  - Limita `delta` para evitar abusos.

Por que SQL y no calculo en frontend:

- Evita condiciones de carrera.
- Evita manipular contador desde cliente.

## 5) Seguridad

- Nunca confiar en `userId` enviado por navegador.
- Siempre derivar usuario desde `initData` validado.
- `service_role` solo en secrets del backend, nunca en frontend.
- Escapar texto antes de inyectar HTML (`escapeHtml`).

## 6) Como pensar este patron en otros proyectos

Si quieres UI rapida con red lenta:

1. Separa estado local de estado confirmado.
2. Muestra suma de ambos estados.
3. Agrupa eventos rapidos en lotes.
4. Haz reintentos idempotentes cuando puedas.
5. Mantener backend como fuente de verdad.

