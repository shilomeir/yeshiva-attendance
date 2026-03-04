export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false

  if (Notification.permission === 'granted') return true

  const permission = await Notification.requestPermission()
  return permission === 'granted'
}

export async function scheduleReturnNotification(
  studentName: string,
  expectedReturnTime: Date
): Promise<void> {
  const hasPermission = await requestNotificationPermission()
  if (!hasPermission) return

  const now = new Date()
  const delay = expectedReturnTime.getTime() - now.getTime()

  if (delay <= 0) return

  const timeStr = expectedReturnTime.toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  })

  setTimeout(() => {
    try {
      new Notification('תזכורת חזרה - ישיבת שבי חברון', {
        body: `${studentName} - זמן החזרה הצפוי הוא ${timeStr}. האם חזרת?`,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: `return-${studentName}`,
        requireInteraction: true,
        dir: 'rtl',
        lang: 'he',
      })
    } catch (e) {
      console.warn('Could not show notification:', e)
    }
  }, delay)
}

// iOS fallback using setTimeout with an alert (since iOS doesn't support web notifications well)
export function scheduleReturnFallback(expectedReturnTime: Date): void {
  const now = new Date()
  const delay = expectedReturnTime.getTime() - now.getTime()

  if (delay <= 0) return

  setTimeout(() => {
    const timeStr = expectedReturnTime.toLocaleTimeString('he-IL', {
      hour: '2-digit',
      minute: '2-digit',
    })
    // Store in localStorage for the app to check on next open
    localStorage.setItem(
      'pending_return_reminder',
      JSON.stringify({ time: expectedReturnTime.toISOString(), shown: false })
    )
    console.log(`Return reminder triggered for ${timeStr}`)
  }, delay)
}

export async function scheduleReturn(
  studentName: string,
  expectedReturnIso: string
): Promise<void> {
  const expectedTime = new Date(expectedReturnIso)

  // Try web notifications first
  try {
    await scheduleReturnNotification(studentName, expectedTime)
  } catch {
    // iOS fallback
    scheduleReturnFallback(expectedTime)
  }
}
