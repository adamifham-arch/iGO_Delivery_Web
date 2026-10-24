import { createClient } from 'npm:@supabase/supabase-js@2';

type NotificationInsert = {
  type?: string;
  table?: string;
  schema?: string;
  record?: {
    id?: string;
    user_id?: string;
    title?: string;
    message?: string;
  };
};

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] || 0) ^ (b[index] || 0);
  }
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const expectedSecret = Deno.env.get('TELEGRAM_DISPATCH_SECRET') || '';
  const receivedSecret = request.headers.get('X-iGO-Webhook-Secret') || '';
  if (!expectedSecret || !constantTimeEqual(receivedSecret, expectedSecret)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!botToken || !supabaseUrl || !serviceRoleKey) return new Response('Not configured', { status: 503 });

  let payload: NotificationInsert;
  try {
    payload = await request.json();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const notification = payload.record;
  if (payload.type !== 'INSERT' || payload.schema !== 'public' || payload.table !== 'notifications'
    || !notification?.user_id || !notification.title || !notification.message) {
    return Response.json({ ok: true, skipped: true });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (notification.id) {
    const { data: manualDelivery, error: manualDeliveryError } = await admin
      .from('manual_notification_deliveries')
      .select('id')
      .eq('notification_id', notification.id)
      .maybeSingle();
    if (manualDeliveryError) {
      console.error('Could not check manual notification delivery', manualDeliveryError.message);
      return new Response('Could not check manual notification delivery', { status: 500 });
    }
    if (manualDelivery) return Response.json({ ok: true, skipped: true, manual_dispatch: true });
  }
  const { data: connection, error: connectionError } = await admin
    .from('telegram_connections')
    .select('telegram_chat_id')
    .eq('user_id', notification.user_id)
    .maybeSingle();
  if (connectionError) {
    console.error('Could not find Telegram connection', connectionError.message);
    return new Response('Could not load Telegram connection', { status: 500 });
  }
  if (!connection?.telegram_chat_id) return Response.json({ ok: true, skipped: true });

  const text = `iGO Delivery\n${notification.title}\n\n${notification.message}\n\nOpen: https://igomv.com/`;
  const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: connection.telegram_chat_id,
      text: text.slice(0, 3900),
      disable_web_page_preview: true,
    }),
  });
  if (!telegramResponse.ok) {
    const details = await telegramResponse.text();
    console.error('Telegram notification delivery failed', telegramResponse.status, details.slice(0, 500));
    return new Response('Telegram delivery failed', { status: 502 });
  }

  return Response.json({ ok: true, notification_id: notification.id || null });
});

