// Push notification handler — loaded by the main service worker via importScripts()

self.addEventListener('push', function (event) {
  var data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) {}
  var title = data.title || 'ישיבת שבי חברון'
  var body  = data.body  || ''

  // Tag varies by type so audit pushes don't collapse approval pushes
  var tag = data.type === 'AUDIT_LOCATION_REQUEST' ? 'yeshiva-audit' : 'yeshiva-approval'

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body:  body,
        icon:  '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag:   tag,
        dir:   'rtl',
        lang:  'he',
        // Pass payload through so notificationclick can open the right URL
        data:  { url: data.url || '/student', type: data.type || null, sessionId: data.sessionId || null },
        // Audit pushes should reuse the active notification (less noise)
        renotify: tag === 'yeshiva-audit',
      }),
      // Set badge
      (self.navigator && self.navigator.setAppBadge)
        ? self.navigator.setAppBadge(1)
        : Promise.resolve(),
    ])
  )
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()

  var targetUrl = (event.notification.data && event.notification.data.url) || '/student'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (clients) {
        // Clear badge
        if (self.navigator && self.navigator.clearAppBadge) {
          self.navigator.clearAppBadge()
        }
        // Prefer an existing tab — navigate it to targetUrl if we have control
        for (var i = 0; i < clients.length; i++) {
          var c = clients[i]
          if (c.url && c.url.indexOf('/student') !== -1) {
            // If client supports navigation, push it to the right URL
            if ('navigate' in c) {
              return c.navigate(targetUrl).catch(function () { return c.focus() })
            }
            return c.focus()
          }
        }
        return self.clients.openWindow(targetUrl)
      })
  )
})
