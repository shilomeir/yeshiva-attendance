// Deprecated. The Capacitor APK + FCM tooling that drove this edge function
// was removed. No client in the current codebase calls it. Anything that
// still tries gets a 410 Gone so the operator can spot the call and remove it.
//
// Audit-mode GPS now flows through:
//   - send-audit-push (server-side push fan-out to all students in a session)
//   - submit-audit-gps (student → server proxy for submit_student_audit_gps)
//
// Kept as a 410 stub instead of fully removed because Supabase MCP doesn't
// expose a function-delete endpoint and a stub is functionally equivalent.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  return new Response(
    JSON.stringify({
      error: 'GONE',
      message: 'broadcast-location-request was deprecated when the Capacitor APK was removed. Use the audit-mode GPS banner in the student app or the send-audit-push edge function.',
    }),
    { status: 410, headers: { ...CORS, 'Content-Type': 'application/json' } },
  )
})
