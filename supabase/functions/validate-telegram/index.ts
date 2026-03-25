import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { initData } = await req.json();
    
    if (!initData) {
      throw new Error('No initData provided');
    }

    // Validar initData con Telegram Bot Token
    const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!BOT_TOKEN) {
      throw new Error('BOT_TOKEN not configured');
    }

    // Parsear initData
    const urlParams = new URLSearchParams(initData);
    const userStr = urlParams.get('user');
    const hash = urlParams.get('hash');
    
    if (!userStr || !hash) {
      throw new Error('Invalid initData');
    }

    const user = JSON.parse(userStr);
    
    // Validar hash (simplificado - en producción validar correctamente)
    const dataCheckString = Array.from(urlParams.entries())
      .filter(([key]) => key !== 'hash')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('WebAppData'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const keyBuffer = await crypto.subtle.sign(
      'HMAC',
      cryptoKey,
      new TextEncoder().encode(BOT_TOKEN)
    );

    const finalKey = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign(
      'HMAC',
      finalKey,
      new TextEncoder().encode(dataCheckString)
    );

    const calculatedHash = Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    if (calculatedHash !== hash) {
      throw new Error('Invalid hash');
    }

    // Crear/Actualizar usuario en Supabase
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', user.id)
      .single();

    if (existingUser) {
      // Actualizar información
      await supabase
        .from('users')
        .update({
          username: user.username || null,
          first_name: user.first_name,
          last_name: user.last_name || null,
          updated_at: new Date().toISOString()
        })
        .eq('telegram_id', user.id);
    } else {
      // Crear nuevo usuario
      await supabase
        .from('users')
        .insert({
          id: user.id,
          telegram_id: user.id,
          username: user.username || null,
          first_name: user.first_name,
          last_name: user.last_name || null,
          clicks: 0
        });
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        user: {
          id: user.id,
          username: user.username,
          first_name: user.first_name,
          last_name: user.last_name
        }
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
      }
    );
  }
});