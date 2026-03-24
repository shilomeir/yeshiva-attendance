import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Supabase Edge Function: broadcast-location-request
 *
 * Called by the admin's RollCall page to send an FCM silent push notification
 * to every student device. This wakes up the Android APK even when it's been
 * killed, so it can respond with its GPS location.
 *
 * Required Supabase secrets (set via Dashboard → Edge Functions → Secrets):
 *   SUPABASE_URL           — auto-provided by Supabase
 *   SUPABASE_SERVICE_ROLE_KEY — auto-provided by Supabase
 *   FCM_SERVER_KEY         — from Firebase Console → Project Settings → Cloud Messaging → Server key
 */
Deno.serve(async (_req: Request) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const fcmServerKey = Deno.env.get('FCM_SERVER_KEY')

    if (!fcmServerKey) {
      return new Response(
        JSON.stringify({ error: 'FCM_SERVER_KEY secret not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Get all students that have registered their device for push notifications
    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const { data: students, error } = await supabase
      .from('students')
      .select('fcm_token')
      .not('fcm_token', 'is', null)

    if (error) throw error

    const tokens = (students ?? [])
      .map((s: { fcm_token: string }) => s.fcm_token)
      .filter(Boolean)

    if (tokens.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, message: 'No registered devices' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Send a silent data-only push to all tokens via FCM Legacy API
    // "data" messages wake the app in the background without showing a notification
    const fcmPayload = {
      registration_ids: tokens,
      data: {
        type: 'location_request',
        timestamp: new Date().toISOString(),
      },
      priority: 'high',
      content_available: true, // iOS background wake-up hint
    }

    const fcmResponse = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        Authorization: `key=${fcmServerKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(fcmPayload),
    })

    const fcmResult = await fcmResponse.json()

    return new Response(
      JSON.stringify({ sent: tokens.length, fcm: fcmResult }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
