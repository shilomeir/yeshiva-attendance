# CLAUDE.md — Strategic Compass for Yeshivat Shavi Hevron Attendance System

> **Read this file before touching any code.** It contains every architectural decision, business rule, and constraint for this project.

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

### Never do
- ❌ Add any UI for creating/editing/importing students (Sheets only).
- ❌ Create new OVERDUE status entries anywhere.
- ❌ Use or restore `addStudent()` — intentionally removed from IApiClient.
- ❌ INSERT into `departures` from any path except `submit_departure` RPC.
- ❌ Call `autoCheckoutStudents()` or `autoReturnStudents()` — replaced by `tick_departures()` cron.
- ❌ Change `calcQuota()` in `src/lib/quota.ts` without also updating the `submit_departure` RPC (and vice versa).
- ❌ Collect GPS during a regular student departure (RollCall only).
- ❌ Compare grade/class strings without `normalizeHebrew()`.

### Always do
- ✅ All departures go through `api.submitDeparture()` → `submit_departure` RPC.
- ✅ Cancel departure = `api.cancelDeparture(id, note)` → `cancel_departure` RPC (sets CANCELLED, retains row).
- ✅ Quota enforcement is server-side inside `submit_departure`. Client shows quota info but never enforces alone.
- ✅ Server-side date calculations = `Asia/Jerusalem` timezone.
- ✅ Both `IApiClient` implementations (`supabaseClient` + `mockClient`) must stay in sync.
- ✅ All dashboards subscribe via `useDeparturesRealtime` hook — one shared channel, not per-page subscriptions.

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
