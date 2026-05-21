// Master plan B-26: edge-function-as-proxy for student GPS submission.
//
// The previous direct RPC path (anon → submit_student_audit_gps) worked
// because the RPC validates the student via deviceToken. This Edge Function
// adds a server-side proxy layer in front of the RPC so we have a single
// place to:
//   - rate-limit per-student (future)
//   - sanity-check GPS coordinates against geofences (future)
//   - log GPS submission attempts independently of audit_entries
//
// For v1 the function is a thin pass-through: validate inputs, call the
// existing submit_student_audit_gps RPC with the service-role client (so
// even a future tightening of the RPC's anon grant doesn't break this
// path), and return the result.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.0'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS })
  }

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error('Supabase service-role credentials missing')
    }
    const body = await req.json() as {
      sessionId: string
      studentId: string
      deviceToken: string
      gpsLat: number
      gpsLng: number
      accuracyM?: number | null
      gpsStatus?: string
    }

    // Minimal shape validation. Detailed validation is done by the RPC.
    if (!body.sessionId || !body.studentId || !body.deviceToken) {
      return new Response(JSON.stringify({ error: 'sessionId, studentId, deviceToken required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }
    if (typeof body.gpsLat !== 'number' || typeof body.gpsLng !== 'number') {
      return new Response(JSON.stringify({ error: 'gpsLat and gpsLng must be numbers' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }
    // Reject obviously bogus coordinates so junk data doesn't end up in audit_entries.
    if (body.gpsLat < -90 || body.gpsLat > 90 || body.gpsLng < -180 || body.gpsLng > 180) {
      return new Response(JSON.stringify({ error: 'INVALID_COORDINATES' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    const { data, error } = await supabase.rpc('submit_student_audit_gps', {
      p_session_id: body.sessionId,
      p_student_id: body.studentId,
      p_device_token: body.deviceToken,
      p_gps_lat: body.gpsLat,
      p_gps_lng: body.gpsLng,
      p_accuracy_m: body.accuracyM ?? null,
      p_gps_status: body.gpsStatus ?? 'OK',
    })
    if (error) throw error
    return new Response(JSON.stringify(data), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[submit-audit-gps]', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }
})
