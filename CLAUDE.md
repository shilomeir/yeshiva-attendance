# CLAUDE.md — Strategic Compass for Yeshivat Shavi Hevron Attendance System

> **Read this file before touching any code.** It contains every architectural decision, business rule, and constraint for this project.

---

## 0. 🏛️ GOLD STANDARD CHARTER — The Locked Core

> **Status (2026-04-27):** The system is live, the connection to Supabase is rock-solid, and the concurrency model below is proven in production. This section is the **constitution** of the project. Treat the Backend (DB schema, RPCs, view, cron, triggers) as an **immutable API**. You may not modify it without the protocol in §0.6.

### 0.1 The Engineering Philosophy

The system used to suffer from front-end "spaghetti" where the client made multiple round-trips to compute quotas, statuses, and overlaps — opening the door to race conditions and inconsistent state across devices. We solved this by **pushing all integrity logic into the database**:

- The DB is the **sole arbiter of truth** for departures, quotas, and status transitions.
- The Edge Functions and the React client are **dumb couriers** of intent — they ask the DB to do something, the DB decides if it's allowed, and the result is broadcast back via Realtime.
- The client never owns the truth, never enforces the quota alone, never advances the state machine, and never inserts into `departures` directly.

### 0.2 The Four Pillars of the Gold Core

> Each pillar below is a load-bearing wall. Removing or modifying it without explicit user approval will reintroduce the race conditions and inconsistencies we worked hard to eliminate.

#### Pillar 1 — The RPC Layer (the only door into `departures`)

Every write to the `departures` table goes through one of these `SECURITY DEFINER` PL/pgSQL functions, defined in `supabase/migrations/20260423_unified_departures.sql`:

| RPC | Lines | Purpose | Allowed transitions |
|-----|-------|---------|---------------------|
| `submit_departure(p_student_id, p_start_at, p_end_at, p_reason, p_is_urgent, p_source, p_approved_by, p_force_pending, p_actor_id, p_actor_role)` | 258–433 | The single entry point for all new departures. Validates time window, denormalizes `class_id`, takes the advisory lock, computes the dynamic quota, decides initial status, inserts the row, and (if `start_at ≤ now`) flips it to `ACTIVE` and the student to `OFF_CAMPUS` in the same transaction. | `(none)` → `PENDING` / `APPROVED` / `ACTIVE`, or returns `QUOTA_FULL` with no insert |
| `approve_departure(p_id, p_actor_id, p_actor_role, p_note)` | 440–503 | `SELECT … FOR UPDATE` then promote `PENDING` → `APPROVED`, or directly to `ACTIVE` if the start time has already passed. | `PENDING` → `APPROVED` / `ACTIVE` |
| `reject_departure(p_id, p_actor_id, p_actor_role, p_note)` | 510–550 | `SELECT … FOR UPDATE` then `PENDING` → `REJECTED` (terminal). | `PENDING` → `REJECTED` |
| `cancel_departure(p_id, p_actor_id, p_actor_role, p_note)` | 560–617 | `SELECT … FOR UPDATE` then any non-terminal → `CANCELLED`. If the cancelled row was `ACTIVE`, the student is returned `ON_CAMPUS` only when no other ACTIVE departure remains for them. | `PENDING` / `APPROVED` / `ACTIVE` → `CANCELLED` |
| `return_departure(p_id, p_student_id, p_gps_lat, p_gps_lng)` | 624–697 | Student presses "חזרתי". `SELECT … FOR UPDATE`, flip `ACTIVE` → `COMPLETED`, append a linked `CHECK_IN` row to `events`, and clear `currentStatus` to `ON_CAMPUS` (gated on no-other-active). | `ACTIVE` → `COMPLETED` |
| `tick_departures()` | 706–782 | The only code that advances the state machine based on wall-clock time. Activates due `APPROVED` rows, completes finished `ACTIVE` rows, refreshes `lastSeen` on overstays (24h+ past `end_at`), and purges terminal rows older than 30 days from `end_at`. | `APPROVED` → `ACTIVE`, `ACTIVE` → `COMPLETED`, hard-DELETE retention |

**Contract:** No application code may `INSERT`/`UPDATE` `departures` outside these RPCs. The only direct queries on the table allowed in `src/lib/api/supabaseClient.ts` are read-only `SELECT`s (push-token lookup at L226–230, analytics aggregates at L578–583 and L597–601). Do not add others — query `v_calendar_departures` instead.

#### Pillar 2 — The Concurrency Model (race conditions, by design, cannot occur)

Three independent guards stack on top of each other:

1. **Per-class advisory lock** — `submit_departure` calls `PERFORM pg_advisory_xact_lock(hashtext(v_class_id))` at line 312, *before* the quota count and *inside the same transaction* as the `INSERT`. Two students from the same class clicking "צא" at the same millisecond serialize through this lock; the second sees the first's row in its quota count. The lock is released on `COMMIT`.
2. **GiST `EXCLUDE` constraint** — `departures_no_overlap` (migration L88–94) uses `btree_gist` to forbid two **live** departures (`status IN ('PENDING','APPROVED','ACTIVE')`) for the same `student_id` whose `tstzrange(start_at, end_at, '[)')` overlaps. This closes the "stack two departures to bypass quota" attack at the storage layer.
3. **Partial unique index** — `departures_one_active_per_student` (L97–99) is a `UNIQUE INDEX … WHERE status = 'ACTIVE'`. Belt-and-suspenders: even if a future RPC bug produced two `ACTIVE` rows for the same student, the DB rejects the second.

In addition, every state-changing RPC (`approve_*`, `reject_*`, `cancel_*`, `return_*`) uses `SELECT … FOR UPDATE` on the row before mutating it, so admins on different devices cannot race to approve and reject the same `PENDING` row.

#### Pillar 3 — The Read Path (`v_calendar_departures` + Realtime)

- **Single read view:** `v_calendar_departures` (migration L146–176) joins `departures` with `students` and exposes only the four "live" statuses (`PENDING / APPROVED / ACTIVE / COMPLETED`) plus an `is_overdue_alert` flag. `CANCELLED` and `REJECTED` rows are filtered out at the view level — admin and supervisor dashboards literally cannot see them by accident. The view is granted to `authenticated` and `anon`.
- **Single client API:** `IApiClient.listDepartures(options)` in `src/lib/api/types.ts:106` is the only TypeScript surface that reads departures; its Supabase implementation (`supabaseClient.ts:299–324`) queries the view and nothing else.
- **Single realtime channel:** `useDeparturesRealtime` (`src/hooks/useDeparturesRealtime.ts`) opens **one** Supabase Realtime channel named `departures-realtime` and forwards `INSERT/UPDATE/DELETE` to the page-level `onAnyChange` callback. Every dashboard subscribes through this hook — never opens its own channel.

  Current consumers (do not duplicate, do not bypass):
  - `src/components/admin/AbsenceCalendar.tsx:104`
  - `src/pages/admin/DashboardPage.tsx:235`
  - `src/pages/admin/PendingRequestsPage.tsx:50`
  - `src/pages/admin/ExceptionsPage.tsx:658`
  - `src/pages/class-supervisor/ClassSupervisorDashboard.tsx:491`
  - `src/pages/student/HomePage.tsx:87`
  - `src/pages/student/HistoryPage.tsx:69`
  - `src/pages/student/AbsenceRequestPage.tsx:81`

#### Pillar 4 — The Automatic Lifecycle (`pg_cron` + the audit trigger)

- **`pg_cron` schedule:** `cron.schedule('tick-departures', '*/1 * * * *', $$SELECT tick_departures()$$)` (migration L948–952). Every 60 seconds, the DB advances time-driven transitions itself. There are **no client-side timers**, no `setInterval` over departures, no Edge Function ticker.
- **Audit trigger:** `departures_audit_trigger_fn` + the `departures_audit_insert` / `departures_audit_update` triggers (migration L186–239) write one row to `admin_overrides` for every `INSERT` and every status change. Auditing is **structurally impossible to forget** — even a manual SQL `UPDATE` from the Supabase dashboard would be logged.
- **Lifecycle timestamps:** Each transition stamps exactly one of `approved_at / activated_at / completed_at / cancelled_at / rejected_at`. The audit log + these timestamps make every departure's full history reconstructable.

### 0.3 What "the Backend is an immutable API" means in practice

You may freely:

- ✅ Read `v_calendar_departures` from any new component.
- ✅ Call any RPC listed in `IApiClient` from any new component.
- ✅ Subscribe to realtime via `useDeparturesRealtime`.
- ✅ Build entirely new screens, animations, layouts, and shadcn/ui components in Hebrew RTL.

You may **not** without explicit user approval (see §0.6):

- ❌ Modify or extend the signature/body of any RPC in §0.2 Pillar 1.
- ❌ Add columns to `departures` or change its constraints (CHECK, EXCLUDE, indexes).
- ❌ Change the `v_calendar_departures` view (added/removed columns, changed `WHERE`).
- ❌ Edit the `tick_departures()` cron function or its `*/1 * * * *` schedule.
- ❌ Edit the audit trigger or remove its `AFTER INSERT/UPDATE` bindings.
- ❌ Add a new direct `INSERT`/`UPDATE` on `departures` from anywhere in `src/`.
- ❌ Open a second Realtime channel on `departures` outside `useDeparturesRealtime`.
- ❌ Edit `calcQuota()` in `src/lib/quota.ts` (it must mirror the RPC formula at migration L319).

### 0.4 Mandatory Pre-flight Scan (run before *every* edit)

Before you write a single line of code, do the following — even for "small" UI tweaks:

1. **Identify the data path.** Which RPC, which view, which realtime hook is the screen you're touching wired into? Open them and read the contracts.
2. **Grep for the RPC name** (`submit_departure`, `cancel_departure`, etc.) to see every call-site, so a UI rename doesn't break an unrelated screen.
3. **Verify the realtime hook is mounted.** If the screen subscribes to `useDeparturesRealtime`, your change must not unmount it conditionally or strip its callback.
4. **Confirm the IApiClient method exists** in both `supabaseClient.ts` *and* `mockClient.ts`. If you add a method, add it in both.
5. **Re-read §0.3.** If your task seems to require crossing into the "may not" list, stop and follow §0.6 before coding.

### 0.5 Creative Sandbox (the front end is yours)

Inside the boundary set by Pillars 1–4, you have a wide brief:

- Use the full **shadcn/ui** + **Tailwind** + **Lucide** vocabulary.
- Hebrew RTL, dark-mode aware via the CSS variables in §17.
- Push the visual language toward "cutting-edge product" — micro-interactions, motion, density, information hierarchy.
- Refactor components, split files, introduce hooks, add stores — as long as the data still flows through the gold core.

### 0.6 The "Intentional Change" Protocol — opening the locked core

If, while planning a UI task, you discover that the backend genuinely needs to change (a new column, a new RPC, a relaxed constraint, a different cron interval), you are the **architect**, not just an executor. Follow this protocol:

1. **Stop.** Do not write any migration, RPC, or `INSERT` code yet.
2. **Diagnose.** Write a short note (in chat, not in a file) explaining:
   - Which Pillar in §0.2 is inadequate for this task and *why*.
   - What can break if we touch it (race conditions, audit gaps, lost rows).
3. **Propose.** Describe your change and *prove* it preserves the invariants:
   - Is the per-class lock still held during quota check? Is overlap still excluded? Is every status mutation still trigger-audited? Does the new path go through a `SECURITY DEFINER` RPC?
4. **Wait for explicit approval.** The user must say "yes, change the core." A general "go ahead" on a UI task is **not** approval to touch the gold core.
5. **Then implement.** Update the migration *and* `calcQuota()` *and* `IApiClient` *and* the mock client *and* this CLAUDE.md (move the new behavior into the relevant Pillar).

This protocol exists because the cost of a quiet regression in the locked core is days of debugging concurrency bugs that only appear under load. The cost of a 60-second pause to ask is zero.

---

## 1. Project Identity

**Name:** Attendance Management System — Yeshivat Shavi Hevron (ישיבת שבי חברון)  
**Type:** PWA (Progressive Web App) + Android APK (Capacitor)  
**Stack:** React 18 + Vite + TypeScript + Supabase + Tailwind CSS + shadcn/ui  
**Language:** Hebrew only. RTL. No i18n support.  
**Deployment:** Vercel (frontend) + Supabase (backend / DB / Edge Functions)  
**Production URL:** https://shavey-hevron.vercel.app

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Google Sheets ──GAS──► sync-from-sheets (Edge Function)    │
│                              │ UPSERT / DELETE students      │
│                              ▼                               │
│  React PWA / Android APK ◄──► Supabase PostgreSQL DB        │
│  (Vite + Zustand + Dexie)    │ Realtime subscriptions       │
│                              │ RPC functions                 │
│                              ▼                               │
│  Edge Functions: send-push, broadcast-location-request       │
└─────────────────────────────────────────────────────────────┘
```

### Iron Rule #1 — Google Sheets is the single source of truth for students
- Students are **created, updated, and deleted ONLY via Google Sheets sync**.
- There is NO UI to add, edit, or import students from the website. Do not add one.
- When sync runs, a student removed from the sheet is **hard-deleted from DB including all history** (cascade).
- Any class change made via the UI (ClassEditModal) is temporary — the next sync overwrites it.

### Iron Rule #2 — No "overdue/late" status
- `OVERDUE` exists in TypeScript types **for backward compatibility with old DB rows only**.
- Never create new OVERDUE status. `markOverdueStudents()` always returns 0.
- In all UI — OVERDUE is displayed and handled **identically to OFF_CAMPUS**.
- Never show the word "איחור" (late/overdue) to any user.

### Iron Rule #3 — One table, one RPC, one ticker
- All departures (student self-submit, admin override, supervisor, SMS) go through the **`submit_departure` RPC** — no other code inserts into `departures`.
- Cancellation calls the **`cancel_departure` RPC** which sets `status='CANCELLED'` (no hard-delete; row retained for 30-day audit window).
- The **`tick_departures()` cron (every 60 s)** is the only code that advances departure state based on time. No client-side timers, no `auto_return_students`.
- The `absence_requests` table no longer exists. The `departures` table is the single source of truth.

---

## 3. Grade & Class Structure

> ⚠️ **These are the EXACT strings stored in the DB.** No apostrophes, no mapping — GAS sends them as-is.

| DB `grade` value | Classes (`classId`) | Students |
|-----------------|---------------------|---------|
| `שיעור א` | `כיתה הרב אבישי` (26), `כיתה הרב בועז` (24), `כיתה הרב הלל` (16), `כיתה הרב יעקב` (25), `כיתה הרב משה` (20), `כיתה הרב תמיר` (28) | 139 |
| `שיעור ב` | `כיתה הרב אהרלה` (23), `כיתה הרב דוד לנדאו` (9), `כיתה הרב דודו` (27), `כיתה הרב מוטי` (24) | 83 |
| `שיעור ג` | `כיתה הרב בועז רויטל` (27), `כיתה הרב חגי` (10), `כיתה הרב רפי` (17) | 54 |
| `שיעור ד-ה` | `כיתה שיעור ד` (17), `כיתה שיעור ה` (3) | 20 |
| `אברכים ובוגרצ` | `כיתה אברכים ובוגרצ` (85) | 85 |

**Total: 5 grade values, 16 classes, 381 students.**

- The `grade` and `classId` strings in the DB are **identical to the tab/header names in Google Sheets**.
- The `sync-from-sheets` Edge Function does **no name mapping** — grade keys from the GAS payload flow directly into `grade`, and `classId` is taken from the sheet row data.
- `classId` always has the `כיתה ` prefix, including single-class grades (e.g. `classId = "כיתה אברכים ובוגרצ"`).

### Sheet tab names (GAS) → DB `grade` values
| GAS payload key | DB `grade` stored |
|----------------|------------------|
| `שיעור א` | `שיעור א` |
| `שיעור ב` | `שיעור ב` |
| `שיעור ג` | `שיעור ג` |
| `שיעור ד-ה` | `שיעור ד-ה` |
| `אברכים ובוגרצ` | `אברכים ובוגרצ` |

### Hebrew string comparison
Grade/class name comparisons MUST use `normalizeHebrew()` (in `studentsStore.ts`) to handle different apostrophe variants (`'` / `'` / `׳`) that may appear in UI dropdowns vs. stored strings. Always compare normalised forms.

---

## 4. Status System

### Student statuses (`currentStatus`)

| Status | Meaning | UI color |
|--------|---------|---------|
| `ON_CAMPUS` | Student is at yeshiva | Green |
| `OFF_CAMPUS` | Student has left (driven by departure `ACTIVE` state) | Orange |
| `OVERDUE` | **Deprecated** — displayed as OFF_CAMPUS everywhere | Orange |
| `PENDING` | Awaiting admin approval (new registration only) | Gray |

### Departure statuses (`departures.status`)

| Status | Meaning |
|--------|---------|
| `PENDING` | Awaiting admin approval (urgent or quota-full requests) |
| `APPROVED` | Approved; start_at not yet reached |
| `ACTIVE` | Student is currently outside (`students.currentStatus = OFF_CAMPUS`) |
| `COMPLETED` | Student returned |
| `REJECTED` | Admin denied |
| `CANCELLED` | Cancelled by student or admin |

### Event types (`events.type`) — immutable audit log

| Type | Action | Status change |
|------|--------|--------------|
| `CHECK_OUT` | Student departs | → OFF_CAMPUS |
| `CHECK_IN` | Student returns | → ON_CAMPUS |
| `OVERRIDE` | Admin manual change | any |
| `SMS_IN` | Return via SMS | → ON_CAMPUS |
| `SMS_OUT` | Departure via SMS | → OFF_CAMPUS |

Events are linked to a departure via `departure_id` FK.

---

## 5. Departure Quota System

### Formula: `GREATEST(1, ROUND((classSize × 3) / 25))`

| Class size | Quota |
|-----------|-------|
| 25 | 3 |
| 26–29 | 3 |
| 30–37 | 4 |
| 38–45 | 5 |
| 46–54 | 6 |
| 85 (אברכים ובוגרצ) | 10 |

**Rules:**
- Quota is calculated from the **actual enrolled student count**, not static capacity.
- Single source of truth: `calcQuota(classSize)` in `src/lib/quota.ts`. Both the client UI and the `submit_departure` RPC use this exact formula.
- `is_urgent = true` → departure goes to `PENDING` state (bypasses quota; admin reviews).
- `source = 'ADMIN_OVERRIDE'` → `APPROVED` immediately, quota not checked.
- The `submit_departure` RPC holds `pg_advisory_xact_lock(hashtext(class_id))` for the entire transaction — quota check and insert are atomic.

---

## 6. Departure Lifecycle

### State machine
```
submit_departure(RPC)
    │
    ├── quota ok, non-urgent, non-override → APPROVED
    │       └── start_at ≤ now (tick) → ACTIVE → COMPLETED (tick / return)
    ├── is_urgent = true → PENDING
    │       └── admin approves → APPROVED → ACTIVE → COMPLETED
    │       └── admin rejects → REJECTED (terminal)
    ├── quota full + force_pending = true → PENDING (admin decides)
    └── quota full + force_pending = false → QUOTA_FULL result (no row inserted)

(any non-terminal) ─── cancel_departure(RPC) ──► CANCELLED
```

### Rules
- `start_at` / `end_at` are **full TIMESTAMPTZ** in `Asia/Jerusalem` — no HH:MM strings.
- `is_urgent = true` → always PENDING, notifies admin with push (edge function `notify-admin-quota-full`).
- Approval push message: _"בוקר טוב! היציאה שלך אושרה, לך בשלום 🎉"_
- Every lifecycle transition (approve / reject / cancel / override) is logged in `admin_overrides` via DB trigger.
- `CANCELLED` / `REJECTED` rows are retained for 30 days (purged by `tick_departures()`), not shown in calendar.
- The view `v_calendar_departures` includes `PENDING / APPROVED / ACTIVE / COMPLETED` — all other states are hidden.

---

## 7. Three-Tier Authentication

### Student
- Login by **ID number only** (no password currently — planned for future).
- `deviceToken` (UUID) stored in `localStorage`, used for offline sync device identification.

### Admin
- PIN stored in `app_settings` under key `admin_pin` (plaintext — known limitation).
- Full access to all pages and actions.

### Class Supervisor (רכז כיתה)
- PIN format: `{adminPin}{classCode}` (3-digit code, e.g. `1234001`).
- Class codes auto-generated on sync, stored in `app_settings` as `class_code_{classId}`.
- **If Admin PIN changes — all supervisors need new PINs. No automatic notification — manual process.**
- Supervisor can only view/manage their assigned class.
- All supervisor actions are logged in `admin_overrides`.

---

## 8. Google Sheets ↔ Supabase Sync

### Flow
1. Admin checks checkbox in cell A1 of the sheet.
2. GAS trigger (`onSheetEdit`) fires.
3. GAS parses all tabs (`parseTab`) and POSTs to Edge Function `sync-from-sheets`.
4. Edge Function UPSERTs students by `idNumber`, hard-deletes students missing from sheet.

### Critical sync rules
- **One-way sync: Sheets → DB only.**
- Student deleted from sheet → deleted from DB including all event history.
- Class edits via UI are overwritten on next sync.
- Sheet handles leading-zero ID numbers (pads to 9 digits).
- Class section headers identified by **font size ≥ 14** and containing "כית".

---

## 9. Database Schema (Supabase)

> ⚠️ All camelCase column names are **quoted in SQL** (e.g. `"classId"`, `"currentStatus"`).

### `students`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `idNumber` | TEXT | Unique, 9-digit Israeli ID |
| `fullName` | TEXT | |
| `phone` | TEXT | |
| `grade` | TEXT | Grade name (see mapping table) |
| `classId` | TEXT | Unique within grade |
| `currentStatus` | TEXT | ON_CAMPUS / OFF_CAMPUS / OVERDUE / PENDING |
| `lastSeen` | TIMESTAMPTZ | |
| `lastLocation` | JSONB | `{lat, lng}` |
| `deviceToken` | TEXT | UUID for offline sync |
| `push_token` | TEXT | Web Push subscription JSON |
| `fcm_token` | TEXT | Firebase (Android APK only) |
| `pendingApproval` | BOOLEAN | |
| `createdAt` | TIMESTAMPTZ | |

### `events`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `studentId` | UUID | FK → students |
| `type` | TEXT | CHECK_IN / CHECK_OUT / OVERRIDE / SMS_IN / SMS_OUT |
| `timestamp` | TIMESTAMPTZ | |
| `reason` | TEXT | Departure reason (optional) |
| `expectedReturn` | TIMESTAMPTZ | Expected return time |
| `gpsLat` / `gpsLng` | FLOAT | GPS at time of event |
| `gpsStatus` | TEXT | GRANTED / DENIED_BY_USER / UNAVAILABLE / PENDING |
| `distanceFromCampus` | FLOAT | Meters from campus |
| `note` | TEXT | Admin note |
| `syncedAt` | TIMESTAMPTZ | null = not yet synced from offline queue |

### `departures`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `student_id` | UUID | FK → students (CASCADE) |
| `class_id` | TEXT | Denormalized at submission time |
| `start_at` | TIMESTAMPTZ | Full timestamp (Asia/Jerusalem) |
| `end_at` | TIMESTAMPTZ | Must be > start_at and < start_at + 30 days |
| `status` | TEXT | PENDING / APPROVED / ACTIVE / COMPLETED / REJECTED / CANCELLED |
| `source` | TEXT | SELF / ADMIN_OVERRIDE / SUPERVISOR / SMS / SHEETS |
| `is_urgent` | BOOLEAN | True → PENDING regardless of quota |
| `reason` | TEXT | Optional departure reason |
| `admin_note` | TEXT | Admin note on approve/reject |
| `approved_by` | TEXT | Actor ID who approved |
| `created_at / approved_at / activated_at / completed_at / cancelled_at / rejected_at` | TIMESTAMPTZ | One non-null per lifecycle event |
| `gps_lat / gps_lng` | FLOAT | Filled on CHECK_IN events only |

**Key constraint:** GiST EXCLUDE prevents a student from having two overlapping live departures.

### `admin_overrides` — Audit Log
Every admin/supervisor lifecycle action is recorded here automatically (DB trigger on `departures`).

### `app_settings` — Key-value config
- `admin_pin` — admin PIN
- `class_code_{classId}` — 3-digit supervisor code

---

## 10. RPC Functions (Supabase)

### `submit_departure(p_student_id, p_start_at, p_end_at, p_reason, p_is_urgent, p_source, p_approved_by, p_force_pending, p_actor_id, p_actor_role)`
- **The single entry point for all departures.** No other code inserts into `departures`.
- Holds `pg_advisory_xact_lock(hashtext(class_id))` — quota check + insert are atomic.
- **Returns:** `{id, status, quota, current}` (success) or `{status:'QUOTA_FULL', current, quota, overlapping:[...]}` (no row inserted) or `{error}`.
- **Migration:** `supabase/migrations/20260423_unified_departures.sql`

### `approve_departure(p_id, p_actor_id, p_actor_role, p_note)`
- Transitions PENDING → APPROVED; sends push to student.

### `reject_departure(p_id, p_actor_id, p_actor_role, p_note)`
- Transitions PENDING → REJECTED; no push to student.

### `cancel_departure(p_id, p_actor_id, p_actor_role, p_note)`
- Transitions any non-terminal state → CANCELLED.

### `return_departure(p_id)`
- Student presses "חזרתי" — transitions ACTIVE → COMPLETED; sets `students.currentStatus = ON_CAMPUS`.

### `tick_departures()`
- pg_cron job, runs every 60 s.
- Activates APPROVED → ACTIVE when `start_at ≤ now`.
- Completes ACTIVE → COMPLETED when `end_at ≤ now`.
- Flags overstay alerts (`ACTIVE AND end_at < now - 24h`).
- Purges COMPLETED/CANCELLED/REJECTED rows older than 30 days.
- **Replaces** the old `auto_return_students()` and `auto_checkout_students()` RPCs.

### Deprecated (removed)
`create_checkout_with_quota_check`, `auto_return_students`, `auto_checkout_students`, `mark_overdue_students`, `checkAbsenceQuota` — all deleted in migration `20260423_unified_departures.sql`.

---

## 11. Push Notifications

### Web Push (PWA)
- Registered during student login (`registerPushSubscription`).
- Stored as JSON in `students.push_token`.
- Sent via Edge Function `send-push` (VAPID + AES-128-GCM / RFC 8291).
- **Use case:** Absence request approval notification.

### Firebase Cloud Messaging (Android APK only)
- Token stored in `students.fcm_token`.
- Sent via Edge Function `broadcast-location-request`.
- **Use case:** Internal audit (ביקורת פנימית) — silently wakes APK in background to report GPS.
- iPhone/PWA users have no FCM — they do not respond to audit broadcasts.

---

## 12. GPS & Location

| Category | Distance | Color |
|----------|---------|-------|
| On campus | ≤ 300m | Green |
| In area (Hebron) | 300m – 5km | Orange |
| Far | > 5km | Red |

- **Campus coordinates:** `LAT=31.5253, LNG=35.1056`
- GPS is collected **only** during admin's internal audit (RollCall) — NOT during regular student departures.

---

## 13. Offline Support

- **IndexedDB (Dexie):** Local storage for events, students, syncQueue.
- **When offline:** Operations saved to `syncQueue`, synced when connection returns.
- **Sync triggers:** App comes online, app returns to foreground, every 30 seconds.
- **Conflict resolution:** Offline operations are replayed in order on reconnect. If admin changed status in the meantime, offline op may overwrite it. **Known limitation — no resolution in current version.**

---

## 14. Three User Interfaces

### Student (`/student`)
- **Home:** CHECK_IN / CHECK_OUT buttons, current status, approved departure banner, cancel departure option.
- **Requests:** Submit absence request (single-day / multi-day / urgent).
- **History:** Event list.
- **UX:** Mobile-first. All Hebrew RTL.

### Admin (`/admin`)
- **Dashboard:** Stats, charts, push broadcast.
- **Students:** List with grade/class/status/search filters. **Read-only — no add/import.** Excel export available.
- **Requests:** Approve / reject pending requests.
- **RollCall (ביקורת פנימית):** Broadcast GPS request to all devices.
- **Audit Log:** All admin actions.
- **Settings:** Change admin PIN.

### Class Supervisor (`/class-supervisor`)
- **Dashboard:** Their class students only, statuses, history.
- All supervisor actions logged in `admin_overrides`.

---

## 15. Project File Structure

```
src/
├── App.tsx                     # Main routing (React Router)
├── pages/
│   ├── student/                # Student pages
│   ├── admin/                  # Admin pages
│   └── class-supervisor/       # Supervisor dashboard
├── components/
│   ├── admin/                  # Admin UI components
│   ├── student/                # StatusButtons, OffCampusSheet
│   ├── shared/                 # StatusBadge, SyncStatusBar, SplashScreen
│   ├── analytics/              # Charts (recharts)
│   ├── auth/                   # LoginScreen, AdminLoginModal
│   └── ui/                     # shadcn/ui primitives
├── store/
│   ├── authStore.ts            # Auth state (deviceToken persisted)
│   ├── studentsStore.ts        # Student list + filters + normalizeHebrew()
│   ├── syncStore.ts            # Offline sync status
│   └── uiStore.ts              # Theme, sidebar (persisted)
├── hooks/
│   └── useDeparturesRealtime.ts  # Shared Realtime subscription on departures table
├── lib/
│   ├── api/
│   │   ├── supabaseClient.ts   # IApiClient implementation
│   │   ├── mockClient.ts       # Mock implementation (dev/offline)
│   │   └── types.ts            # IApiClient interface
│   ├── constants/grades.ts     # GRADE_LEVELS, getClasses, ALL_CLASS_IDS
│   ├── db/schema.ts            # Dexie (IndexedDB) schema
│   ├── quota.ts                # calcQuota(classSize) — single formula for client + mock
│   ├── sync/syncEngine.ts      # Offline sync engine (supports RPC operations)
│   ├── location/gps.ts         # GPS utils + Haversine distance
│   └── sms/parser.ts           # Hebrew SMS message parser
├── types/index.ts              # All TypeScript types
supabase/
├── migrations/
│   ├── 20260405_quota_rpc.sql
│   ├── 20260405_overdue_transition.sql
│   ├── 20260406_auto_return.sql
│   ├── fix_checkout_and_push_token.sql
│   ├── 20260409_dynamic_quota.sql
│   └── 20260423_unified_departures.sql  ← CURRENT schema (departures table, RPCs, cron)
└── functions/
    ├── sync-from-sheets/           # GAS → Supabase sync (transactional)
    ├── send-push/                  # Web Push (RFC 8291)
    ├── notify-admin-quota-full/    # Push to admins when PENDING created due to quota-full
    └── broadcast-location-request/ # FCM broadcast
GoogleAppsScript.gs             # GAS code for sheet sync
```

---

## 16. Environment Variables

### Frontend (`.env.local`)
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_VAPID_PUBLIC_KEY=
```

### Supabase Edge Function Secrets
```
SHEETS_SYNC_SECRET       # Shared secret with GAS
FCM_SERVER_KEY           # Firebase (RollCall audit)
VAPID_PUBLIC_KEY         # Web Push
VAPID_PRIVATE_KEY        # Web Push
VAPID_SUBJECT            # mailto:... for VAPID
```

---

## 17. Design & UX Rules

- **Language:** Hebrew only. No English strings in UI.
- **Direction:** RTL. Use `start`/`end` not `left`/`right` in Tailwind.
- **CSS Variables:** `--text`, `--text-muted`, `--bg`, `--bg-2`, `--surface`, `--border`, `--blue`, `--green`, `--orange`, `--red`.
- **Dark mode:** Every component must support dark mode via CSS variables.
- **Mobile-first:** Student interface designed for mobile. Admin interface is responsive.
- **Toasts:** Every significant action gets a toast notification.

---

## 18. Development Rules

> **Read §0 first.** §0 is the constitution; this section is the day-to-day enforcement of it. If a rule here ever disagrees with §0, §0 wins.

### Never do
- ❌ Touch the locked core in §0.2 without approval via the §0.6 protocol.
- ❌ Skip the §0.4 pre-flight scan, even for "tiny" UI changes.
- ❌ Add any UI for creating/editing/importing students (Sheets only).
- ❌ Create new OVERDUE status entries anywhere.
- ❌ Use or restore `addStudent()` — intentionally removed from IApiClient.
- ❌ INSERT into `departures` from any path except `submit_departure` RPC.
- ❌ Call `autoCheckoutStudents()` or `autoReturnStudents()` — replaced by `tick_departures()` cron.
- ❌ Change `calcQuota()` in `src/lib/quota.ts` without also updating the `submit_departure` RPC (and vice versa).
- ❌ Open a second Supabase Realtime channel on `departures` outside `useDeparturesRealtime`.
- ❌ Collect GPS during a regular student departure (RollCall only).
- ❌ Compare grade/class strings without `normalizeHebrew()`.

### Always do
- ✅ Run the §0.4 pre-flight scan before editing any file that touches departures, quotas, or status.
- ✅ All departures go through `api.submitDeparture()` → `submit_departure` RPC.
- ✅ Cancel departure = `api.cancelDeparture(id, note)` → `cancel_departure` RPC (sets CANCELLED, retains row).
- ✅ Quota enforcement is server-side inside `submit_departure`. Client shows quota info but never enforces alone.
- ✅ Read departures via `api.listDepartures()` → `v_calendar_departures` view (not the raw table).
- ✅ Server-side date calculations = `Asia/Jerusalem` timezone.
- ✅ Both `IApiClient` implementations (`supabaseClient` + `mockClient`) must stay in sync.
- ✅ All dashboards subscribe via `useDeparturesRealtime` hook — one shared channel, not per-page subscriptions.
- ✅ Treat the front end as the creative sandbox (§0.5); treat the backend as an immutable API (§0.3).

---

## 19. Known Debt (TODO)

- [ ] Add password authentication for students (currently ID-only).
- [ ] Supabase Row Level Security (RLS) — currently all students can read all data; `source='ADMIN_OVERRIDE'` validation is PIN-based only until RLS arrives.
- [ ] Automatic notification to supervisors when Admin PIN changes.
- [ ] Time-restricted quota (currently 24/7).
- [ ] Offline conflict resolution (currently last-write-wins; if server returns `QUOTA_FULL` for an offline-queued departure, a toast informs the student on reconnect).
- [ ] Automated tests (unit / integration).
- [x] Apply `20260423_unified_departures.sql` migration in Supabase Dashboard SQL Editor (main schema migration for unified departures). ✅ Applied 2026-04-26.

---

## 20. Quick Reference — FAQ

**Q: Student tries to leave but quota is full. What can they do?**  
A: The UI shows the `overlapping` list (classmates currently out + their return times). Student can wait, or press "בקש אישור" to send the request as PENDING for admin to decide.

**Q: Student accidentally pressed checkout. Can they undo?**  
A: Yes — cancellation calls `cancel_departure` RPC which sets `status='CANCELLED'`. The departure row is retained for audit (30-day window) but hidden from all dashboards.

**Q: Is a class edit via ClassEditModal permanent?**  
A: No — next Google Sheets sync overwrites it.

**Q: Admin changed PIN. Do supervisors get notified?**  
A: No — must notify them manually.

**Q: What happens to a student with OVERDUE status in the DB?**  
A: Displayed as OFF_CAMPUS in all UI. No new OVERDUE entries are ever created. `auto_return_students` will return them when `expectedReturn` passes.
