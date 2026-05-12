// notify-admin-quota-full
// Called by the client after submit_departure returns { status: 'PENDING', notifyAdmin: true }.
// Sends a Web Push notification to any admin device that has registered a push token
// via the admin_push_tokens app_settings keys.
//
// Because the admin is PIN-authenticated (no Supabase Auth user), admin push tokens
// are stored in app_settings under key "admin_push_token_{deviceId}".
// The admin UI registers a token on login via POST /functions/v1/notify-admin-quota-full
// with action='register', or triggers a notification with action='notify'.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

interface NotifyPayload {
  action: 'notify'
  studentName: string
  classId: string
  quota: number
  current: number
  departureId: string
}

interface RegisterPayload {
  action: 'register'
  pushToken: string
  deviceId: string
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function jsonErr(msg: string, status = 400): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  })
}

function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  })
}

async function sendPush(
  subscription: string,
  title: string,
  body: string,
): Promise<{ sent: boolean; gone: boolean }> {
  const res = await supabase.functions.invoke('send-push', {
    body: { subscription, title, body },
  })
  const data = res.data as { sent?: boolean; gone?: boolean } | null
  return { sent: data?.sent === true, gone: data?.gone === true }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') return jsonErr('Method not allowed', 405)

  let body: NotifyPayload | RegisterPayload
  try {
    body = await req.json()
  } catch {
    return jsonErr('Invalid JSON', 400)
  }

  // ── Register admin push token ─────────────────────────────────────────────
  if (body.action === 'register') {
    // Require a shared secret known only to the admin app
    const provided = req.headers.get('X-Admin-Registration-Secret') ?? ''
    const expected = Deno.env.get('ADMIN_REGISTRATION_SECRET') ?? ''

    if (!expected) {
      // Secret not configured — reject all registrations until it is set
      return new Response(JSON.stringify({ error: 'registration_disabled' }), { status: 503 })
    }
    if (provided !== expected) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
    }

    const { pushToken, deviceId } = body as RegisterPayload
    if (!pushToken || !deviceId) return jsonErr('pushToken and deviceId required', 400)

    const { error } = await supabase
      .from('app_settings')
      .upsert(
        { key: `admin_push_token_${deviceId}`, value: pushToken },
        { onConflict: 'key' },
      )
    if (error) return jsonErr(`Failed to register: ${error.message}`, 500)
    return jsonOk({ registered: true })
  }

  // ── Send quota-full notification to all registered admin devices ──────────
  if (body.action === 'notify') {
    const { studentName, classId, quota, current, departureId } = body as NotifyPayload

    // Fetch all admin push tokens
    const { data: tokenRows, error: selErr } = await supabase
      .from('app_settings')
      .select('key, value')
      .like('key', 'admin_push_token_%')

    if (selErr) return jsonErr(`DB error: ${selErr.message}`, 500)

    const tokens = (tokenRows ?? []).map((r) => r.value).filter(Boolean)
    if (tokens.length === 0) {
      // No admin devices registered — realtime subscription is the fallback
      return jsonOk({ sent: 0, note: 'no admin push tokens registered' })
    }

    const title = '⚠️ מכסת הכיתה מלאה'
    const notifyBody = `${studentName} מבקש יציאה אך המכסה מלאה (${current}/${quota}). נדרש אישורך.`

    let sent = 0
    const staleKeys: string[] = []

    await Promise.all(
      (tokenRows ?? []).map(async (row) => {
        try {
          const { sent: ok, gone } = await sendPush(row.value, title, notifyBody)
          if (ok) {
            sent++
          } else if (gone) {
            // Only remove token when the push service explicitly says it's gone (410/404)
            staleKeys.push(row.key)
          }
          // Transient failures (network errors, 5xx) are left in place for retry next time
        } catch {
          // Network-level exception — do not remove the token
        }
      }),
    )

    // Clean up stale admin tokens
    if (staleKeys.length > 0) {
      await supabase.from('app_settings').delete().in('key', staleKeys)
    }

    return jsonOk({ sent, stale: staleKeys.length, departureId })
  }

  return jsonErr('Unknown action', 400)
})
