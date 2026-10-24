import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
);

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const botUsername = Deno.env.get('TELEGRAM_BOT_USERNAME')?.replace(/^@/, '');
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !botUsername) {
    return json({ error: 'Telegram linking is not configured yet.' }, 503);
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Sign in to connect Telegram.' }, 401);

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser();
  if (authError || !authData.user) return json({ error: 'Your session expired. Sign in again.' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const codeHash = toHex(new Uint8Array(digest));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error: saveError } = await admin.from('telegram_link_codes').upsert({
    user_id: authData.user.id,
    code_hash: codeHash,
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
  });
  if (saveError) {
    console.error('Could not save Telegram link code', saveError.message);
    return json({ error: 'Could not create a Telegram link. Try again.' }, 500);
  }

  return json({ url: `https://t.me/${encodeURIComponent(botUsername)}?start=${token}` });
});

