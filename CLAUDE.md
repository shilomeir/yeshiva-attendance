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

### Iron Rule #3 — Cancelling a departure hard-deletes the event
- When a student (or admin) cancels a departure — the event is **deleted from DB** (`deleteEvent`).
- No counter CHECK_IN is created. Status is reset to ON_CAMPUS directly via `updateStudentStatus`.
- This applies **regardless of time elapsed** — no difference between cancelling after 2 minutes or 2 hours.

---

## 3. Grade & Class Structure

| Grade | Hebrew Name | Classes | Capacity per class |
|-------|-------------|---------|-------------------|
| 1st year | שיעור א' | 6 (כיתה 1–6) | 25 |
| 2nd year | שיעור ב' | 4 (כיתה 1–4) | 25 |
| 3rd year | שיעור ג' | 3 (כיתה 1–3) | 25 |
| 4th year | שיעור ד' | 1 (classId = grade name) | 25 |
| Advanced | אברכים | 1 (classId = grade name) | 50 |
| Graduates | בוגרצים | 1 (classId = grade name) | 50 |

**Total: 16 classes, ~400 students.**

- Single-class grades: `classId === gradeName` (e.g. `classId = "אברכים"`).
- Multi-class grades: `classId = "${gradeName} כיתה ${n}"` (e.g. `"שיעור א' כיתה 3"`).

### Sheet tab names vs DB grade names
| Sheet tab (`SHEET_GRADE_NAMES`) | DB value (`GRADE_LEVELS`) |
|---------------------------------|--------------------------|
| שיעור א' | שיעור א' |
| שיעור ב' | שיעור ב' |
| שיעור ג' | שיעור ג' |
| שיעור ד'-ה' | שיעור ד' |
| אברכים ובוגרצ' | אברכים / בוגרצים |

The mapping between sheet names and DB names is handled inside the `sync-from-sheets` Edge Function.

### Hebrew string comparison
Grade/class name comparisons MUST use `normalizeHebrew()` (in `studentsStore.ts`) to handle different apostrophe variants (`'` / `'` / `׳`). This was the root cause of the student filter bug.

---

## 4. Status System

### Student statuses (`currentStatus`)

| Status | Meaning | UI color |
|--------|---------|---------|
| `ON_CAMPUS` | Student is at yeshiva | Green |
| `OFF_CAMPUS` | Student has left | Orange |
| `OVERDUE` | **Deprecated** — displayed as OFF_CAMPUS everywhere | Orange |
| `PENDING` | Awaiting admin approval (new registration only) | Gray |

### Event types (`events.type`)

| Type | Action | Status change |
|------|--------|--------------|
| `CHECK_OUT` | Student departs | → OFF_CAMPUS |
| `CHECK_IN` | Student returns | → ON_CAMPUS |
| `OVERRIDE` | Admin manual change | any |
| `SMS_IN` | Return via SMS | → ON_CAMPUS |
| `SMS_OUT` | Departure via SMS | → OFF_CAMPUS |

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
| 50 (אברכים/בוגרצים) | 6 |

**Rules:**
- Quota is calculated from the **actual enrolled student count**, not static capacity.
- The formula is identical server-side (RPC `create_checkout_with_quota_check`) and client-side (`calcQuota()` in OffCampusSheet.tsx).
- A student with an **approved urgent absence request** is **exempt from quota** for the entire request period (`date` → `endDate`).
- Admin OVERRIDE bypasses quota entirely — no check performed.
- The RPC uses an advisory lock (`pg_try_advisory_xact_lock`) to prevent race conditions.

---

## 6. Absence Requests

### Lifecycle
```
Student submits → PENDING
    ↓
Admin reviews:
  APPROVED → student receives push notification
  REJECTED → no notification
  CANCELLED → cancelled by admin
    ↓
Student returns → prompt to cancel the request
```

### Rules
- Requests can be **single-day** (`date`) or **multi-day** (`date` to `endDate`).
- `startTime` / `endTime` are HH:MM strings (hours within a day).
- `isUrgent = true` → exempt from quota for the full period.
- Approval push message: _"בוקר טוב! היציאה שלך אושרה, לך בשלום 🎉"_
- Every action (approve / reject / cancel) is **logged in `admin_overrides`** (audit trail).

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

### `absence_requests`
| Column | Notes |
|--------|-------|
| `date` | Start date YYYY-MM-DD |
| `endDate` | End date (optional, multi-day requests) |
| `startTime` / `endTime` | HH:MM |
| `status` | PENDING / APPROVED / REJECTED / CANCELLED |
| `isUrgent` | boolean — quota exempt |

### `admin_overrides` — Audit Log
Every admin action is recorded here: approve/reject requests, manual status override, departure cancellation.

### `app_settings` — Key-value config
- `admin_pin` — admin PIN
- `class_code_{classId}` — 3-digit supervisor code

---

## 10. RPC Functions (Supabase)

### `create_checkout_with_quota_check(p_student_id, p_class_id, p_grade, p_reason, p_expected_return)`
- **Does:** Checks quota + creates CHECK_OUT event **atomically**.
- **Quota:** Dynamic — `GREATEST(1, ROUND((class_size × 3)::numeric / 25))`.
- **Exempt from quota:** Students with approved urgent request covering today's date range.
- **Returns:** `{success: true, eventId}` or `{success: false, error, current, quota}`.
- **Timezone:** Uses `Asia/Jerusalem` for date calculations.
- **Latest migration:** `20260409_dynamic_quota.sql`

### `auto_return_students()`
- **Does:** Returns students to ON_CAMPUS when `expectedReturn` has passed.
- **Returns:** Count of students returned.
- **Trigger:** Called manually from DashboardPage. No cron job yet.

### `mark_overdue_students()` — **Disabled**
- Always returns 0. Kept for backward compatibility only.

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
├── lib/
│   ├── api/
│   │   ├── supabaseClient.ts   # IApiClient implementation
│   │   ├── mockClient.ts       # Mock implementation (dev/offline)
│   │   └── types.ts            # IApiClient interface
│   ├── constants/grades.ts     # GRADE_LEVELS, getClasses, ALL_CLASS_IDS
│   ├── db/schema.ts            # Dexie (IndexedDB) schema
│   ├── sync/syncEngine.ts      # Offline sync engine
│   ├── location/gps.ts         # GPS utils + Haversine distance
│   └── sms/parser.ts           # Hebrew SMS message parser
├── types/index.ts              # All TypeScript types
supabase/
├── migrations/
│   ├── 20260405_quota_rpc.sql
│   ├── 20260405_overdue_transition.sql
│   ├── 20260406_auto_return.sql
│   ├── fix_checkout_and_push_token.sql
│   └── 20260409_dynamic_quota.sql   ← CURRENT quota logic
└── functions/
    ├── sync-from-sheets/       # GAS → Supabase sync
    ├── send-push/              # Web Push (RFC 8291)
    └── broadcast-location-request/  # FCM broadcast
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
- ❌ Change quota formula in OffCampusSheet without also updating the RPC (and vice versa).
- ❌ Collect GPS during a regular student departure (RollCall only).
- ❌ Compare grade/class strings without `normalizeHebrew()`.

### Always do
- ✅ Log every admin action to `admin_overrides`.
- ✅ Cancel departure = `deleteEvent(id)` + `updateStudentStatus('ON_CAMPUS')`.
- ✅ Quota enforcement = always through RPC, never client-side only.
- ✅ Server-side date calculations = `Asia/Jerusalem` timezone.
- ✅ Both `IApiClient` implementations (`supabaseClient` + `mockClient`) must stay in sync.

---

## 19. Known Debt (TODO)

- [ ] Add password authentication for students (currently ID-only).
- [ ] Supabase Row Level Security (RLS) — currently all students can read all data.
- [ ] Automatic notification to supervisors when Admin PIN changes.
- [ ] Time-restricted quota (currently 24/7).
- [ ] Offline conflict resolution (currently last-write-wins).
- [ ] Schedule `auto_return_students` as a cron job (currently manual).
- [ ] Automated tests (unit / integration).
- [ ] Apply `20260409_dynamic_quota.sql` migration in Supabase Dashboard SQL Editor.

---

## 20. Quick Reference — FAQ

**Q: Student tries to leave but quota is full. What can they do?**  
A: Wait for a classmate to return (system shows expected return times) — or submit an urgent absence request (`isUrgent = true`).

**Q: Student accidentally pressed checkout. Can they undo?**  
A: Yes — 5-minute window. Cancellation hard-deletes the event from DB (no trace remains in history).

**Q: Is a class edit via ClassEditModal permanent?**  
A: No — next Google Sheets sync overwrites it.

**Q: Admin changed PIN. Do supervisors get notified?**  
A: No — must notify them manually.

**Q: What happens to a student with OVERDUE status in the DB?**  
A: Displayed as OFF_CAMPUS in all UI. No new OVERDUE entries are ever created. `auto_return_students` will return them when `expectedReturn` passes.
