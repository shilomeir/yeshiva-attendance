# Production Audit & Repair Manual — Yeshivat Shavi Hevron Attendance System

**Audited:** 2026-05-24 · **Branch:** `claude/yeshiva-attendance-audit-3O4mR`
**Scope:** Full app — student / admin / class-supervisor flows, auth, realtime, offline, formulas, mobile/RTL, tests.

---

## 0. How this audit was performed & what could NOT be verified

**Verified with real commands / code:**
- `npm install`, `npm run lint`, `npm run test`, `npm run build`, `npm run dev`, `npm run preview` — all run.
- Dev server and production preview both serve **HTTP 200**.
- Logic checks executed in Node: Hebrew-calendar gematria, the quota formula breakpoints, and the exact Unicode codepoints inside `normalizeHebrew`.
- Every code-level finding below cites a concrete `file:line`.

**Could NOT be verified in this environment (be explicit):** there is **no browser, no Playwright/Chromium, and no Supabase anon key / network to the DB** in the sandbox. Therefore the following were **not** exercised live and are based on code reading only:
- Click-through of buttons/modals, browser console & network panels.
- Real login against the DB, RLS behavior, realtime delivery, Web Push, end-to-end offline sync.
- Mobile-viewport rendering, RTL visual correctness, dark-mode visuals at 360/390/430px.

All **fixes** in §1 are verified by `tsc -b` + ESLint + Vitest + `vite build`, **not** by browser. UI-affecting fixes still need a manual browser pass (checklists provided).

**Baseline results**
| Command | Before | After |
|---|---|---|
| `npm run lint` | ✖ 2 errors, 27 warnings | ✓ 0 errors, 27 warnings (pre-existing hook-deps) |
| `npm run test` | 21 passed | **34 passed** |
| `npm run build` | ✓ | ✓ |
| `npm run dev` / `preview` | HTTP 200 | HTTP 200 |

---

## 1. Issues FIXED in this pass (verified by lint + test + build)

> Each is a small, low-risk change. UI-affecting ones still need the manual checks in §3/§4.

### F1 — ESLint error: empty interface (`no-empty-object-type`)
- **Location:** `src/components/ui/input.tsx:4`
- **Was:** `export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}`
- **Fix:** changed to `export type InputProps = React.InputHTMLAttributes<HTMLInputElement>`.
- **Acceptance:** `npm run lint` no longer reports an error here.

### F2 — ESLint error: empty block (`no-empty`)
- **Location:** `src/main.tsx:20`
- **Fix:** added an explanatory comment inside the `catch {}` for the persisted-theme parse.
- **Acceptance:** `npm run lint` clean here.

### F3 — Dead "call student" button (empty `tel:`)
- **Location:** `src/pages/admin/PendingRequestsPage.tsx:124-132`
- **Was:** `<a href={`tel:`}>` — `CalendarDeparture` has no `phone` field (`src/types/index.ts:74-79`), so the link opened an empty dialer.
- **Fix:** removed the dead anchor and the now-unused `Phone` import.
- **Risk:** none (removed non-functional element). To restore a *working* call button, add `phone` to `v_calendar_departures` + `CalendarDeparture` and use `tel:${dep.phone}` (see O-list).

### F4 — Excel export ignored the active filter and grouped with raw `===`
- **Location:** `src/pages/admin/StudentsPage.tsx:14-41,134`
- **Was:** button called `exportToXlsx(students)` (the **full** list) while the header shows `filteredStudents.length`; grouping used `s.grade === level.name` (no `normalizeHebrew`), silently dropping students whose grade had an apostrophe variant.
- **Fix:** export now uses `filteredStudents`; grouping uses `normalizeHebrew(s.grade) === normalizeHebrew(level.name)`.
- **Acceptance:** exported file matches the visible filtered set and includes every student.

### F5 — Supervisor class label never trimmed (dead branch)
- **Location:** `src/pages/class-supervisor/ClassSupervisorDashboard.tsx:443,660`
- **Was:** `classId.includes(' כיתה ')` — real `classId`s start with `כיתה ` (no leading space), so the branch was **always false**; supervisors saw `כיתה הרב אבישי` instead of `הרב אבישי`.
- **Fix:** introduced a single shared helper `classLabel(classId)` in `src/lib/constants/grades.ts` (`replace(/^כיתה\s+/, '')`, matching the already-correct `StudentRow.tsx:47`) and used it in both spots.
- **Tests added:** `src/lib/constants/__tests__/grades.test.ts`.

### F6 — Supervisor checkout could create `end_at` in the past
- **Location:** `src/pages/class-supervisor/ClassSupervisorDashboard.tsx:115-148`
- **Was:** `exitType === 'today'` set `endAt` to today at the chosen time; if that time was earlier than now, `end_at <= start_at` and `submit_departure` rejected with a generic error.
- **Fix:** added a guard — if `endAt <= now`, show a clear Hebrew toast (`שעת חזרה לא תקינה`) and abort before calling the RPC.

### F7 — Student ID leaked in localStorage after logout
- **Location:** `src/store/authStore.ts:121` and `src/components/student/StudentLayout.tsx:51`
- **Was:** "remember me" wrote **two** keys (`yeshiva_last_id` and `yeshiva_remembered_id`); logout cleared only `yeshiva_remembered_id`, leaving the student's ID in `yeshiva_last_id` forever (and it is never read).
- **Fix:** `logout()` now also removes `yeshiva_last_id`.

### F8 — Student pages subscribed to **all** departures (over-subscription)
- **Location:** `src/pages/student/HomePage.tsx:141`, `src/pages/student/AbsenceRequestPage.tsx:97`
- **Was:** `useDeparturesRealtime({ onAnyChange })` with no `studentId` → channel `departures-all`; every departure change for **any** student triggered the logged-in student's refetch, and (depending on RLS) the channel may receive nothing useful.
- **Fix:** pass `studentId: currentUser?.id` so the hook applies the documented Postgres filter `student_id=eq.<id>`.

### F9 — Dashboard "Quick Stats" showed hardcoded fake trends
- **Location:** `src/pages/admin/DashboardPage.tsx:245-250`
- **Was:** `נעדרים 7+ ימים` always showed trend `−1`; `מכשירים רשומים` always showed `94%` — neither computed from data.
- **Fix:** registered-devices trend is now the real percentage (`registered/total`); the meaningless `−1` is blanked.

### F10 — `normalizeHebrew` did not handle curly smart-quotes (real bug)
- **Location:** `src/store/studentsStore.ts:38`
- **Proof:** the regex `['''׳`]` is actually three **identical ASCII** apostrophes (U+0027) + geresh (U+05F3) + backtick (U+0060). It did **not** include U+2018 `‘` or U+2019 `’` — the smart-quote iOS/macOS keyboards auto-insert — despite the comment claiming it handled the "right-quote". A grade/class string with `’` would fail every normalized comparison (filters, exports, supervisor scoping).
- **Fix:** regex is now `/['‘’׳`]/g` (adds U+2018/U+2019).
- **Tests added:** `src/store/__tests__/normalizeHebrew.test.ts`.

### Tests added
- `src/domain/__tests__/quota.test.ts` — full `calcQuota` breakpoint table + a 0–120 cross-check against the formula. **Note:** this surfaced that CLAUDE.md §5's table is slightly wrong at `n=22` (it lists 22→3, but `FLOOR(22*0.135)=2`). The **formula** is authoritative (it's shared verbatim with the `submit_departure` RPC), so client and server agree on `2`; only the doc table is off. See O21.
- `src/lib/constants/__tests__/grades.test.ts` — `classLabel`, `getClasses`.
- `src/store/__tests__/normalizeHebrew.test.ts` — apostrophe variants, trimming.

---

## 2. Issues OPEN (documented, NOT changed) — full repair instructions

> These were left unchanged because they (a) delete working functionality and need a product decision, (b) require browser verification I can't do here, or (c) are larger than a "smallest safe change." Each is a complete, self-contained work item.

### O1 — [CRITICAL / architecture] Student Add / Edit / Delete UI exists and is wired
- **Severity:** Critical (violates CLAUDE.md Iron Rule #1; causes silent data loss UX).
- **Location:**
  - Add: `src/pages/admin/StudentsPage.tsx:138-141,206-211` + `src/components/admin/AddStudentModal.tsx` (calls `api.addStudent`, `AddStudentModal.tsx:49`).
  - Edit: `src/components/admin/StudentTable.tsx:34-38` → `src/components/admin/StudentEditModal.tsx` (calls `api.updateStudent`/`updateStudentGrade`).
  - Delete: `src/components/admin/StudentRow.tsx:35-45,143-156` → `studentsStore.deleteStudent` → `api.deleteStudent`.
  - Interface + impls: `src/lib/api/types.ts:116-120`, `src/lib/api/supabaseClient.ts:148-200`, `src/lib/api/mockClient.ts`.
  - Subtitle also advertises non-existent import: `StudentsPage.tsx:130` ("יבוא/יצוא Excel").
- **Current broken behavior:** an admin can add/edit/delete students from the UI. Per Iron Rule #1, students are owned by Google Sheets; **the next sync hard-overwrites/re-deletes any UI change**. So an admin edits a name/class, sees a success toast, and the change silently reverts on the next sync — classic "stale UI / lost write."
- **Expected:** No add/edit/import UI; `addStudent` removed from `IApiClient`; class edits (if kept at all) are explicitly labeled temporary.
- **Root cause:** the removal documented in CLAUDE.md §18 was never done (or was reverted — see commit `5ef6286 "render student edit modal above admin table"`).
- **Required fix (needs product sign-off — do not do blindly):**
  1. Remove the "הוסף תלמיד" button + `AddStudentModal` usage from `StudentsPage`; delete `AddStudentModal.tsx`.
  2. Remove `addStudent` from `IApiClient` and both client implementations + `mockClient`.
  3. Decide on edit/delete: either remove entirely, or keep **only** the temporary class-override (`ClassEditModal` semantics) with an explicit "ייתכן שיוחלף בסנכרון הבא" notice.
  4. Fix the subtitle to drop "יבוא".
- **Why not auto-fixed:** this deletes currently-working functionality; the instructions forbid removing functionality without confirmation. **Recommend asking the product owner first.**
- **Acceptance:** no student CRUD affordance in the admin UI; `grep -rn "addStudent" src` returns only test/no references; sync remains the only write path.
- **Risk:** `StudentTable`, `StudentRow`, `StudentsPage` all reference these; removing requires careful prop cleanup. Re-run `tsc -b`.

### O2 — [HIGH] Admin & supervisor are logged out on every page refresh
- **Location:** `src/store/authStore.ts:129-135` (`partialize` persists only `deviceToken`); guards in `src/App.tsx:40-50`; student-only auto-login in `src/components/auth/LoginScreen.tsx:533-545`.
- **Current behavior:** `isAdmin`/`classSupervisor`/`currentUser` are in-memory. On reload, admins & supervisors fail their guard → redirected to `/login`. Students are rescued by `yeshiva_remembered_id` auto-login; admins/supervisors have **no** such path. iOS PWAs reload aggressively on backgrounding, so this happens often.
- **Expected:** a valid admin/supervisor session survives refresh (at least for a bounded time).
- **Root cause:** intentional "reset on reload" for security, but with no re-auth path for admin/supervisor.
- **Required fix (choose one):**
  - (a) Persist a short-lived flag and re-verify on boot via the existing `verify_admin_pin` / `verify_supervisor_pin` RPCs (re-prompt only if expired). Do **not** persist the PIN.
  - (b) Persist the Supabase Auth session for admin (it already signs in as `admin@yeshiva.local`) and rehydrate `isAdmin` from `supabase.auth.getSession()` on boot.
  - (c) Accept current behavior but add a "remember this device" for admin/supervisor mirroring the student flow.
- **Tests:** add an `authStore` test asserting the chosen rehydration path; a guard test that a rehydrated admin reaches `/admin`.
- **Manual QA:** log in as admin → refresh `/admin` → should stay; same for supervisor; logging out then Back button must not re-enter.
- **Acceptance:** refresh on `/admin` and `/class-supervisor` keeps the session for the intended window.

### O3 — [MEDIUM] Dead export buttons on the dashboard
- **Location:** `src/pages/admin/DashboardPage.tsx:842-844` ("ייצוא דוח יום") and `:490-492` (ClassStatsTable "ייצוא"). Neither has an `onClick`.
- **Expected:** either export real data or remove the buttons.
- **Required fix:** wire to `xlsx` (already a dependency; reuse the `exportToXlsx` pattern from `StudentsPage.tsx:14-41`). For the class-stats button, export `classStats`; for "ייצוא דוח יום", export today's departures + presence summary. If export is out of scope, remove both buttons.
- **Acceptance:** clicking produces a downloaded `.xlsx`, or the buttons no longer exist.

### O4 — [MEDIUM] Dead per-row menu button in the audit log
- **Location:** `src/components/admin/AuditLogPanel.tsx:201-203` — `<button><MoreHorizontal/></button>` with no handler.
- **Fix:** remove it, or wire a details/expand popover.

### O5 — [MEDIUM] Optimistic `OFF_CAMPUS` + "undo" banner shown for PENDING departures
- **Location:** `src/components/student/OffCampusSheet.tsx:124-128` (`onSuccess(dep.id)` fires for any non-error result) → `src/components/student/StatusButtons.tsx:286-289` (always `onStatusChange('OFF_CAMPUS')` + `onCheckoutSuccess`).
- **Current behavior:** when a request is urgent/forced (server returns `PENDING`, not approved), the student is shown as OFF_CAMPUS and a 5-minute "נרשמה יציאה · בטל" banner appears, even though they have not left. It self-corrects after `refreshStudent()`, but the undo banner persists and is misleading.
- **Expected:** flip to OFF_CAMPUS + show undo **only** when the result is `APPROVED`/`ACTIVE`. For `PENDING`, keep status and show "ממתינה לאישור".
- **Required fix:** change `OffCampusSheetProps.onSuccess` to `(departureId, isApproved: boolean)`; pass `dep.status === 'APPROVED' || dep.status === 'ACTIVE'`. In `StatusButtons`, only call `onStatusChange('OFF_CAMPUS')` and `onCheckoutSuccess` when `isApproved`.
- **Tests:** unit-test that a `PENDING` result does not set the undo state (extract the decision into a tiny pure helper if needed).
- **Manual QA:** submit an urgent request → status must stay "נוכח"/PENDING, no undo banner; submit a normal in-quota request → OFF_CAMPUS + undo appears.

### O6 — [MEDIUM] Timezone off-by-one in date bucketing/keys
- **Locations:**
  - `src/components/admin/AbsenceCalendar.tsx:~188-192` buckets via `start_at.slice(0,10)`/`end_at.slice(0,10)` (UTC) compared to `format(day,'yyyy-MM-dd')` (local Asia/Jerusalem).
  - `src/pages/admin/ExceptionsPage.tsx:~333-336` builds day keys via `toISOString().slice(0,10)` (UTC) but labels via local `getDay()`.
  - `src/pages/admin/DashboardPage.tsx:750-753` and `src/pages/student/AbsenceRequestPage.tsx:37-39` use `new Date().toISOString().slice(0,10)` for "today".
- **Current behavior:** near midnight Israel (UTC+2/＋3), a departure/event can be attributed to the wrong calendar day.
- **Required fix:** add a single helper that returns the Asia/Jerusalem `YYYY-MM-DD` for a `Date`/ISO string (`Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem'})` — note `todayIsrael()` already exists in `src/domain/dates.ts:10`). Use it everywhere a date bucket/key/"today" is computed.
- **Tests:** unit-test the helper for a timestamp that is "tomorrow" in UTC but "today" in Jerusalem and vice-versa.
- **Acceptance:** a departure created at 23:30 Israel appears on the correct day cell; the weekly chart column count matches its weekday label.

### O7 — [MEDIUM] `buildIsraelTimestamp` returns the wrong instant (latent landmine)
- **Location:** `src/domain/dates.ts:27-43` (also unused: `formatIsrael`, `todayIsrael`, `isPast`).
- **Proof:** for input `("2026-05-24","14:30")` with a browser in Asia/Jerusalem it returns `2026-05-24T14:30:00Z` (= 17:30 Israel) instead of the correct `11:30Z` (= 14:30 Israel). The offset is applied in the wrong direction.
- **Status:** currently **dead code** — `grep -rn buildIsraelTimestamp src` shows no callers — so it harms nothing today, but it is a trap for the next developer.
- **Required fix:** either delete the unused functions, or correct the implementation: build the guess as `new Date(`${dateStr}T${timeStr}:00Z`)`, render it in `Asia/Jerusalem`, compute `offset = israelWallAsUtc - guess`, and return `new Date(guess - offset).toISOString()`.
- **Tests:** assert `buildIsraelTimestamp('2026-05-24','14:30')` → the ISO whose Jerusalem render is `14:30`.

### O8 — [MEDIUM/perf] Audit log refetches everything on every page change
- **Location:** `src/components/admin/AuditLogPanel.tsx:60-94` — `useEffect([page])` re-calls `getAdminOverrides()` (full list) + `getStudents()` (all 381) to slice 20 rows.
- **Fix:** fetch once (e.g. on mount), cache `all` + `studentMap`, and slice in memory on page change; or implement server-side pagination.

### O9 — [MEDIUM/offline] Sync queue: silent conflict swallow + invisible dead-letters
- **Location:** `src/lib/sync/syncEngine.ts` — upsert with `{ onConflict:'id', ignoreDuplicates:true }` (~:73-76); dead-letter purge at top of `processQueue` (~:51-63) vs `getFailedCount` (retryCount ≥ MAX) used by `SyncStatusBar`.
- **Current behavior:** (a) a re-pushed offline INSERT whose row already exists is a silent no-op treated as success — local copy may differ from server; (b) items that hit `MAX_RETRIES` are deleted on the next pass before the "X פעולות נכשלו" banner can render, so persistent failures are effectively never surfaced.
- **Required fix:** (a) use a real upsert (`ignoreDuplicates:false`) for idempotent re-push, or detect 0-row results and reconcile; (b) move dead-letter handling to a separate sweep, or keep dead-lettered rows with a terminal flag so the banner persists until the user acts.
- **Manual QA (needs a browser):** go offline, check out, come back online → event syncs once, status correct; force a permanent failure → banner shows and stays.

### O10 — [LOW] Splash screen on every load
- **Location:** `src/App.tsx:64,105`, `src/components/shared/SplashScreen.tsx`. Shows 2.5s overlay on every mount/refresh. Combined with O2, admins see splash → login each refresh. Consider showing it once per session (sessionStorage flag).

### O11 — [LOW] Dead code: `AdminLoginModal.tsx` and `sw.ts`
- **Proof:** `grep -rn AdminLoginModal src` → only its own definition (login is inline in `LoginScreen.tsx`). `src/sw.ts` is **not referenced** and `vite.config.ts` uses the default `generateSW` strategy (no `strategies:'injectManifest'`), so the active service worker is the generated one that `importScripts(['/push-sw.js'])`. **Correction to a tempting assumption:** there is **no** duplicate-push-handler bug at runtime — only `public/push-sw.js` runs; `sw.ts`'s push handler is dead. Delete `AdminLoginModal.tsx` and `sw.ts` to avoid confusion.

### O12 — [LOW] App badge not cleared when push arrives in foreground
- **Location:** `public/push-sw.js:20-24` (`setAppBadge(1)`), cleared only on `visibilitychange→visible` (`src/App.tsx:78-83`) or notification click. If a push arrives while the PWA is focused, the badge lingers. Fix: in the SW `push` handler, `clients.matchAll({type:'window'})` and skip `setAppBadge`/postMessage the page to clear when a client is focused.

### O13 — [LOW] Geolocation error handler can throw on some webviews
- **Location:** `src/lib/location/gps.ts:~62-74` — compares against `GeolocationPositionError.PERMISSION_DENIED` (global constants). If that global is undefined, the error callback throws and the `getCurrentPosition` promise never resolves (caller hangs). Use instance members (`error.code === error.PERMISSION_DENIED`) or numeric codes `1/2/3`.

### O14 — [LOW] Return-reminder timer overflows for multi-week departures
- **Location:** `src/lib/notifications/scheduleReturn.ts:18-41` — `setTimeout(delay)` with `delay > 2^31 ms` (~24.8 days) fires immediately; also lost on reload. Document as a known limitation or schedule via the SW/push instead.

### O15 — [LOW] HomePage "history" widget mislabels a live count
- **Location:** `src/pages/student/HomePage.tsx:53-79,104-105` — `recentCount` is the number of ACTIVE+APPROVED departures, shown under "היסטוריה" as "X יציאות". Either fetch a real history count or relabel.

### O16 — [LOW] CalendarPage subtitle mentions content not rendered
- **Location:** `src/pages/admin/CalendarPage.tsx:~14` — copy references "חג״מים"/holidays the calendar does not actually surface. Align copy with what's shown.

### O17 — [LOW] Static "zmanim" on the login screen
- **Location:** `src/components/auth/LoginScreen.tsx:151-157` — hardcoded times (sunrise 05:38, etc.) shown for **every** date. Cosmetic/misleading; either compute real zmanim for Hebron or drop the times. (Do **not** add schedule/seder content — out of scope per the brief.)

### O18 — [LOW] "יבוא Excel" advertised but not implemented
- **Location:** `src/pages/admin/StudentsPage.tsx:130`. Remove the word "יבוא" (import is forbidden by Iron Rule #1 anyway).

### O19 — [INFO] Stale Supabase project comment
- **Location:** `vite.config.ts:1` references project ref `frxjddevnehprauoapiv`, while `src/lib/supabase.ts:4` hardcodes canonical `tybpsilcgpwlmqsewreu`. Update/remove the stale comment.

### O20 — [MEDIUM/security, known debt] No RLS; PIN plaintext; ID-only login
- Documented in CLAUDE.md §19. Supervisor scoping is client-side only (`ClassSupervisorDashboard` + `getStudents({classId})`); the anon key can query any class. Admin PIN stored plaintext in `app_settings`. Track as security backlog; not a regression.

### O21 — [LOW/doc] CLAUDE.md quota table is off at n=22
- **Location:** `CLAUDE.md §5`. Table says 22→3, but `FLOOR(22*0.135)=2`. The **formula** (client + RPC) is correct and authoritative; update the table to `15–22 → 2`, `23–29 → 3` (and re-check that the RPC truly uses `FLOOR(class_size*0.135)`).

### Testing gaps (beyond the tests added in §1)
- No component/flow tests for: route guards (student/admin/supervisor + unauthenticated), departure submit/approve/reject/cancel/return transitions, calendar day-bucketing, dashboard stats math, offline queue replay. Add Vitest + (optionally) a lightweight React testing setup. Highest value: guard redirects (O2), departure status mapping (O5), tz bucketing (O6).

---

## 3. Prioritized execution plan

### Phase 1 — Critical reliability / correctness
- **O1** student CRUD vs Sheets-ownership (get product decision first).
- **O2** admin/supervisor session survives refresh.
- **O5** PENDING shows correct status (no false OFF_CAMPUS/undo).
- Commands: `npm run lint && npm run test && npm run build`.
- Browser checks: admin refresh stays logged in; urgent request keeps "נוכח".

### Phase 2 — High-risk flows
- **O6** timezone date bucketing (calendar, exceptions, "today").
- **O9** offline sync conflict + dead-letter visibility.
- **O3/O4** dead export & audit menu buttons (wire or remove).
- Browser checks (needs network + DB): create a near-midnight departure; go offline→online; click every export.

### Phase 3 — Mobile / RTL / UX
- Manual viewport pass at **360 / 390 / 430px** and one landscape:
  - Login `ls-id-boxes` (9 boxes) must not overflow at 360px (CSS at `LoginScreen.tsx:1166-1174` exists — verify on device).
  - HomePage absolute-positioned floating widgets (`HomePage.tsx:213-235`, `top:290`) — verify they don't collide/overflow on short screens.
  - `OffCampusSheet` bottom sheet with the keyboard open (time/date inputs).
  - Dashboard wide grids (`gridTemplateColumns` fixed ratios, `DashboardPage.tsx:849,856`) — confirm they collapse on mobile; the broadcast form uses `1fr 1fr` (`:639`) which may be cramped < 400px.
- O10 splash once-per-session; O15/O16/O17/O18 copy fixes.

### Phase 4 — Tests
- Add guard/flow/tz/offline tests listed above.

### Phase 5 — Cleanup
- O7 (dead dates helpers), O11 (`AdminLoginModal`, `sw.ts`), O19 (stale comment), O21 (doc table), the 27 `react-hooks/exhaustive-deps` warnings (audit each — several intentionally omit `loadData`/`currentUser`).

---

## 4. Manual QA checklist (run once a browser + DB are available)
- [ ] Login: empty/invalid/spaces/non-numeric ID; double-click submit; 9-digit success → `/student`; admin PIN → `/admin`; supervisor PIN → `/class-supervisor`; wrong PIN error.
- [ ] Refresh on each role's landing route (O2).
- [ ] Student: checkout (in-quota) → OFF_CAMPUS + undo; undo within 5 min; check-in; urgent request → PENDING with correct status (O5); quota-full banner + overlapping list.
- [ ] Requests page: create single/multi-day; invalid date ranges blocked; cancel/return; list updates.
- [ ] Admin: dashboard stats vs DB; approve/reject urgent; broadcast to all/grade/class/student; export buttons (O3); students filter+search+export matches view (F4); calendar near-midnight (O6); audit log paging (O8).
- [ ] Supervisor: only own class; checkout past-time blocked (F6); labels trimmed (F5).
- [ ] Console & network panels clean on each screen; no infinite spinners; empty states present.
- [ ] Mobile 360/390/430 + landscape; RTL alignment; dark mode.
