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

type Recipient = { user_id: string; display_name: string; email: string; role: string };
type PreparedSend = {
  batch_id: string;
  title?: string;
  message?: string;
  channels: string[];
  recipients: Recipient[];
  recipient_count?: number;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: 'Notification sending is not configured.' }, 503);

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Sign in to send notifications.' }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json({ error: 'Your session expired. Sign in again.' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  let prepared: PreparedSend;
  if (body.action === 'send') {
    const { data, error } = await userClient.rpc('prepare_manual_notification_send', {
      p_title: body.title,
      p_message: body.message,
      p_scope: body.scope,
      p_user_ids: Array.isArray(body.userIds) ? body.userIds : [],
      p_channels: Array.isArray(body.channels) ? body.channels : ['in_app', 'telegram'],
    });
    if (error) return json({ error: error.message || 'Could not create this notification.' }, 400);
    prepared = data as PreparedSend;
    prepared.title = String(body.title || '');
    prepared.message = String(body.message || '');
  } else if (body.action === 'retry') {
    const { data, error } = await userClient.rpc('prepare_manual_notification_retry', {
      p_batch_id: body.batchId,
    });
    if (error) return json({ error: error.message || 'Could not retry this notification.' }, 400);
    prepared = data as PreparedSend;
  } else {
    return json({ error: 'Choose a valid notification action.' }, 400);
  }

  if (!prepared?.batch_id || !Array.isArray(prepared.recipients)) {
    return json({ error: 'The notification request could not be prepared.' }, 500);
  }
  const recipientIds = prepared.recipients.map((recipient) => recipient.user_id).filter(Boolean);
  if (!recipientIds.length || !prepared.channels?.includes('telegram')) {
    return json({
      ok: true,
      batch_id: prepared.batch_id,
      recipient_count: prepared.recipient_count ?? recipientIds.length,
      telegram_sent: 0,
      telegram_failed: 0,
      telegram_not_connected: 0,
    });
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: connections, error: connectionError } = await service
    .from('telegram_connections')
    .select('user_id,telegram_chat_id')
    .in('user_id', recipientIds);
  if (connectionError) {
    await service.from('manual_notification_deliveries')
      .update({ telegram_status: 'failed', telegram_error: 'Could not load Telegram connections.', telegram_attempted_at: new Date().toISOString() })
      .eq('batch_id', prepared.batch_id)
      .eq('telegram_status', 'pending');
    return json({ ok: true, batch_id: prepared.batch_id, recipient_count: recipientIds.length, telegram_sent: 0, telegram_failed: recipientIds.length, telegram_not_connected: 0 });
  }

  const chatByUser = new Map((connections || []).map((connection) => [connection.user_id, connection.telegram_chat_id]));
  let telegramSent = 0;
  let telegramFailed = 0;
  let telegramNotConnected = 0;
  const attemptedAt = new Date().toISOString();

  for (let offset = 0; offset < prepared.recipients.length; offset += 10) {
    const group = prepared.recipients.slice(offset, offset + 10);
    await Promise.all(group.map(async (recipient) => {
      const chatId = chatByUser.get(recipient.user_id);
      let status: 'sent' | 'failed' | 'not_connected';
      let failure: string | null = null;
      let sentAt: string | null = null;
      if (!chatId) {
        status = 'not_connected';
      } else if (!botToken) {
        status = 'failed';
        failure = 'Telegram delivery is not configured.';
      } else {
        try {
          const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `iGO Delivery\\n${prepared.title}\\n\\n${prepared.message}\\n\\nOpen: https://igomv.com/`.slice(0, 3900),
              disable_web_page_preview: true,
            }),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok || !result?.ok) {
            status = 'failed';
            failure = 'Telegram could not deliver this message.';
          } else {
            status = 'sent';
            sentAt = new Date().toISOString();
          }
        } catch {
          status = 'failed';
          failure = 'Telegram could not be reached.';
        }
      }

      const { error: updateError } = await service.from('manual_notification_deliveries')
        .update({
          telegram_status: status,
          telegram_error: failure,
          telegram_attempted_at: attemptedAt,
          telegram_sent_at: sentAt,
        })
        .eq('batch_id', prepared.batch_id)
        .eq('recipient_user_id', recipient.user_id);
      if (updateError || status === 'failed') telegramFailed += 1;
      else if (status === 'sent') telegramSent += 1;
      else telegramNotConnected += 1;
    }));
  }

  return json({
    ok: true,
    batch_id: prepared.batch_id,
    recipient_count: prepared.recipient_count ?? recipientIds.length,
    telegram_sent: telegramSent,
    telegram_failed: telegramFailed,
    telegram_not_connected: telegramNotConnected,
  });
});
