import { createClient } from 'npm:@supabase/supabase-js@2';

type TelegramUpdate = {
  message?: {
    text?: string;
    chat?: { id?: number | string };
    from?: { username?: string };
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

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sendTelegramMessage(token: string, chatId: string, text: string) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!response.ok) {
    const details = await response.text();
    console.error('Telegram sendMessage failed', response.status, details.slice(0, 500));
    throw new Error('Telegram could not send the reply.');
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const expectedSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') || '';
  const receivedSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (!expectedSecret || !constantTimeEqual(receivedSecret, expectedSecret)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!botToken || !supabaseUrl || !serviceRoleKey) return new Response('Not configured', { status: 503 });

  let update: TelegramUpdate;
  try {
    update = await request.json();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const message = update.message;
  const chatIdValue = message?.chat?.id;
  if (!message?.text || chatIdValue === undefined || chatIdValue === null) {
    return Response.json({ ok: true });
  }
  const chatId = String(chatIdValue);
  const command = message.text.trim();
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (/^\/stop(?:@\w+)?(?:\s|$)/i.test(command)) {
    const { error } = await admin.from('telegram_connections').delete().eq('telegram_chat_id', chatId);
    if (error) {
      console.error('Could not disconnect Telegram chat', error.message);
      return new Response('Could not update connection', { status: 500 });
    }
    await sendTelegramMessage(botToken, chatId, 'Telegram alerts from iGO Delivery have been disconnected.');
    return Response.json({ ok: true });
  }

  const startMatch = command.match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]+))?\s*$/i);
  if (!startMatch?.[1]) {
    await sendTelegramMessage(botToken, chatId, 'To connect your account, open Notifications in iGO Delivery and choose Connect Telegram.');
    return Response.json({ ok: true });
  }

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(startMatch[1]));
  const codeHash = toHex(new Uint8Array(digest));
  const { data: linked, error: linkError } = await admin.rpc('consume_telegram_link_code', {
    p_code_hash: codeHash,
    p_chat_id: chatId,
    p_username: message.from?.username || '',
  });
  if (linkError) {
    console.error('Could not consume Telegram link code', linkError.message);
    await sendTelegramMessage(botToken, chatId, 'I could not connect your iGO account. Please try again from the site.');
    return new Response('Could not link account', { status: 500 });
  }
  if (!linked) {
    await sendTelegramMessage(botToken, chatId, 'That iGO link has expired or was already used. Create a new one from Notifications in the site.');
    return Response.json({ ok: true });
  }

  try {
    await sendTelegramMessage(botToken, chatId, 'Telegram is now connected to your iGO Delivery account. New iGO notifications will be sent here. Send /stop at any time to disconnect.');
  } catch (sendError) {
    console.error('Telegram account linked, but confirmation message failed', sendError);
  }
  return Response.json({ ok: true });
});

