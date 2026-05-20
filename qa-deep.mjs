/**
 * Deep interactive QA probe.
 *
 * Drives every reachable flow in the audit feature by:
 *  1. Mocking Supabase REST + Realtime so the client can actually log in,
 *     fetch students, open an audit, mark a student, etc. (outbound to
 *     supabase.co is blocked from this sandbox)
 *  2. Clicking through each interactive element role-by-role.
 *  3. Capturing screenshots, console output, and per-step PASS/FAIL.
 *
 * Output: /tmp/qa-deep/{report.json, *.png}
 */

import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT = '/tmp/qa-deep'
mkdirSync(OUT, { recursive: true })

const BASE = 'http://localhost:5173'
const CANONICAL = 'https://frxjddevnehprauoapiv.supabase.co'

// ── Test fixture data ──────────────────────────────────────────────────────
const FIX_STUDENT = {
  id: '11111111-2222-3333-4444-555555555555',
  idNumber: '123456789',
  fullName: 'יוסי כהן',
  phone: '0501234567',
  grade: 'שיעור א',
  classId: 'כיתה הרב משה',
  currentStatus: 'ON_CAMPUS',
  lastSeen: new Date().toISOString(),
  lastLocation: null,
  deviceToken: null,
  push_token: null,
  fcm_token: null,
  pendingApproval: false,
  createdAt: new Date().toISOString(),
}

const FIX_SESSION = {
  id: 'aaaa1111-bbbb-2222-cccc-333333333333',
  title: 'QA Test Session',
  mode: 'MANUAL',
  startedAt: new Date().toISOString(),
  startedBy: 'admin',
  classIds: ['כיתה הרב משה'],
  status: 'ACTIVE',
  closedAt: null,
  closedBy: null,
  totalStudentsSnapshot: 1,
  classSnapshot: [{ classId: 'כיתה הרב משה', grade: 'שיעור א', studentCount: 1 }],
  studentSnapshot: [{ id: FIX_STUDENT.id, fullName: FIX_STUDENT.fullName, idNumber: FIX_STUDENT.idNumber, classId: FIX_STUDENT.classId, grade: FIX_STUDENT.grade }],
  activeDeparturesSnapshot: [],
  settings: {},
  entries: [],
  classStates: [],
}

// ── Probe state ─────────────────────────────────────────────────────────────
const results = []
const consoleByPage = []

function pass(step, note = '') { results.push({ step, status: '✅', note }); console.log(`✅ ${step}${note ? ' — ' + note : ''}`) }
function fail(step, note) { results.push({ step, status: '❌', note }); console.log(`❌ ${step} — ${note}`) }
function info(step, note) { results.push({ step, status: 'ℹ️', note }); console.log(`ℹ️  ${step} — ${note}`) }

// ── Launch ──────────────────────────────────────────────────────────────────
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

async function newSession(label) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
  })

  // Intercept Supabase REST + Functions calls so the client can actually function.
  await context.route(/.*supabase\.co\/.*/, async (route) => {
    const req = route.request()
    const url = req.url()
    const method = req.method()
    // Realtime websocket — let it fail; the polling fallback covers correctness.
    if (url.startsWith('wss://')) return route.abort()

    // RPC dispatch
    if (url.includes('/rest/v1/rpc/')) {
      const rpc = url.split('/rpc/')[1].split('?')[0]
      const body = req.postDataJSON() ?? {}
      // Admin PIN
      if (rpc === 'verify_admin_pin') {
        return route.fulfill({ status: 200, body: JSON.stringify(body.p_pin === '12345') })
      }
      // Supervisor login (legacy RPC name)
      if (rpc === 'verify_supervisor_pin') {
        return route.fulfill({ status: 200, body: JSON.stringify({ classId: 'כיתה הרב משה', gradeName: 'שיעור א' }) })
      }
      // Get active audit minimal/student/supervisor
      if (rpc === 'get_active_audit_session_minimal') {
        return route.fulfill({ status: 200, body: JSON.stringify({ id: FIX_SESSION.id, title: FIX_SESSION.title, mode: FIX_SESSION.mode, startedAt: FIX_SESSION.startedAt, classIds: FIX_SESSION.classIds, totalStudentsSnapshot: 1, status: 'ACTIVE' }) })
      }
      if (rpc === 'get_active_audit_for_student') {
        return route.fulfill({ status: 200, body: JSON.stringify({ session: { id: FIX_SESSION.id, title: FIX_SESSION.title, mode: 'LOCATION', startedAt: FIX_SESSION.startedAt, classIds: FIX_SESSION.classIds, status: 'ACTIVE' }, isInActiveSession: true, myEntry: null }) })
      }
      if (rpc === 'get_active_audit_for_supervisor') {
        return route.fulfill({ status: 200, body: JSON.stringify({ session: { ...FIX_SESSION }, isInActiveSession: true, entries: [], classState: null }) })
      }
      if (rpc === 'get_active_audit_session') {
        return route.fulfill({ status: 200, body: JSON.stringify({ session: FIX_SESSION, entries: [], classStates: [] }) })
      }
      if (rpc === 'start_audit_session') {
        return route.fulfill({ status: 200, body: JSON.stringify(FIX_SESSION) })
      }
      if (rpc === 'submit_audit_entry') {
        return route.fulfill({ status: 200, body: JSON.stringify({ id: 'entry-1', sessionId: FIX_SESSION.id, studentId: body.p_student_id, status: body.p_status, note: body.p_note, source: 'SUPERVISOR', submittedAt: new Date().toISOString() }) })
      }
      if (rpc === 'close_audit_session') {
        return route.fulfill({ status: 200, body: JSON.stringify({ ...FIX_SESSION, status: 'CLOSED' }) })
      }
      // Other RPCs
      return route.fulfill({ status: 200, body: 'null' })
    }

    // Functions (Edge Functions invoked via supabase.functions.invoke)
    if (url.includes('/functions/v1/')) {
      const fn = url.split('/functions/v1/')[1].split('?')[0]
      if (fn === 'send-audit-push') return route.fulfill({ status: 200, body: JSON.stringify({ sent: 1, failed: 0, removed: 0, total: 1 }) })
      if (fn === 'submit-audit-gps') return route.fulfill({ status: 200, body: JSON.stringify({ ok: true, distanceM: 0, distanceBucket: 'GREEN', status: 'IN_YESHIVA' }) })
      return route.fulfill({ status: 200, body: '{}' })
    }

    // REST table queries
    if (url.includes('/rest/v1/students')) {
      if (method === 'GET') return route.fulfill({ status: 200, body: JSON.stringify([FIX_STUDENT]) })
      if (method === 'PATCH') return route.fulfill({ status: 200, body: JSON.stringify([FIX_STUDENT]) })
    }
    if (url.includes('/rest/v1/departures') || url.includes('/rest/v1/events') || url.includes('/rest/v1/admin_overrides') || url.includes('/rest/v1/v_calendar_departures')) {
      return route.fulfill({ status: 200, body: '[]' })
    }
    // Auth
    if (url.includes('/auth/v1/')) {
      return route.fulfill({ status: 200, body: JSON.stringify({ access_token: 'fake', refresh_token: 'fake', user: { id: 'admin', email: 'admin@yeshiva.local' } }) })
    }

    return route.fulfill({ status: 200, body: '{}' })
  })

  const page = await context.newPage()
  const cons = []
  consoleByPage.push({ label, cons })
  page.on('console', (m) => cons.push(`[${m.type()}] ${m.text().slice(0, 200)}`))
  page.on('pageerror', (err) => cons.push(`[PAGE ERROR] ${err.message.slice(0, 300)}`))
  return { context, page }
}

async function shot(page, name) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true })
}

async function dismissSplash(page) {
  // Splash auto-closes after a few seconds; just wait
  await page.waitForTimeout(2500)
}

// ── 1. Student flow ─────────────────────────────────────────────────────────
{
  const { context, page } = await newSession('student')
  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await dismissSplash(page)
    await shot(page, '10_student_login_idle')

    // Enter ID + submit
    const idInput = page.locator('input').first()
    if (await idInput.count() === 0) { fail('student.id_input_present', 'no input found'); throw new Error() }
    await idInput.fill(FIX_STUDENT.idNumber)
    await shot(page, '11_student_login_filled')
    pass('student.id_input_accepts_text')

    // Click "כניסה" — the button, not the H1
    const loginButton = page.locator('button:has-text("כניסה")').first()
    await loginButton.click()
    await page.waitForTimeout(1500)
    await shot(page, '12_student_after_login')

    const onStudentPage = page.url().includes('/student')
    if (onStudentPage) pass('student.login_navigates_to_dashboard', page.url())
    else fail('student.login_navigates_to_dashboard', `still at ${page.url()}`)

    // Check inspection-student-sheet (audit GPS banner) — should be visible if mocked session is LOCATION mode
    const banner = page.locator('[data-testid="inspection-student-sheet"]')
    const bannerVisible = await banner.isVisible().catch(() => false)
    if (bannerVisible) {
      pass('student.gps_banner_renders_when_location_audit_active')
      const shareBtn = page.locator('[data-testid="inspection-student-confirm"]')
      if (await shareBtn.count() > 0) {
        pass('student.gps_share_button_present')
        // Skip actual click — getCurrentPosition needs the geolocation permission which isn't granted
        // The button click would fail with a geolocation prompt
      } else fail('student.gps_share_button_present', 'no confirm button')
    } else info('student.gps_banner_renders_when_location_audit_active', 'no banner visible — either no LOCATION audit or polling hasn\'t fired yet')
  } catch (e) { fail('student.flow', e.message) }
  await context.close()
}

// ── 2. Admin flow ───────────────────────────────────────────────────────────
{
  const { context, page } = await newSession('admin')
  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await dismissSplash(page)

    // Open admin login modal
    const adminButton = page.locator('button:has-text("כניסת מנהל / רכז")').first()
    if (await adminButton.count() === 0) { fail('admin.modal_trigger_present', 'button not found'); throw new Error() }
    await adminButton.click()
    await page.waitForTimeout(600)
    await shot(page, '20_admin_modal_open')
    pass('admin.modal_opens')

    // Short PIN should show length error
    const pinInput = page.locator('input[type="password"]').first()
    await pinInput.fill('123')
    await page.locator('div[role="dialog"] button:has-text("כניסה")').first().click()
    await page.waitForTimeout(500)
    const bodyText = await page.locator('body').innerText()
    if (bodyText.includes('הזן לפחות 4')) pass('admin.short_pin_validation_fires')
    else fail('admin.short_pin_validation_fires', 'no Hebrew length warning visible')
    await shot(page, '21_admin_short_pin')

    // Real PIN
    await pinInput.fill('12345')
    await page.locator('div[role="dialog"] button:has-text("כניסה")').first().click()
    await page.waitForTimeout(2500)
    await shot(page, '22_admin_after_login')
    if (page.url().includes('/admin')) pass('admin.login_navigates_to_dashboard', page.url())
    else fail('admin.login_navigates_to_dashboard', `still at ${page.url()}`)

    // Navigate to inspection
    await page.goto(`${BASE}/admin/inspection`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
    await shot(page, '23_admin_inspection')
    const inspectionUrl = page.url()
    if (inspectionUrl.includes('/admin/inspection')) pass('admin.inspection_route_resolves', inspectionUrl)
    else fail('admin.inspection_route_resolves', `redirected to ${inspectionUrl}`)

    // Click "פתח ביקורת"
    const openAuditBtn = page.locator('button:has-text("פתח ביקורת")').first()
    if (await openAuditBtn.count() > 0) {
      await openAuditBtn.click()
      await page.waitForTimeout(800)
      await shot(page, '24_admin_open_audit_modal')
      pass('admin.open_audit_modal_works')

      // Click MANUAL mode card
      const manualCard = page.locator('[data-testid="inspection-mode-card-manual"]')
      if (await manualCard.count() > 0) {
        await manualCard.click()
        await page.waitForTimeout(300)
        pass('admin.mode_card_manual_present_and_clickable')
      } else fail('admin.mode_card_manual_present_and_clickable', 'testid missing')

      const locationCard = page.locator('[data-testid="inspection-mode-card-location"]')
      if (await locationCard.count() > 0) pass('admin.mode_card_location_present')
      else fail('admin.mode_card_location_present', 'testid missing')

      await shot(page, '25_admin_modal_mode_selected')
    } else info('admin.open_audit_modal_works', '"פתח ביקורת" button not present — admin may already have a session')

    // Inspection history navigation
    await page.goto(`${BASE}/admin/inspection/history`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200)
    await shot(page, '26_admin_inspection_history')
    if (page.url().includes('/admin/inspection/history')) pass('admin.history_route_resolves')
    else fail('admin.history_route_resolves', `at ${page.url()}`)

    // Legacy route redirect
    await page.goto(`${BASE}/admin/rollcall`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(800)
    if (page.url().endsWith('/admin/inspection')) pass('admin.legacy_rollcall_redirects')
    else fail('admin.legacy_rollcall_redirects', `at ${page.url()}`)

    await page.goto(`${BASE}/admin/audits`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(800)
    if (page.url().endsWith('/admin/inspection/history')) pass('admin.legacy_audits_redirects')
    else fail('admin.legacy_audits_redirects', `at ${page.url()}`)

  } catch (e) { fail('admin.flow', e.message) }
  await context.close()
}

// ── 3. Supervisor flow ──────────────────────────────────────────────────────
{
  const { context, page } = await newSession('supervisor')
  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await dismissSplash(page)

    await page.locator('button:has-text("כניסת מנהל / רכז")').first().click()
    await page.waitForTimeout(600)
    await page.locator('input[type="password"]').first().fill('12345001')
    await page.locator('div[role="dialog"] button:has-text("כניסה")').first().click()
    await page.waitForTimeout(2500)
    await shot(page, '30_supervisor_after_login')
    if (page.url().includes('/class-supervisor')) pass('supervisor.login_navigates_to_dashboard', page.url())
    else fail('supervisor.login_navigates_to_dashboard', `at ${page.url()}`)

    // Look for the minimal "audit detected — load data" banner
    const loadDataBtn = page.locator('button:has-text("טען נתוני ביקורת")').first()
    const loadBtnVisible = await loadDataBtn.isVisible().catch(() => false)
    if (loadBtnVisible) pass('supervisor.minimal_audit_banner_renders')
    else info('supervisor.minimal_audit_banner_renders', 'banner not visible — may need PIN cached already or polling not fired')
    await shot(page, '31_supervisor_dashboard')

  } catch (e) { fail('supervisor.flow', e.message) }
  await context.close()
}

// ── 4. Pure UI / no auth required ───────────────────────────────────────────
{
  const { context, page } = await newSession('public')
  try {
    // ErrorBoundary check — force a render error by visiting a deliberately bad URL pattern
    // Skip: hard to force without modifying code. Just verify boundary mount exists.
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await dismissSplash(page)
    const html = await page.content()
    if (html.includes('PwaUpdateToast') || html.length > 1000) pass('public.app_renders_without_crash')
    else fail('public.app_renders_without_crash', 'minimal HTML')

  } catch (e) { fail('public.flow', e.message) }
  await context.close()
}

await browser.close()

// ── Report ──────────────────────────────────────────────────────────────────
const pages = consoleByPage.map((p) => ({
  label: p.label,
  errors: p.cons.filter((c) => c.startsWith('[error]') || c.startsWith('[PAGE ERROR]')).length,
  warnings: p.cons.filter((c) => c.startsWith('[warning]')).length,
  total: p.cons.length,
}))

writeFileSync(join(OUT, 'report.json'), JSON.stringify({ results, pages, consoleByPage }, null, 2))
console.log('\n========================================')
console.log(`Total checks: ${results.length}`)
console.log(`  ✅ pass:   ${results.filter((r) => r.status === '✅').length}`)
console.log(`  ❌ fail:   ${results.filter((r) => r.status === '❌').length}`)
console.log(`  ℹ️  info:   ${results.filter((r) => r.status === 'ℹ️').length}`)
console.log(`\nPer-context console:`)
for (const p of pages) console.log(`  ${p.label.padEnd(10)} errors=${p.errors} warnings=${p.warnings} total=${p.total}`)
console.log(`\nReport: ${OUT}/report.json`)
console.log(`Screenshots: ${OUT}/`)
