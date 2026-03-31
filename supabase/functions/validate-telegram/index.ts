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
    const { initData } = await req.json();
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN no configurado");

    const user = await verifyTelegramWebAppInitData(initData, botToken);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Upsert atómico para evitar race conditions cuando el usuario abre la app desde múltiples dispositivos
    await supabase.from("users").upsert({
      id: user.id,
      telegram_id: user.id,
      username: user.username ?? null,
      first_name: user.first_name,
      last_name: user.last_name ?? null,
      clicks: 0,
    }, {
      onConflict: "telegram_id",
      ignoreDuplicates: false,
    });

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          first_name: user.first_name,
          last_name: user.last_name,
        },
      }),
      {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error desconocido";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
