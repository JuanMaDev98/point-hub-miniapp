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

    // Nunca confíes en un userId que mande el cliente: derivamos el id de initData verificado.
    const user = await verifyTelegramWebAppInitData(initData, botToken);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data, error } = await supabase
      .from("users")
      .select("clicks")
      .eq("telegram_id", user.id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new Error("Usuario no encontrado");

    return new Response(JSON.stringify({ clicks: data.clicks }), {
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
