// Dedicated Edge Function for internal-audit push notifications.
// Mirrors send-push (RFC 8291 / aes128gcm) but accepts a sessionId and targets
// only participants in that session who don't yet have a GRANTED location row.
//
// Payload sent to the device:
//   {
//     "type": "AUDIT_LOCATION_REQUEST",
//     "sessionId": "...",
//     "title": "ביקורת פנימית פעילה",
//     "body":  "פתח את האפליקציה כעת כדי לשלוח מיקום",
//     "url":   "/student?auditSession=<id>"
//   }
//
// public/push-sw.js parses `data.url` and opens that path on notification click.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── Base64URL helpers (copied from send-push for parity) ────────────────────

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

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key, length * 8,
  )
  return new Uint8Array(bits)
}

async function makeVapidJwt(endpoint: string, subject: string, pubB64u: string, privB64u: string): Promise<string> {
  const origin = new URL(endpoint).origin
  const header = b64uEncode(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payload = b64uEncode(te.encode(JSON.stringify({
    aud: origin,
    exp: Math.floor(Date.now() / 1000) + 43_200,
    sub: subject,
  })))
  const sigInput = te.encode(`${header}.${payload}`)
  const pubBytes = b64uDecode(pubB64u)
  const x = pubBytes.slice(1, 33)
  const y = pubBytes.slice(33, 65)
  const jwk: JsonWebKey = {
    kty: 'EC', crv: 'P-256',
    x: b64uEncode(x), y: b64uEncode(y),
    d: privB64u, key_ops: ['sign'],
  }
  const ecKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, ecKey, sigInput))
  return `${header}.${payload}.${b64uEncode(sig)}`
}

async function encryptPayload(plaintext: Uint8Array, p256dh: string, auth: string, vapidPubB64u: string): Promise<{ body: Uint8Array; cryptoKey: string; salt: string }> {
  const userPubBytes = b64uDecode(p256dh)
  const authSecret = b64uDecode(auth)

  // Generate ephemeral ECDH keypair
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const userPubKey = await crypto.subtle.importKey(
    'raw', userPubBytes, { name: 'ECDH', namedCurve: 'P-256' }, true, [],
  )
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: userPubKey }, ephemeral.privateKey, 256),
  )
  const ephemPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey))

  // PRK = HKDF(authSecret, sharedSecret, "WebPush: info\0" || userPub || senderPub, 32)
  const info1 = concat(te.encode('WebPush: info\0'), userPubBytes, ephemPubRaw)
  const prk = await hkdf(sharedSecret, authSecret, info1, 32)

  // Generate 16-byte salt
  const salt = crypto.getRandomValues(new Uint8Array(16))

  // CEK = HKDF(salt, prk, "Content-Encoding: aes128gcm\0", 16)
  const cek = await hkdf(prk, salt, te.encode('Content-Encoding: aes128gcm\0'), 16)
  // NONCE = HKDF(salt, prk, "Content-Encoding: nonce\0", 12)
  const nonce = await hkdf(prk, salt, te.encode('Content-Encoding: nonce\0'), 12)

  // Pad plaintext with \x02 marker
  const padded = new Uint8Array(plaintext.length + 1)
  padded.set(plaintext); padded[plaintext.length] = 0x02

  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt'])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, padded),
  )

  // Header: salt(16) || rs(4 = 4096) || idlen(1) || keyid(senderPub, 65 bytes)
  const rs = new Uint8Array([0, 0, 0x10, 0])
  const header = concat(salt, rs, new Uint8Array([ephemPubRaw.length]), ephemPubRaw)
  const body = concat(header, ciphertext)

  return { body, cryptoKey: b64uEncode(ephemPubRaw), salt: b64uEncode(salt) }
}

interface SubscriptionJSON {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

async function sendOne(sub: SubscriptionJSON, payload: object, vapidPub: string, vapidPriv: string, vapidSubject: string): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const jwt = await makeVapidJwt(sub.endpoint, vapidSubject, vapidPub, vapidPriv)
    const plain = te.encode(JSON.stringify(payload))
    const enc = await encryptPayload(plain, sub.keys.p256dh, sub.keys.auth, vapidPub)
    const r = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `vapid t=${jwt}, k=${vapidPub}`,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '300',
        Urgency: 'high',
      },
      body: enc.body,
    })
    return { ok: r.ok, status: r.status, error: r.ok ? undefined : await r.text() }
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
      },
    })
  }

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  }

  let sessionId: string
  try {
    const body = await req.json()
    sessionId = body?.sessionId
    if (!sessionId) throw new Error('missing sessionId')
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_body' }), { status: 400, headers: corsHeaders })
  }

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const vapidPub = Deno.env.get('VAPID_PUBLIC_KEY')!
  const vapidPriv = Deno.env.get('VAPID_PRIVATE_KEY')!
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@yeshiva.local'

  if (!url || !serviceKey || !vapidPub || !vapidPriv) {
    return new Response(JSON.stringify({ error: 'missing_env' }), { status: 500, headers: corsHeaders })
  }

  const supabase = createClient(url, serviceKey)

  // Resolve session + participants that need a push (EXPECTED_ON_CAMPUS only)
  const { data: session } = await supabase
    .from('audit_sessions').select('id,title,status').eq('id', sessionId).maybeSingle()
  if (!session) {
    return new Response(JSON.stringify({ error: 'session_not_found' }), { status: 404, headers: corsHeaders })
  }

  const { data: participants } = await supabase
    .from('audit_participants')
    .select('student_id')
    .eq('session_id', sessionId)
    .eq('expected_state', 'EXPECTED_ON_CAMPUS')

  const studentIds = (participants ?? []).map((p) => p.student_id)
  if (studentIds.length === 0) {
    return new Response(JSON.stringify({ sent: 0, failed: 0, note: 'no_targets' }), { headers: corsHeaders })
  }

  const { data: students } = await supabase
    .from('students')
    .select('id,push_token')
    .in('id', studentIds)
    .not('push_token', 'is', null)

  let sent = 0, failed = 0
  const payload = {
    type: 'AUDIT_LOCATION_REQUEST',
    sessionId,
    title: 'ביקורת פנימית פעילה',
    body:  'פתח את האפליקציה כעת כדי לשלוח מיקום',
    url:   `/student?auditSession=${sessionId}`,
  }

  for (const s of students ?? []) {
    if (!s.push_token) continue
    let sub: SubscriptionJSON
    try { sub = JSON.parse(s.push_token) } catch { failed += 1; continue }
    const r = await sendOne(sub, payload, vapidPub, vapidPriv, vapidSubject)
    if (r.ok) sent += 1
    else {
      failed += 1
      // 404/410 means expired subscription — best effort cleanup
      if (r.status === 404 || r.status === 410) {
        await supabase.from('students').update({ push_token: null }).eq('id', s.id)
      }
    }
  }

  return new Response(JSON.stringify({ sent, failed }), { headers: corsHeaders })
})
