import { Capacitor } from '@capacitor/core'
import { api } from '@/lib/api'

/**
 * Registers this device for FCM push notifications and saves the token
 * to Supabase so the admin's Edge Function can reach this device.
 *
 * Called automatically after a student logs in.
 * Does nothing on web/PWA — only active in the native Android APK.
 */
export async function registerPushNotifications(studentId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')

    // Request permission (shows system dialog first time)
    const result = await PushNotifications.requestPermissions()
    if (result.receive !== 'granted') {
      console.warn('[Push] Notification permission not granted')
      return
    }

    // Register with FCM — triggers the 'registration' event below
    await PushNotifications.register()

    // On successful registration, save token to Supabase
    PushNotifications.addListener('registration', async (token) => {
      console.log('[Push] FCM token received, saving to Supabase')
      await api.updateStudentFcmToken(studentId, token.value)
    })

    PushNotifications.addListener('registrationError', (err) => {
      console.error('[Push] Registration error:', err.error)
    })

    // Handle push notification received while app is OPEN or BACKGROUNDED
    PushNotifications.addListener('pushNotificationReceived', async (notification) => {
      if (notification.data?.type === 'location_request') {
        console.log('[Push] Location request received, getting GPS...')
        await sendLocationToAdmin(studentId)
      }
    })

    // Handle tap on a notification while app was KILLED
    PushNotifications.addListener('pushNotificationActionPerformed', async (action) => {
      if (action.notification.data?.type === 'location_request') {
        console.log('[Push] Location request notification tapped, sending GPS...')
        await sendLocationToAdmin(studentId)
      }
    })
  } catch (err) {
    console.error('[Push] Setup failed:', err)
  }
}

/** Gets current GPS and sends it to Supabase */
async function sendLocationToAdmin(studentId: string): Promise<void> {
  const { getCurrentPosition, isGPSResult } = await import('@/lib/location/gps')
  const result = await getCurrentPosition()
  if (isGPSResult(result)) {
    await api.updateStudentLocation(studentId, result.lat, result.lng)
    console.log('[Push] Location sent:', result.lat, result.lng)
  }
}
