import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyTelegramWebAppInitData } from "../_shared/telegram-init.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

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
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error desconocido";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
