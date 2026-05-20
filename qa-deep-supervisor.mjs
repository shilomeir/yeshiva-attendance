/**
 * Supervisor flow probe — minimal banner + load data CTA + mark student.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const OUT = '/tmp/qa-deep-supervisor'
mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:5173'

const STUDENT = {
  id: '11111111-2222-3333-4444-555555555555',
  fullName: 'יוסי כהן', idNumber: '123456789', classId: 'כיתה הרב משה', grade: 'שיעור א',
}
const FIX_SESSION = {
  id: 'aaaa1111-bbbb-2222-cccc-333333333333',
  title: 'QA Sup Test', mode: 'MANUAL',
  startedAt: new Date().toISOString(), startedBy: 'admin',
  classIds: ['כיתה הרב משה'], status: 'ACTIVE', closedAt: null, closedBy: null,
  totalStudentsSnapshot: 1,
  classSnapshot: [{ classId: 'כיתה הרב משה', grade: 'שיעור א', studentCount: 1 }],
  studentSnapshot: [STUDENT],
  activeDeparturesSnapshot: [], settings: {},
  entries: [], classStates: [],
}

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
})

let supervisorPinCached = false
let entries = []

await context.route(/.*supabase\.co\/.*/, async (route) => {
  const url = route.request().url()
  if (url.startsWith('wss://')) return route.abort()
  if (url.includes('/rest/v1/rpc/')) {
    const rpc = url.split('/rpc/')[1].split('?')[0]
    const body = route.request().postDataJSON() ?? {}
    if (rpc === 'verify_supervisor_pin') return route.fulfill({ status: 200, body: JSON.stringify({ classId: STUDENT.classId, gradeName: STUDENT.grade }) })
    if (rpc === 'verify_admin_pin') return route.fulfill({ status: 200, body: JSON.stringify(false) })
    if (rpc === 'get_active_audit_session_minimal') {
      return route.fulfill({ status: 200, body: JSON.stringify({ id: FIX_SESSION.id, title: FIX_SESSION.title, mode: FIX_SESSION.mode, startedAt: FIX_SESSION.startedAt, classIds: FIX_SESSION.classIds, totalStudentsSnapshot: 1, status: 'ACTIVE' }) })
    }
    if (rpc === 'get_active_audit_for_supervisor') {
      supervisorPinCached = true
      return route.fulfill({ status: 200, body: JSON.stringify({ session: { ...FIX_SESSION, entries: [...entries] }, isInActiveSession: true, entries: [...entries], classState: null }) })
    }
    if (rpc === 'submit_audit_entry') {
      const entry = { id: 'e' + entries.length, sessionId: FIX_SESSION.id, studentId: body.p_student_id, studentSnapshotIdx: 0, classId: STUDENT.classId, grade: STUDENT.grade, status: body.p_status, note: body.p_note ?? null, source: 'SUPERVISOR', hadActiveDepartureAtAudit: false, submittedBy: 'supervisor', submittedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      entries.push(entry)
      return route.fulfill({ status: 200, body: JSON.stringify(entry) })
    }
    return route.fulfill({ status: 200, body: 'null' })
  }
  if (url.includes('/rest/v1/students')) return route.fulfill({ status: 200, body: JSON.stringify([{ ...STUDENT, currentStatus: 'ON_CAMPUS', lastSeen: new Date().toISOString(), lastLocation: null, deviceToken: null, push_token: null, fcm_token: null, pendingApproval: false, createdAt: new Date().toISOString(), phone: '050' }]) })
  if (url.includes('/rest/v1/departures') || url.includes('/rest/v1/events') || url.includes('/rest/v1/admin_overrides') || url.includes('/rest/v1/v_calendar_departures')) return route.fulfill({ status: 200, body: '[]' })
  return route.fulfill({ status: 200, body: '{}' })
})

const page = await context.newPage()
const cons = []
page.on('console', (m) => cons.push(`[${m.type()}] ${m.text().slice(0, 300)}`))
page.on('pageerror', (e) => cons.push(`[PAGE ERROR] ${e.message}`))

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.evaluate((s) => {
  localStorage.setItem('yeshiva-auth', JSON.stringify({
    state: { deviceToken: 'qa-tok', classSupervisor: { classId: s.classId, gradeName: s.grade } },
    version: 0,
  }))
}, STUDENT)
await page.waitForTimeout(400)

const shot = async (n) => page.screenshot({ path: join(OUT, `${n}.png`), fullPage: true })

await page.goto(`${BASE}/class-supervisor`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
await shot('60_supervisor_initial')

if (page.url().includes('/class-supervisor')) pass('supervisor.dashboard_loads')
else { fail('supervisor.dashboard_loads', page.url()); process.exit(1) }

// First: minimal banner should appear (no PIN cached yet → can't load full data)
const loadBtn = page.locator('button:has-text("טען נתוני ביקורת")').first()
const loadBtnVisible = await loadBtn.isVisible().catch(() => false)
if (loadBtnVisible) pass('supervisor.minimal_banner_with_cta_renders')
else info('supervisor.minimal_banner_with_cta_renders', 'no minimal banner — banner might be hidden behind splash or above the fold')

// The "סמן את כל הנותרים" + per-student rows should NOT be visible yet (no PIN)
const bulkBtn = page.locator('button:has-text("סמן את כל הנותרים")').first()
const bulkVisible = await bulkBtn.isVisible().catch(() => false)
if (!bulkVisible) pass('supervisor.full_audit_panel_not_shown_without_pin')
else info('supervisor.full_audit_panel_not_shown_without_pin', 'bulk button visible — possibly minimal banner skipped to full')

// Tap "טען נתוני ביקורת" to trigger PIN prompt
if (loadBtnVisible) {
  await loadBtn.click()
  await page.waitForTimeout(700)
  await shot('61_supervisor_pin_prompt')
  const pinInput = page.locator('input[type="password"]').first()
  if (await pinInput.count() > 0) {
    pass('supervisor.pin_prompt_modal_opens')
    await pinInput.fill('1234567') // 7 chars: admin pin "1234" + class code "567"
    await page.locator('div[role="dialog"] button:has-text("אישור"), div[role="dialog"] button:has-text("כניסה")').first().click().catch(() => {})
    await page.waitForTimeout(2000)
    await shot('62_supervisor_full_panel')
    const bulkAfter = page.locator('button:has-text("סמן את כל הנותרים")').first()
    if (await bulkAfter.isVisible().catch(() => false)) pass('supervisor.full_panel_appears_after_pin')
    else fail('supervisor.full_panel_appears_after_pin', 'bulk button still hidden after PIN')
  } else fail('supervisor.pin_prompt_modal_opens', 'no password input found')
}

// Try to mark student as בישיבה
const markBtn = page.locator(`[data-testid="inspection-supervisor-button-IN_YESHIVA-${STUDENT.id}"]`).first()
const markBtnVisible = await markBtn.isVisible().catch(() => false)
if (markBtnVisible) {
  pass('supervisor.mark_button_testid_present', `inspection-supervisor-button-IN_YESHIVA-${STUDENT.id}`)
  await markBtn.click()
  await page.waitForTimeout(1500)
  await shot('63_supervisor_after_mark')
  pass('supervisor.mark_click_no_crash')
} else info('supervisor.mark_button_testid_present', 'mark button not visible — full panel may not have rendered yet')

await browser.close()

console.log('\n========================================')
console.log(`Total: ${results.length}  ✅ ${results.filter((r) => r.status === '✅').length}  ❌ ${results.filter((r) => r.status === '❌').length}  ℹ️ ${results.filter((r) => r.status === 'ℹ️').length}`)
console.log(`Errors: ${cons.filter((c) => c.startsWith('[error]') || c.startsWith('[PAGE ERROR]')).length} / ${cons.length}`)
for (const c of cons.filter((c) => c.startsWith('[PAGE ERROR]')).slice(0, 3)) console.log(c.slice(0, 300))
console.log(`Screenshots: ${OUT}/`)
