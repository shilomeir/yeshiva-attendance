/// <reference lib="WebWorker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

// Clean up outdated caches from previous SW versions
cleanupOutdatedCaches()

// Precache and route all assets injected by VitePWA
precacheAndRoute(self.__WB_MANIFEST)

// ── Push Notifications ──────────────────────────────────────────────────────
// Master plan R-12: payload discrimination on data.kind. The audit-mode
// LOCATION push uses kind: 'INSPECTION_LOCATION' with the session id;
// everything else (approval, generic broadcast) falls through to the
// existing default handler.

type AuditPushPayload = {
  kind: 'INSPECTION_LOCATION'
  sessionId: string
  title?: string
  body?: string
}
type DefaultPushPayload = { kind?: undefined; title?: string; body?: string }

self.addEventListener('push', (event: PushEvent) => {
  const data = (event.data?.json() ?? {}) as AuditPushPayload | DefaultPushPayload

  const nav = self.navigator as Navigator & {
    setAppBadge?: (count?: number) => Promise<void>
  }

  if (data.kind === 'INSPECTION_LOCATION') {
    // Higher urgency notification — user must tap to share GPS in time.
    // tag uses the session id so a second push for the same session
    // replaces the first instead of stacking.
    event.waitUntil(
      Promise.all([
        self.registration.showNotification(data.title ?? 'ביקורת פנימית — נדרש מיקום', {
          body: data.body ?? 'פתח את האפליקציה ושתף מיקום',
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag: `inspection-${data.sessionId}`,
          dir: 'rtl',
          lang: 'he',
          requireInteraction: true,
          data: { kind: data.kind, sessionId: data.sessionId },
        } as NotificationOptions),
        nav.setAppBadge ? nav.setAppBadge(1) : Promise.resolve(),
      ])
    )
    return
  }

  // Default: existing approval/broadcast push behaviour preserved verbatim
  // so the admin approval flow doesn't regress.
  const title = data.title ?? 'ישיבת שבי חברון'
  const body = data.body ?? ''
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: 'yeshiva-approval',
        dir: 'rtl',
        lang: 'he',
      } as NotificationOptions),
      nav.setAppBadge ? nav.setAppBadge(1) : Promise.resolve(),
    ])
  )
})

// ── Notification Click ──────────────────────────────────────────────────────

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()

  const nav = self.navigator as Navigator & {
    clearAppBadge?: () => Promise<void>
  }
  // The audit push stores { kind, sessionId } in notification.data so we
  // can deep-link the student straight to /student where the GPS-share
  // banner will surface for the active session.
  const notifData = (event.notification.data ?? {}) as { kind?: string; sessionId?: string }
  const targetUrl = notifData.kind === 'INSPECTION_LOCATION' ? '/student' : '/student'

  event.waitUntil(
    (async () => {
      if (nav.clearAppBadge) await nav.clearAppBadge()

      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const studentClient = clients.find((c) => c.url.includes('/student'))
      if (studentClient) {
        await studentClient.focus()
      } else {
        await self.clients.openWindow(targetUrl)
      }
    })()
  )
})
