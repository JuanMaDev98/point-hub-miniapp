import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyTelegramWebAppInitData } from "../_shared/telegram-init.ts";

serve(async (req) => {
  const origin = req.headers.get("Origin");
  const headers = getCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  try {
    const body = await req.json();
    const { initData } = body;
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN no configurado");

    const user = await verifyTelegramWebAppInitData(initData, botToken);

    let delta = 1;
    const raw = body.delta;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      delta = Math.floor(raw);
    }

    // Validar que delta sea positivo antes de procesar
    if (delta <= 0) {
      throw new Error("Delta debe ser un número positivo");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Rate limiting: verificar que el usuario no exceda el límite en la ventana de tiempo
    const { data: rateOk, error: rateError } = await supabase.rpc(
      "check_click_rate_limit",
      {
        user_telegram_id: user.id,
        max_clicks: 400,
        window_seconds: 60,
      }
    );

    if (rateError) {
      throw new Error("Error al verificar rate limit: " + rateError.message);
    }

    if (!rateOk) {
      throw new Error(
        "Demasiados clicks. Espera un momento antes de continuar."
      );
    }

    const { data: newCount, error } = await supabase.rpc("increment_clicks_by", {
      user_telegram_id: user.id,
      delta,
    });

    if (error) throw new Error(error.message);
    if (newCount == null) {
      throw new Error("No existe fila de usuario; vuelve a abrir la Mini App");
    }

    return new Response(JSON.stringify({ clicks: newCount }), {
      status: 200,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error desconocido";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
