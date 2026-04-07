// Push notification handler — loaded by the main service worker via importScripts()

self.addEventListener('push', function (event) {
  var data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) {}
  var title = data.title || 'ישיבת שבי חברון'
  var body  = data.body  || ''

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body:  body,
        icon:  '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag:   'yeshiva-approval',
        dir:   'rtl',
        lang:  'he',
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

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (clients) {
        // Clear badge
        if (self.navigator && self.navigator.clearAppBadge) {
          self.navigator.clearAppBadge()
        }
        var studentClient = clients.find(function (c) {
          return c.url && c.url.includes('/student')
        })
        if (studentClient) return studentClient.focus()
        return self.clients.openWindow('/student')
      })
  )
})
