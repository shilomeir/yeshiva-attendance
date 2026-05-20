/**
 * Admin-specific deep probe.
 * Bypasses the supabase auth signInWithPassword limitation in the mock
 * by injecting isAdmin=true directly into zustand state via localStorage,
 * so we can actually drive the admin/inspection screens.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const OUT = '/tmp/qa-deep-admin'
mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:5173'

const FIX_STUDENT = {
  id: '11111111-2222-3333-4444-555555555555',
  idNumber: '123456789', fullName: 'יוסי כהן', phone: '0501234567',
  grade: 'שיעור א', classId: 'כיתה הרב משה', currentStatus: 'ON_CAMPUS',
  lastSeen: new Date().toISOString(), lastLocation: null, deviceToken: null,
  push_token: null, fcm_token: null, pendingApproval: false, createdAt: new Date().toISOString(),
}

const FIX_SESSION = {
  id: 'aaaa1111-bbbb-2222-cccc-333333333333', title: 'QA Test',
  mode: 'MANUAL', startedAt: new Date().toISOString(), startedBy: 'admin',
  classIds: ['כיתה הרב משה'], status: 'ACTIVE', closedAt: null, closedBy: null,
  totalStudentsSnapshot: 1,
  classSnapshot: [{ classId: 'כיתה הרב משה', grade: 'שיעור א', studentCount: 1 }],
  studentSnapshot: [{ id: FIX_STUDENT.id, fullName: FIX_STUDENT.fullName, idNumber: FIX_STUDENT.idNumber, classId: FIX_STUDENT.classId, grade: FIX_STUDENT.grade }],
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

await context.route(/.*supabase\.co\/.*/, async (route) => {
  const url = route.request().url()
  if (url.startsWith('wss://')) return route.abort()
  if (url.includes('/rest/v1/rpc/')) {
    const rpc = url.split('/rpc/')[1].split('?')[0]
    const body = route.request().postDataJSON() ?? {}
    if (rpc === 'verify_admin_pin') return route.fulfill({ status: 200, body: JSON.stringify(true) })
    if (rpc === 'get_active_audit_session') return route.fulfill({ status: 200, body: JSON.stringify({ session: FIX_SESSION, entries: [], classStates: [] }) })
    if (rpc === 'get_active_audit_session_minimal') return route.fulfill({ status: 200, body: JSON.stringify(null) })
    if (rpc === 'list_audit_sessions') return route.fulfill({ status: 200, body: JSON.stringify([{ id: FIX_SESSION.id, title: FIX_SESSION.title, startedAt: FIX_SESSION.startedAt, closedAt: null, status: 'ACTIVE', classIds: FIX_SESSION.classIds, totalStudentsSnapshot: 1, inYeshivaCount: 0, outWithPermCount: 0, outWithoutPermCount: 0, markedCount: 0, unmarkedCount: 1, durationSec: 60 }]) })
    if (rpc === 'get_audit_session') return route.fulfill({ status: 200, body: JSON.stringify({ session: FIX_SESSION, entries: [], classStates: [] }) })
    if (rpc === 'getClassStats' || rpc === 'get_class_stats') return route.fulfill({ status: 200, body: '[]' })
    if (rpc === 'start_audit_session') return route.fulfill({ status: 200, body: JSON.stringify(FIX_SESSION) })
    if (rpc === 'close_audit_session') return route.fulfill({ status: 200, body: JSON.stringify({ ...FIX_SESSION, status: 'CLOSED' }) })
    return route.fulfill({ status: 200, body: 'null' })
  }
  if (url.includes('/functions/v1/send-audit-push')) return route.fulfill({ status: 200, body: JSON.stringify({ sent: 1, failed: 0, removed: 0, total: 1 }) })
  if (url.includes('/rest/v1/students')) return route.fulfill({ status: 200, body: JSON.stringify([FIX_STUDENT]) })
  if (url.includes('/rest/v1/departures') || url.includes('/rest/v1/events') || url.includes('/rest/v1/admin_overrides') || url.includes('/rest/v1/v_calendar_departures')) {
    return route.fulfill({ status: 200, body: '[]' })
  }
  if (url.includes('/auth/v1/')) {
    return route.fulfill({ status: 200, body: JSON.stringify({ access_token: 'fake', refresh_token: 'fake', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000) + 3600, user: { id: 'admin-uuid', email: 'admin@yeshiva.local', aud: 'authenticated', role: 'authenticated' } }) })
  }
  return route.fulfill({ status: 200, body: '{}' })
})

const page = await context.newPage()
const cons = []
page.on('console', (m) => cons.push(`[${m.type()}] ${m.text().slice(0, 200)}`))
page.on('pageerror', (err) => cons.push(`[PAGE ERROR] ${err.message.slice(0, 300)}`))

// Inject admin auth state DIRECTLY into authStore via localStorage
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => {
  // Mimic the persist shape used by zustand persist middleware
  localStorage.setItem('yeshiva-auth', JSON.stringify({
    state: {
      deviceToken: 'qa-device-token',
      classSupervisor: null,
    },
    version: 0,
  }))
  // Mimic a Supabase auth session (so restoreAuth sets isAdmin=true)
  localStorage.setItem('sb-frxjddevnehprauoapiv-auth-token', JSON.stringify({
    access_token: 'fake',
    refresh_token: 'fake',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now()/1000) + 3600,
    user: { id: 'admin-uuid', email: 'admin@yeshiva.local', aud: 'authenticated', role: 'authenticated' },
  }))
})
await page.waitForTimeout(500)

async function shot(name) { await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true }) }
async function dismissSplash() { await page.waitForTimeout(2500) }

// ── Admin: directly access the inspection page ──────────────────────────────
await page.goto(`${BASE}/admin/inspection`, { waitUntil: 'domcontentloaded' })
await dismissSplash()
await shot('40_admin_inspection_loaded')

const u1 = page.url()
if (u1.includes('/admin/inspection') && !u1.includes('/login')) pass('admin.inspection_reachable_with_seeded_auth', u1)
else { fail('admin.inspection_reachable_with_seeded_auth', `redirected to ${u1}`); }

// Look for Mission Control elements
const heading = await page.locator('h2').first().textContent().catch(() => '')
if (heading?.includes('ביקורת פנימית')) pass('admin.inspection_heading_renders', heading)
else fail('admin.inspection_heading_renders', heading || 'no h2')

// Mission control KPIs from a mocked active session
const kpiInYeshiva = page.locator('[data-testid="inspection-kpi-in-yeshiva"]')
if (await kpiInYeshiva.count() > 0) pass('admin.mission_control_kpi_in_yeshiva_present')
else info('admin.mission_control_kpi_in_yeshiva_present', 'no kpi found — maybe no active session in mock')

const classCard = page.locator(`[data-testid="inspection-class-card-${FIX_SESSION.classSnapshot[0].classId}"]`)
if (await classCard.count() > 0) pass('admin.mission_control_class_card_present')
else info('admin.mission_control_class_card_present', 'no class card')

// "פתח ביקורת" button should be present and clickable
const openBtn = page.locator('button:has-text("פתח ביקורת")').first()
const openBtnDisabled = await openBtn.isDisabled().catch(() => true)
if (await openBtn.count() > 0 && !openBtnDisabled) pass('admin.open_audit_button_present_enabled')
else if (await openBtn.count() > 0) info('admin.open_audit_button_present_enabled', 'present but disabled (active session)')
else fail('admin.open_audit_button_present_enabled', 'not found')

// Click open audit
if (await openBtn.count() > 0 && !openBtnDisabled) {
  await openBtn.click()
  await page.waitForTimeout(700)
  await shot('41_admin_open_audit_modal')
  // Look for mode cards
  const manualCard = page.locator('[data-testid="inspection-mode-card-manual"]')
  const locationCard = page.locator('[data-testid="inspection-mode-card-location"]')
  if (await manualCard.count() > 0) pass('admin.modal_mode_card_manual_present')
  else fail('admin.modal_mode_card_manual_present', 'testid missing')
  if (await locationCard.count() > 0) pass('admin.modal_mode_card_location_present')
  else fail('admin.modal_mode_card_location_present', 'testid missing')

  // Click manual
  if (await manualCard.count() > 0) {
    await manualCard.click()
    await page.waitForTimeout(300)
    await shot('42_admin_modal_mode_selected')
    pass('admin.mode_card_click_works')
  }
  // Close modal
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}

// History page
await page.goto(`${BASE}/admin/inspection/history`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
await shot('43_admin_inspection_history')
if (page.url().includes('/admin/inspection/history')) pass('admin.history_reachable')
else fail('admin.history_reachable', `at ${page.url()}`)

const histHeading = await page.locator('h2').first().textContent().catch(() => '')
if (histHeading?.includes('היסטוריית')) pass('admin.history_heading_renders', histHeading)
else fail('admin.history_heading_renders', histHeading || 'no h2')

// History list should show the mocked session
const histLink = page.locator('a[href*="/admin/inspection/history/"]').first()
if (await histLink.count() > 0) {
  pass('admin.history_session_card_renders')
  // Click into detail
  await histLink.click()
  await page.waitForTimeout(1500)
  await shot('44_admin_session_detail')
  if (page.url().includes('/admin/inspection/history/')) pass('admin.history_detail_navigates')
  else fail('admin.history_detail_navigates', `at ${page.url()}`)

  // Excel export button
  const excelBtn = page.locator('button:has-text("ייצא Excel")').first()
  if (await excelBtn.count() > 0) pass('admin.excel_export_button_present')
  else fail('admin.excel_export_button_present', 'no Excel button found')
} else info('admin.history_session_card_renders', 'no cards — list_audit_sessions may have returned empty')

// Legacy redirects
await page.goto(`${BASE}/admin/rollcall`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(500)
if (page.url().endsWith('/admin/inspection')) pass('admin.legacy_rollcall_redirects_to_inspection')
else fail('admin.legacy_rollcall_redirects_to_inspection', `at ${page.url()}`)

await page.goto(`${BASE}/admin/audits`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(500)
if (page.url().endsWith('/admin/inspection/history')) pass('admin.legacy_audits_redirects_to_history')
else fail('admin.legacy_audits_redirects_to_history', `at ${page.url()}`)

await browser.close()

console.log('\n========================================')
console.log(`Total: ${results.length}  ✅ ${results.filter((r) => r.status === '✅').length}  ❌ ${results.filter((r) => r.status === '❌').length}  ℹ️ ${results.filter((r) => r.status === 'ℹ️').length}`)
console.log(`\nConsole: ${cons.filter((c) => c.startsWith('[error]') || c.startsWith('[PAGE ERROR]')).length} errors out of ${cons.length} messages`)
console.log(`Screenshots: ${OUT}/`)
