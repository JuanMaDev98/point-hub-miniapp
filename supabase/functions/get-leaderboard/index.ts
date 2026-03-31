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
    // Validar autenticación de Telegram para consistencia con el resto de funciones
    const { initData } = await req.json();
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN no configurado");

    await verifyTelegramWebAppInitData(initData, botToken);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data, error } = await supabase
      .from("users")
      .select("id, telegram_id, username, first_name, last_name, clicks")
      .order("clicks", { ascending: false })
      .limit(10);

    if (error) throw new Error(error.message);

    return new Response(JSON.stringify({ users: data ?? [] }), {
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
