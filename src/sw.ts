/// <reference lib="WebWorker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

// Clean up outdated caches from previous SW versions
cleanupOutdatedCaches()

// Precache and route all assets injected by VitePWA
precacheAndRoute(self.__WB_MANIFEST)

// ── Push Notifications ──────────────────────────────────────────────────────

self.addEventListener('push', (event: PushEvent) => {
  const data = event.data?.json() as { title?: string; body?: string } | undefined
  const title = data?.title ?? 'ישיבת שבי חברון'
  const body = data?.body ?? ''

  const nav = self.navigator as Navigator & {
    setAppBadge?: (count?: number) => Promise<void>
  }

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

  event.waitUntil(
    (async () => {
      if (nav.clearAppBadge) await nav.clearAppBadge()

      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const studentClient = clients.find((c) => c.url.includes('/student'))
      if (studentClient) {
        await studentClient.focus()
      } else {
        await self.clients.openWindow('/student')
      }
    })()
  )
})
