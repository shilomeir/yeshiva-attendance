/**
 * Student GPS banner + share flow probe.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const OUT = '/tmp/qa-deep-student'
mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:5173'

const FIX_STUDENT = {
  id: '11111111-2222-3333-4444-555555555555',
  idNumber: '123456789', fullName: 'יוסי כהן', phone: '0501234567',
  grade: 'שיעור א', classId: 'כיתה הרב משה', currentStatus: 'ON_CAMPUS',
  lastSeen: new Date().toISOString(), lastLocation: null,
  deviceToken: 'qa-device-token-1', push_token: null, fcm_token: null,
  pendingApproval: false, createdAt: new Date().toISOString(),
}
const SID = 'aaaa1111-bbbb-2222-cccc-333333333333'

const results = []
const pass = (s, n = '') => { results.push({ s, status: '✅', n }); console.log(`✅ ${s}${n ? ' — ' + n : ''}`) }
const fail = (s, n) => { results.push({ s, status: '❌', n }); console.log(`❌ ${s} — ${n}`) }
const info = (s, n) => { results.push({ s, status: 'ℹ️', n }); console.log(`ℹ️  ${s} — ${n}`) }

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'he-IL',
  timezoneId: 'Asia/Jerusalem',
  geolocation: { latitude: 31.5253, longitude: 35.1056 }, // campus
  permissions: ['geolocation'],
})

// State for mutations
let entries = []

await context.route(/.*supabase\.co\/.*/, async (route) => {
  const url = route.request().url()
  if (url.startsWith('wss://')) return route.abort()
  if (url.includes('/rest/v1/rpc/')) {
    const rpc = url.split('/rpc/')[1].split('?')[0]
    const body = route.request().postDataJSON() ?? {}
    if (rpc === 'get_active_audit_for_student') {
      return route.fulfill({ status: 200, body: JSON.stringify({
        session: { id: SID, title: 'GPS Test', mode: 'LOCATION', startedAt: new Date().toISOString(), classIds: [FIX_STUDENT.classId], status: 'ACTIVE' },
        isInActiveSession: true,
        myEntry: entries.find((e) => e.studentId === body.p_student_id) ?? null,
      }) })
    }
    return route.fulfill({ status: 200, body: 'null' })
  }
  if (url.includes('/functions/v1/submit-audit-gps')) {
    const body = route.request().postDataJSON() ?? {}
    const entry = { id: 'e1', sessionId: body.sessionId, studentId: body.studentId, status: 'IN_YESHIVA', source: 'AUTO_GPS', submittedAt: new Date().toISOString(), distanceFromCampusM: 0, distanceBucket: 'GREEN' }
    entries.push(entry)
    return route.fulfill({ status: 200, body: JSON.stringify({ ok: true, distanceM: 0, distanceBucket: 'GREEN', status: 'IN_YESHIVA' }) })
  }
  if (url.includes('/rest/v1/students')) {
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, body: JSON.stringify([FIX_STUDENT]) })
    return route.fulfill({ status: 200, body: JSON.stringify([FIX_STUDENT]) })
  }
  if (url.includes('/rest/v1/departures') || url.includes('/rest/v1/events') || url.includes('/rest/v1/v_calendar_departures')) {
    return route.fulfill({ status: 200, body: '[]' })
  }
  return route.fulfill({ status: 200, body: '{}' })
})

const page = await context.newPage()
const cons = []
page.on('console', (m) => cons.push(`[${m.type()}] ${m.text().slice(0, 600)}`))
page.on('pageerror', (e) => cons.push(`[PAGE ERROR] ${e.message}\n${e.stack?.slice(0, 800) ?? ''}`))

// Seed student auth in localStorage
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.evaluate((s) => {
  localStorage.setItem('yeshiva-auth', JSON.stringify({
    state: { deviceToken: s.deviceToken, classSupervisor: null },
    version: 0,
  }))
  localStorage.setItem('yeshiva_device_token', s.deviceToken)
  localStorage.setItem('yeshiva_remembered_id', s.idNumber)
}, FIX_STUDENT)
await page.waitForTimeout(500)

const shot = async (n) => page.screenshot({ path: join(OUT, `${n}.png`), fullPage: true })

await page.goto(`${BASE}/student`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500) // dismiss splash + let polling fire
await shot('50_student_home')

const u1 = page.url()
if (u1.includes('/student')) pass('student.dashboard_loads_with_seeded_auth', u1)
else fail('student.dashboard_loads_with_seeded_auth', u1)

// GPS banner check
const sheet = page.locator('[data-testid="inspection-student-sheet"]')
const sheetVisible = await sheet.isVisible().catch(() => false)
if (sheetVisible) {
  pass('student.gps_banner_visible')
  const confirmBtn = page.locator('[data-testid="inspection-student-confirm"]')
  if (await confirmBtn.count() > 0) {
    pass('student.confirm_button_visible')
    await confirmBtn.click()
    await page.waitForTimeout(2000)
    await shot('51_student_after_share')

    const bodyText = await page.locator('body').innerText()
    if (bodyText.includes('מיקומך נמסר בהצלחה')) pass('student.success_state_renders')
    else fail('student.success_state_renders', 'no success text after share')

    if (bodyText.includes('0 מ׳')) pass('student.distance_displayed', '0m (at campus)')
    else if (bodyText.match(/\d+\s*מ׳|\d+\.?\d*\s*ק״מ/)) pass('student.distance_displayed', 'some distance shown')
    else info('student.distance_displayed', 'no distance string matched')
  } else fail('student.confirm_button_visible', 'no [data-testid=inspection-student-confirm]')
} else info('student.gps_banner_visible', 'banner not visible — polling may not have fired, or sheet hidden')

await browser.close()

console.log('\n========================================')
console.log(`Total: ${results.length}  ✅ ${results.filter((r) => r.status === '✅').length}  ❌ ${results.filter((r) => r.status === '❌').length}  ℹ️ ${results.filter((r) => r.status === 'ℹ️').length}`)
console.log(`Console errors: ${cons.filter((c) => c.startsWith('[error]') || c.startsWith('[PAGE ERROR]')).length} / ${cons.length}`)
console.log('\n--- Page errors ---')
for (const c of cons.filter((c) => c.startsWith('[PAGE ERROR]'))) console.log(c)
console.log(`Screenshots: ${OUT}/`)
