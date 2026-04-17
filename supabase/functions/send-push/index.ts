import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// Pure Web Crypto implementation — no npm dependencies, works in Deno Edge Runtime.

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

// ─── HKDF (extract + expand in one call via Web Crypto) ──────────────────────

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
    exp: Math.floor(Date.now() / 1000) + 43_200, // 12 h
    sub: subject,
  })))

  const sigInput = te.encode(`${header}.${payload}`)

  // The VAPID public key is the uncompressed P-256 point (65 bytes: 0x04 || x || y)
  const pubBytes = b64uDecode(vapidPublicKeyB64u)
  const x = pubBytes.slice(1, 33)
  const y = pubBytes.slice(33, 65)

  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: b64uEncode(x),
    y: b64uEncode(y),
    d: vapidPrivateKeyB64u, // raw 32-byte scalar, already base64url
    key_ops: ['sign'],
  }
  const ecKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, ecKey, sigInput)

  return `${header}.${payload}.${b64uEncode(sig)}`
}

// ─── Web Push message encryption (RFC 8291 + RFC 8188 aes128gcm) ─────────────

async function encryptWebPush(
  plaintext: string,
  receiverP256dhB64u: string,
  authSecretB64u: string,
): Promise<{ body: Uint8Array }> {
  const receiverPubBytes = b64uDecode(receiverP256dhB64u)
  const authSecret = b64uDecode(authSecretB64u)
  const plaintextBytes = te.encode(plaintext)

  // Generate ephemeral sender key pair
  const senderKP = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )
  const senderPubRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', senderKP.publicKey), // 65 bytes uncompressed
  )

  // Import receiver's public key for ECDH
  const receiverKey = await crypto.subtle.importKey(
    'raw',
    receiverPubBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )

  // ECDH shared secret
  const ecdhBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiverKey },
    senderKP.privateKey,
    256,
  )
  const ecdhSecret = new Uint8Array(ecdhBits)

  // RFC 8291 §3.3 — combine ECDH secret with auth secret
  const keyInfo = concat(te.encode('WebPush: info\x00'), receiverPubBytes, senderPubRaw)
  const ikmCombined = await hkdf(ecdhSecret, authSecret, keyInfo, 32)

  // RFC 8188 §2.1 — derive CEK and nonce
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(ikmCombined, salt, te.encode('Content-Encoding: aes128gcm\x00'), 16)
  const nonce = await hkdf(ikmCombined, salt, te.encode('Content-Encoding: nonce\x00'), 12)

  // Pad: append 0x02 delimiter (RFC 8291 §4, minimal padding)
  const padded = concat(plaintextBytes, new Uint8Array([2]))

  // AES-128-GCM encrypt
  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt'])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, cekKey, padded),
  )

  // Build aes128gcm record: salt || rs (4 BE) || idlen (1) || keyid || ciphertext
  const rs = new Uint8Array(4)
  new DataView(rs.buffer).setUint32(0, 4096, false)
  const body = concat(salt, rs, new Uint8Array([senderPubRaw.length]), senderPubRaw, ciphertext)

  return { body }
}

// ─── Edge Function entry point ────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@yeshiva.example.com'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS })
  }

  try {
    const raw = await req.json() as {
      subscription: string | { endpoint: string; keys: { p256dh: string; auth: string } }
      title: string
      body: string
    }

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      throw new Error('VAPID keys not configured in Edge Function secrets')
    }

    const sub = typeof raw.subscription === 'string'
      ? JSON.parse(raw.subscription)
      : raw.subscription

    const { endpoint, keys: { p256dh, auth } } = sub

    const payload = JSON.stringify({ title: raw.title, body: raw.body })
    const { body: encryptedBody } = await encryptWebPush(payload, p256dh, auth)
    const jwt = await makeVapidJwt(endpoint, VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

    const pushResp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`,
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'TTL': '86400',
        'Urgency': 'normal',
      },
      body: encryptedBody,
    })

    if (!pushResp.ok) {
      const text = await pushResp.text()
      // Return 200 so the caller can read the actual error details.
      // 410 = subscription expired/unregistered → caller should remove the token.
      return new Response(
        JSON.stringify({
          sent: false,
          gone: pushResp.status === 410 || pushResp.status === 404,
          error: `Push service ${pushResp.status}: ${text}`,
        }),
        { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
      )
    }

    return new Response(JSON.stringify({ sent: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[send-push]', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }
})
