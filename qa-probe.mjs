/**
 * QA probe — open the app via Playwright, walk through every flow we touched
 * in the audit work, capture console + network errors + visible text, and
 * write a structured report. Run via:
 *   node qa-probe.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT = '/tmp/qa-probe'
mkdirSync(OUT, { recursive: true })

const BASE = 'http://localhost:5173'

const report = []
function log(line) {
  console.log(line)
  report.push(line)
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, // iPhone 14 width per master plan
  locale: 'he-IL',
  timezoneId: 'Asia/Jerusalem',
})

const consoleMessages = []
const networkErrors = []
const pageErrors = []
context.on('weberror', (we) => pageErrors.push({ url: we.page().url(), error: we.error().message }))

const page = await context.newPage()
page.on('console', (msg) => {
  consoleMessages.push({ type: msg.type(), text: msg.text(), url: page.url() })
})
page.on('pageerror', (err) => pageErrors.push({ url: page.url(), error: err.message }))
page.on('response', (resp) => {
  const status = resp.status()
  if (status >= 400) {
    networkErrors.push({ url: resp.url(), status, on: page.url() })
  }
})
page.on('requestfailed', (req) => {
  networkErrors.push({ url: req.url(), status: 'FAILED', on: page.url(), failure: req.failure()?.errorText })
})

async function probe(label, urlPath, after) {
  log(`\n=== ${label}: ${urlPath} ===`)
  try {
    await page.goto(`${BASE}${urlPath}`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForTimeout(2000) // let async fire
    const title = await page.title()
    const url = page.url()
    const heading = await page.locator('h1,h2,h3,p').first().textContent().catch(() => '(none)')
    const visibleText = (await page.locator('body').innerText().catch(() => '')).slice(0, 400)
    log(`  url:    ${url}`)
    log(`  title:  ${title}`)
    log(`  first:  ${(heading ?? '').slice(0, 80)}`)
    log(`  body:   ${visibleText.replace(/\s+/g, ' ').slice(0, 240)}`)
    await page.screenshot({ path: join(OUT, `${label.replace(/\W+/g, '_')}.png`), fullPage: true })
    if (after) await after()
  } catch (err) {
    log(`  ERROR:  ${err.message}`)
  }
}

await probe('00_root', '/')
await probe('01_login', '/login')
await probe('02_admin_inspection_redirect', '/admin/rollcall')
await probe('03_admin_inspection_main', '/admin/inspection')
await probe('04_admin_inspection_history', '/admin/inspection/history')
await probe('05_admin_audit_log_legacy', '/admin/audit')
await probe('06_class_supervisor', '/class-supervisor')
await probe('07_student', '/student')

// Try the admin PIN modal at /login
await probe('08_admin_login_modal', '/login', async () => {
  const btn = page.getByText('כניסת מנהל / רכז', { exact: false })
  if (await btn.count() > 0) {
    await btn.first().click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: join(OUT, '08_admin_modal_open.png') })
    // Type a short pin → length validator should fire (B-18)
    const pinInput = page.locator('input[type="password"]').first()
    if (await pinInput.count() > 0) {
      await pinInput.fill('123')
      await page.getByText('כניסה', { exact: false }).first().click()
      await page.waitForTimeout(800)
      await page.screenshot({ path: join(OUT, '08_admin_modal_short_pin.png') })
      const bodyText = await page.locator('body').innerText().catch(() => '')
      log(`  short-pin body snippet: ${bodyText.includes('הזן לפחות 4') ? '✓ shows "הזן לפחות 4 ספרות"' : '✗ no length warning visible'}`)
    } else {
      log(`  ✗ password input not found`)
    }
  } else {
    log(`  ✗ admin login button not found`)
  }
})

await browser.close()

// Final summary
log(`\n\n========== SUMMARY ==========`)
log(`Console messages:   ${consoleMessages.length}`)
const consErr = consoleMessages.filter((m) => m.type === 'error' || m.type === 'warning')
log(`  errors/warnings: ${consErr.length}`)
for (const m of consErr.slice(0, 30)) log(`    [${m.type}] ${m.text.slice(0, 180)}`)
log(`\nPage errors:        ${pageErrors.length}`)
for (const e of pageErrors.slice(0, 10)) log(`    ${e.error.slice(0, 180)} @ ${e.url}`)
log(`\nNetwork errors:     ${networkErrors.length}`)
const byUrl = new Map()
for (const n of networkErrors) {
  const key = `${n.status} ${n.url.replace(/\?.*$/, '').replace(/^https?:\/\/[^/]+/, '')}`
  byUrl.set(key, (byUrl.get(key) ?? 0) + 1)
}
for (const [k, count] of [...byUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  log(`    ${count}× ${k}`)
}

writeFileSync('/tmp/qa-probe/report.txt', report.join('\n'))
log(`\nFull report: /tmp/qa-probe/report.txt`)
log(`Screenshots: /tmp/qa-probe/`)
