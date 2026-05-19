// Master plan R-7 / B-19: server-side batched push for LOCATION-mode audits.
//
// Replaces the previous client fan-out (admin browser → 381 parallel HTTP
// calls to send-push). The admin's browser now makes ONE call to this
// function; we look up matching students server-side, fan out with a
// concurrency cap (R-40), log per-recipient outcomes to audit_push_log,
// and return a summary. The audit session is ACTIVE before fan-out begins,
// so users with the app open already see the in-app banner — push is
// strictly advisory.
//
// VAPID + AES-128-GCM crypto is duplicated inline from send-push (R-7
// rationale: refactoring send-push risks the working admin-approval push
// path; the ~200 lines of crypto are tolerable cost for v1).
//
// Auth: requires admin PIN in the body. The PIN is verified against
// app_settings via the service-role Supabase client.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.0'

// ─── Base64URL helpers ────────────────────────────────────────────────────────

function b64uDecode(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

function b64uEncode(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(len)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

const te = new TextEncoder()

// ─── HKDF ─────────────────────────────────────────────────────────────────────

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8,
  )
  return new Uint8Array(bits)
}

// ─── VAPID JWT (ES256) ────────────────────────────────────────────────────────

async function makeVapidJwt(
  endpoint: string,
  subject: string,
  vapidPublicKeyB64u: string,
  vapidPrivateKeyB64u: string,
): Promise<string> {
  const origin = new URL(endpoint).origin

  const header = b64uEncode(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payload = b64uEncode(te.encode(JSON.stringify({
    aud: origin,
    exp: Math.floor(Date.now() / 1000) + 43_200,
    sub: subject,
  })))
  const sigInput = te.encode(`${header}.${payload}`)

  const pubBytes = b64uDecode(vapidPublicKeyB64u)
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: b64uEncode(pubBytes.slice(1, 33)),
    y: b64uEncode(pubBytes.slice(33, 65)),
    d: vapidPrivateKeyB64u,
    key_ops: ['sign'],
  }
  const ecKey = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, ecKey, sigInput)
  return `${header}.${payload}.${b64uEncode(sig)}`
}

// ─── Web Push encryption (RFC 8291 + 8188 aes128gcm) ──────────────────────────

async function encryptWebPush(
  plaintext: string,
  receiverP256dhB64u: string,
  authSecretB64u: string,
): Promise<{ body: Uint8Array }> {
  const receiverPubBytes = b64uDecode(receiverP256dhB64u)
  const authSecret = b64uDecode(authSecretB64u)
  const plaintextBytes = te.encode(plaintext)

  const senderKP = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  )
  const senderPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', senderKP.publicKey))

  const receiverKey = await crypto.subtle.importKey(
    'raw', receiverPubBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  )
  const ecdhBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiverKey }, senderKP.privateKey, 256,
  )
  const ecdhSecret = new Uint8Array(ecdhBits)

  const keyInfo = concat(te.encode('WebPush: info\x00'), receiverPubBytes, senderPubRaw)
  const ikmCombined = await hkdf(ecdhSecret, authSecret, keyInfo, 32)

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(ikmCombined, salt, te.encode('Content-Encoding: aes128gcm\x00'), 16)
  const nonce = await hkdf(ikmCombined, salt, te.encode('Content-Encoding: nonce\x00'), 12)

  const padded = concat(plaintextBytes, new Uint8Array([2]))
  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt'])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, cekKey, padded),
  )

  const rs = new Uint8Array(4)
  new DataView(rs.buffer).setUint32(0, 4096, false)
  return { body: concat(salt, rs, new Uint8Array([senderPubRaw.length]), senderPubRaw, ciphertext) }
}

// ─── Per-recipient send + log ─────────────────────────────────────────────────

async function sendOne(
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
): Promise<{ ok: boolean; gone: boolean; error?: string }> {
  try {
    const { body } = await encryptWebPush(payload, sub.keys.p256dh, sub.keys.auth)
    const jwt = await makeVapidJwt(sub.endpoint, VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
    const resp = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`,
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'TTL': '86400',
        'Urgency': 'high',
      },
      body,
    })
    if (resp.ok) return { ok: true, gone: false }
    const text = await resp.text()
    return { ok: false, gone: resp.status === 410 || resp.status === 404, error: `${resp.status}: ${text.slice(0, 120)}` }
  } catch (err) {
    return { ok: false, gone: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@yeshiva.example.com'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CONCURRENCY = 20 // master plan R-40

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: CORS })

  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      throw new Error('VAPID keys not configured in Edge Function secrets')
    }
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error('Supabase service-role credentials missing')
    }

    const body = await req.json() as {
      sessionId: string
      adminPin: string
      title?: string
      message?: string
    }
    if (!body.sessionId || !body.adminPin) {
      return new Response(JSON.stringify({ error: 'sessionId and adminPin required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })

    // 1. Verify admin PIN
    const { data: pinOk, error: pinErr } = await supabase.rpc('verify_admin_pin', { p_pin: body.adminPin })
    if (pinErr) throw pinErr
    if (!pinOk) {
      return new Response(JSON.stringify({ error: 'AUTH' }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // 2. Load active session — must be the one the admin says, and must be ACTIVE.
    const { data: session, error: sessErr } = await supabase
      .from('audit_sessions')
      .select('id, status, mode, class_ids, student_snapshot, title')
      .eq('id', body.sessionId)
      .maybeSingle()
    if (sessErr) throw sessErr
    if (!session) {
      return new Response(JSON.stringify({ error: 'SESSION_NOT_FOUND' }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }
    if (session.status !== 'ACTIVE') {
      return new Response(JSON.stringify({ error: 'SESSION_CLOSED' }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // 3. Collect student IDs from the snapshot
    const snapshot = (session.student_snapshot as Array<{ id: string }>) ?? []
    const studentIds = snapshot.map((s) => s.id).filter(Boolean)
    if (studentIds.length === 0) {
      return new Response(JSON.stringify({ sent: 0, failed: 0, removed: 0, total: 0 }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // 4. Look up push tokens for snapshot students
    const { data: students, error: studErr } = await supabase
      .from('students')
      .select('id, push_token')
      .in('id', studentIds)
      .not('push_token', 'is', null)
    if (studErr) throw studErr

    const recipients = (students ?? [])
      .map((s) => {
        try {
          return { id: s.id as string, sub: JSON.parse(s.push_token as string) }
        } catch {
          return null
        }
      })
      .filter((r): r is { id: string; sub: { endpoint: string; keys: { p256dh: string; auth: string } } } => r !== null)

    const payload = JSON.stringify({
      kind: 'INSPECTION_LOCATION', // master plan R-12 — SW dispatches on this
      sessionId: session.id,
      title: body.title ?? 'ביקורת פנימית — נדרש מיקום',
      body: body.message ?? 'המנהל מבקש לדעת את מיקומך — פתח את האפליקציה ושתף מיקום',
    })

    // 5. Fan-out with concurrency cap (R-40). Wait for each batch to finish
    //    before starting the next so we don't blow past Apple's rate limit.
    let sent = 0
    let failed = 0
    let removed = 0
    const goneStudentIds: string[] = []
    let lastError: string | undefined

    for (let i = 0; i < recipients.length; i += CONCURRENCY) {
      const slice = recipients.slice(i, i + CONCURRENCY)
      const results = await Promise.all(slice.map((r) => sendOne(r.sub, payload).then((res) => ({ r, res }))))
      for (const { r, res } of results) {
        if (res.ok) sent++
        else {
          failed++
          lastError = res.error ?? lastError
          if (res.gone) goneStudentIds.push(r.id)
        }
      }
    }

    // 6. Best-effort: clear push_token for subscriptions the push service
    //    reported as gone (410/404).
    if (goneStudentIds.length > 0) {
      await supabase.from('students').update({ push_token: null }).in('id', goneStudentIds)
      removed = goneStudentIds.length
    }

    // 7. Log to audit_push_log (best-effort — log row per outcome class).
    await supabase.from('audit_push_log').insert([
      {
        session_id: session.id,
        success: true,
        payload_summary: `sent=${sent} failed=${failed} removed=${removed} total=${recipients.length}`,
      },
    ])

    return new Response(JSON.stringify({
      sent, failed, removed, total: recipients.length, lastError,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('[send-audit-push]', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }
})
