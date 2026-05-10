# Yeshiva Attendance System — Technical Execution Plan

**Based on:** plan-review-notes-v4.txt (47 code-grounded findings, line-by-line audit)  
**Date:** 2026-05-10  
**Branch:** claude/review-system-plan-LxyuO  
**Status:** PLANNING DOCUMENT — Do NOT implement without explicit approval

---

## Architecture Decisions (Confirmed by User)

| Decision | Confirmed |
|---|---|
| Students: ID number only, no password, no Supabase Auth accounts | ✅ |
| Admin dashboard is primary student management (add/edit/delete from UI) | ✅ |
| Sync from Sheets = optional/annual import — NOT a destructive source of truth | ✅ |
| Sync must NOT overwrite currentStatus, push_token, fcm_token, deviceToken | ✅ |
| Supervisors: always only their own class, forever. Cross-class = future feature only | ✅ |
| Hard delete students from dashboard triggers CASCADE (preserves existing behavior) | ✅ |
| Only 1 admin account, forever | ✅ |
| No staging environment — apply directly to production | ✅ |

---

## Critical: Read Before Starting

**Authentication reality:** Students log in with ID number only — they have NO Supabase Auth accounts. They call the Supabase API using the **anon key**, which is public and embedded in the PWA bundle. This has a direct consequence for Step 4's security work: you CANNOT revoke anon access from any RPC that students call until a student auth system is in place. This is documented explicitly in Step 4A.

**Dependency chain:** Step 1C adds `lastAttemptAt` usage to `syncEngine.ts`, but the Dexie schema that stores this field is updated in Step 7C. Do Step 7C's schema migration first if you want Step 1C to work cleanly. Alternatively, add `lastAttemptAt` to the Dexie schema as part of Step 1C (recommended — it's a one-line schema change).

---

## Step 1 — Emergency Production Fixes (1 Day)

These are **active defects in production today**. Fix all five before starting any refactor.

### 1A: Fix sync-from-sheets overwriting student status (BUG B)

**File:** `supabase/functions/sync-from-sheets/index.ts:99`  
**Problem:** Every sync runs `currentStatus: 'ON_CAMPUS'` for every student row in the upsert. A student who is currently OUTSIDE (ACTIVE departure) gets their DB status silently reset to ON_CAMPUS. No error. No log. Quota and dashboard are now wrong.

**Fix — Create a server-side RPC that only updates safe columns:**

```sql
-- Migration: 20260510_sync_student_rpc.sql
-- Apply in Supabase SQL Editor before modifying the Edge Function

CREATE OR REPLACE FUNCTION sync_student_from_sheet(
  p_id_number TEXT,
  p_full_name TEXT,
  p_phone     TEXT,
  p_grade     TEXT,
  p_class_id  TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO students (
    "idNumber", "fullName", phone, grade, "classId",
    "currentStatus", "lastSeen", "createdAt"
  )
  VALUES (
    p_id_number, p_full_name, p_phone, p_grade, p_class_id,
    'ON_CAMPUS', now(), now()
  )
  ON CONFLICT ("idNumber") DO UPDATE SET
    "fullName" = EXCLUDED."fullName",
    grade      = EXCLUDED.grade,
    "classId"  = EXCLUDED."classId",
    phone      = EXCLUDED.phone;
    -- NEVER updated on conflict:
    -- "currentStatus" — could be OFF_CAMPUS right now (active departure)
    -- push_token      — registered on the student's device, not in the sheet
    -- fcm_token       — same
    -- "deviceToken"   — same
    -- "lastSeen"      — reflects actual last activity
END;
$$;
```

**Fix — Update sync function to call the RPC in batches (not one-by-one):**

PostgREST's bulk upsert cannot exclude individual columns per-row, which is why we use an RPC. However, calling the RPC 381 times in a loop would create 381 sequential round-trips inside the Edge Function — too slow and likely to hit timeouts. Instead, batch the calls:

```typescript
// supabase/functions/sync-from-sheets/index.ts
// Replace the bulk upsert block with batched RPC calls

const BATCH_SIZE = 50

async function syncStudentsToDb(students: SheetStudent[]) {
  // Process in chunks of 50 to avoid timeout
  for (let i = 0; i < students.length; i += BATCH_SIZE) {
    const batch = students.slice(i, i + BATCH_SIZE)
    await Promise.all(
      batch.map(student =>
        supabase.rpc('sync_student_from_sheet', {
          p_id_number: student.idNumber,
          p_full_name: student.fullName,
          p_phone:     student.phone,
          p_grade:     student.grade,
          p_class_id:  student.classId,
        })
      )
    )
  }
}
```

**Completion test:** Student is OFF_CAMPUS with ACTIVE departure → trigger sync → `SELECT "currentStatus" FROM students WHERE "idNumber" = '...'` → must return `OFF_CAMPUS`, not `ON_CAMPUS`.

---

### 1B: Remove phantom class IDs — and all code that generates them (BUG C)

**File:** `src/lib/constants/grades.ts:21–25`  
**Problem:** `getClasses()` generates IDs like `"שיעור א כיתה 1"` by counting `classCount`. Real DB values are `"כיתה הרב אבישי"` etc. (CLAUDE.md §3). These phantom IDs are used in `supervisorAuth.ts:22-49` (`parseClassSupervisorSuffix`), causing supervisors to always be assigned a classId that returns zero students.

**Fix — Replace with exact hardcoded data from CLAUDE.md §3:**

```typescript
// src/lib/constants/grades.ts — REPLACE getClasses() and ALL_CLASS_IDS entirely

export const GRADE_CLASS_MAP: Record<string, string[]> = {
  'שיעור א': [
    'כיתה הרב אבישי',
    'כיתה הרב בועז',
    'כיתה הרב הלל',
    'כיתה הרב יעקב',
    'כיתה הרב משה',
    'כיתה הרב תמיר',
  ],
  'שיעור ב': [
    'כיתה הרב אהרלה',
    'כיתה הרב דוד לנדאו',
    'כיתה הרב דודו',
    'כיתה הרב מוטי',
  ],
  'שיעור ג': [
    'כיתה הרב בועז רויטל',
    'כיתה הרב חגי',
    'כיתה הרב רפי',
  ],
  'שיעור ד-ה': [
    'כיתה שיעור ד',
    'כיתה שיעור ה',
  ],
  'אברכים ובוגרצ': [
    'כיתה אברכים ובוגרצ',
  ],
}

export const ALL_CLASS_IDS: string[] = Object.values(GRADE_CLASS_MAP).flat()

// getClasses() is DELETED — it generated wrong values
// ALL callers of getClasses() must switch to GRADE_CLASS_MAP[gradeName] or ALL_CLASS_IDS
```

**Also delete `parseClassSupervisorSuffix` in `src/lib/auth/supervisorAuth.ts:22-49`:**  
This function derives classIds by generating the same phantom format. It must be deleted. After Step 6, supervisor class IDs come from the `supervisor_classes` table, not from this function.

**Find all usages before deleting:**

```bash
grep -rn "ALL_CLASS_IDS\|getClasses\|parseClassSupervisorSuffix" src/
```

Replace each usage with either `ALL_CLASS_IDS` (for flat list) or `GRADE_CLASS_MAP[grade]` (for grade-specific lists).

---

### 1C: Fix sync queue retry storm (BUG E)

**File:** `src/lib/sync/syncEngine.ts:5,73`  
**Problem:** `STUCK_RETRY_THRESHOLD = 3` only controls the UI badge — it doesn't stop retries. Dead items retry every 30s + every online/foreground event, forever. The queue accumulates garbage indefinitely.

**Prerequisite:** Add `lastAttemptAt` to the Dexie syncQueue schema NOW (not in Step 7C):

```typescript
// src/lib/db/schema.ts — add lastAttemptAt to syncQueue during this step
// Bump Dexie version to 4 here if you haven't already:
syncQueue: '++id, type, retryCount, lastAttemptAt',
```

**Fix `processQueue()`:**

```typescript
// src/lib/sync/syncEngine.ts

// Replace STUCK_RETRY_THRESHOLD with:
const MAX_RETRIES = 10
const BACKOFF_BASE_MS = 30_000  // 30 seconds initial; doubles each retry

async function processQueue() {
  const items = await db.syncQueue.toArray()

  for (const item of items) {
    // Dead-letter: permanently remove items that have exhausted retries
    if (item.retryCount >= MAX_RETRIES) {
      await db.syncQueue.delete(item.id)
      console.error('[SyncEngine] Dead-letter item removed:', item)
      toast.error(`פעולה נכשלה לצמיתות: ${item.type}`)
      continue
    }

    // Exponential backoff: skip items not yet ready for retry
    const lastAttempt = item.lastAttemptAt ?? 0
    const nextRetryAt = lastAttempt + BACKOFF_BASE_MS * Math.pow(2, item.retryCount)
    if (Date.now() < nextRetryAt) continue

    // Mark attempt timestamp BEFORE the network call
    await db.syncQueue.update(item.id, { lastAttemptAt: Date.now() })

    try {
      await replayItem(item)
      await db.syncQueue.delete(item.id)  // Success: remove from queue
    } catch (err) {
      await db.syncQueue.update(item.id, { retryCount: item.retryCount + 1 })
    }
  }
}
```

---

### 1D: Add idNumber correction RPC (BUG D)

**Problem:** Correcting a typo in a student's ID number in Google Sheets causes sync to hard-delete the old row (CASCADE deletes all departures and events) and create a fresh row with zero history.

**Fix — Safe correction RPC:**

```sql
-- Migration: 20260510_correct_student_id_rpc.sql

CREATE OR REPLACE FUNCTION correct_student_id_number(
  p_old_id TEXT,
  p_new_id TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Updates only the idNumber field. The student's UUID (primary key) stays the same.
  -- All FK relationships (departures.student_id, events.studentId) are unaffected
  -- because they reference the UUID, not idNumber.
  UPDATE students SET "idNumber" = p_new_id WHERE "idNumber" = p_old_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student with idNumber % not found', p_old_id;
  END IF;
END;
$$;
```

**Add to CLAUDE.md section 8 (Sync):**

> **CRITICAL — Before correcting an idNumber in Google Sheets:**  
> Run this in the Supabase SQL Editor FIRST:  
> `SELECT correct_student_id_number('OLD_ID', 'NEW_ID');`  
> Then run the sync. If you sync first, all history is destroyed.

---

### 1E: Fix sync queue idempotency for INSERT operations (GAP 4)

**File:** `src/lib/sync/syncEngine.ts:54–56`  
**Problem:** If a queued INSERT succeeds on the server but the network drops before the queue item is deleted from IndexedDB, the retry fires an identical INSERT — which hits a PRIMARY KEY violation, increments retryCount, and the item loops forever.

**Fix — Two-part:** Client generates the UUID before queuing; server uses upsert to silently ignore duplicates.

**Client side:**

```typescript
// When queuing an event INSERT:
const stableId = crypto.randomUUID()  // Generated once, stored in payload

await db.syncQueue.add({
  type: 'INSERT_EVENT',
  payload: { id: stableId, studentId, type: eventType, timestamp: new Date().toISOString() },
  retryCount: 0,
  lastAttemptAt: 0,
  createdAt: Date.now(),
})
```

**Server side (when replaying):**

```typescript
// In syncEngine.ts replayItem(), for INSERT_EVENT:
const { error } = await supabase
  .from('events')
  .upsert(item.payload, { onConflict: 'id', ignoreDuplicates: true })
  // If the row already exists (idempotent retry), this is a silent no-op.
  // The response has no error, and the queue item is deleted as if successful.
```

Note: `ignoreDuplicates: true` is the correct PostgREST/Supabase JS v2 option. The chained `.onConflict()` method does NOT exist on `.insert()` — the option belongs inside `.upsert()`.

---

## Step 2 — Student Management from Admin Dashboard

**User decision:** Admin dashboard becomes the primary student management interface. Sync from Sheets becomes an annual import. Sync no longer deletes students.

### 2A: Add student CRUD to the API contract

**Add to `src/lib/api/types.ts` (IApiClient interface):**

```typescript
// src/lib/api/types.ts

addStudent(student: {
  idNumber: string;   // Must be exactly 9 digits; uniqueness enforced by DB
  fullName: string;
  phone: string;
  grade: string;      // Must be a value from GRADE_LEVELS
  classId: string;    // Must be a value from GRADE_CLASS_MAP[grade]
}): Promise<AppResult<Student>>;

updateStudent(
  id: string,
  updates: Partial<Pick<Student, 'fullName' | 'phone' | 'grade' | 'classId'>>
): Promise<AppResult<Student>>;

deleteStudent(id: string): Promise<AppResult<void>>;
```

**Implement in `src/lib/api/supabaseClient.ts`:**

```typescript
async addStudent(student) {
  // Validate before hitting the DB
  if (!/^\d{9}$/.test(student.idNumber)) {
    return { error: { message: 'מספר זהות חייב להיות 9 ספרות' } }
  }

  const { data, error } = await supabase
    .from('students')
    .insert({
      "idNumber":      student.idNumber,
      "fullName":      student.fullName,
      phone:           student.phone,
      grade:           student.grade,
      "classId":       student.classId,
      "currentStatus": 'ON_CAMPUS',
      // lastSeen and createdAt use DB server defaults (now())
    })
    .select()
    .single()
  if (error) return { error }
  return { data }
},

async updateStudent(id, updates) {
  // Map camelCase TS fields to quoted DB column names
  const dbUpdates: Record<string, unknown> = {}
  if (updates.fullName !== undefined) dbUpdates['"fullName"'] = updates.fullName
  if (updates.phone    !== undefined) dbUpdates.phone         = updates.phone
  if (updates.grade    !== undefined) dbUpdates.grade          = updates.grade
  if (updates.classId  !== undefined) {
    dbUpdates['"classId"']              = updates.classId
    dbUpdates.manual_class_override     = true  // Marks this as admin-set (Step 2C)
  }

  const { data, error } = await supabase
    .from('students')
    .update(dbUpdates)
    .eq('id', id)
    .select()
    .single()
  if (error) return { error }
  return { data }
},

async deleteStudent(id) {
  // Guard: refuse to delete a student with an ACTIVE or PENDING departure
  const { data: activeDeps } = await supabase
    .from('departures')
    .select('id, status')
    .eq('student_id', id)
    .in('status', ['ACTIVE', 'PENDING', 'APPROVED'])
    .limit(1)

  if (activeDeps && activeDeps.length > 0) {
    return { error: { message: 'לא ניתן למחוק תלמיד עם יציאה פעילה. בטל את היציאה תחילה.' } }
  }

  const { error } = await supabase
    .from('students')
    .delete()
    .eq('id', id)
  if (error) return { error }
  return { data: undefined }
},
```

**Mirror in `src/lib/api/mockClient.ts`** — same logic, same guard, same validation, against in-memory arrays. Do not skip any of the three methods.

**New UI components:**

- `src/components/admin/AddStudentModal.tsx` — form fields: שם מלא, מספר זהות, טלפון, שיעור (dropdown from GRADE_LEVELS), כיתה (dropdown from `GRADE_CLASS_MAP[selectedGrade]`, cascades when grade changes)
- `src/components/admin/EditStudentModal.tsx` — pre-filled with current values, calls `updateStudent`
- `src/pages/admin/StudentsPage.tsx` — add "הוסף תלמיד" button, add edit/delete actions per row. Delete shows a confirmation dialog warning "פעולה זו מוחקת את כל היסטוריית התלמיד."

---

### 2B: Change sync behavior — stop deleting students

**File:** `supabase/functions/sync-from-sheets/index.ts:137–143`

**Current behavior:** Students in the DB but absent from the Sheets payload are hard-deleted (full CASCADE). This was designed when Sheets was the single source of truth.

**New behavior:** Sync is import-only. No deletions. Admin deletes from the dashboard.

**Trade-off to document:** A test student or mistakenly added student is no longer automatically cleaned up by sync. It must be manually deleted from the dashboard. This is acceptable because sync is now an annual import, not a continuous sync.

**Fix:**

```typescript
// supabase/functions/sync-from-sheets/index.ts
// DELETE this entire block (approximately lines 137-143):
//
//   const idsInSheet = students.map(s => s.idNumber)
//   const { error: deleteError } = await supabase
//     .from('students')
//     .delete()
//     .not('idNumber', 'in', `(${idsInSheet.join(',')})`)
//   if (deleteError) ...
//
// Replace with nothing. Sync does not delete students.
// Students are deleted only from the admin dashboard.
```

**Update CLAUDE.md Iron Rule #1:**

```
Iron Rule #1 (UPDATED 2026-05-10):
The admin dashboard is the primary student management interface.
Google Sheets sync is an annual import (start of year) that adds and 
updates students but NEVER deletes them. Deletions are admin dashboard 
only. Hard delete from dashboard → CASCADE on departures, events, 
admin_overrides (same as before, just initiated from the UI instead of sync).
```

---

### 2C: Add `manual_class_override` column

This column protects admin-assigned class placements from being overwritten by the next annual sync.

```sql
-- Migration: 20260510_manual_class_override.sql
ALTER TABLE students ADD COLUMN IF NOT EXISTS manual_class_override BOOLEAN DEFAULT FALSE;
```

**Update `sync_student_from_sheet()` RPC to respect this column** (replaces the version from Step 1A — use this as the final version):

```sql
CREATE OR REPLACE FUNCTION sync_student_from_sheet(
  p_id_number TEXT,
  p_full_name TEXT,
  p_phone     TEXT,
  p_grade     TEXT,
  p_class_id  TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO students (
    "idNumber", "fullName", phone, grade, "classId",
    "currentStatus", "lastSeen", "createdAt", manual_class_override
  )
  VALUES (
    p_id_number, p_full_name, p_phone, p_grade, p_class_id,
    'ON_CAMPUS', now(), now(), FALSE
  )
  ON CONFLICT ("idNumber") DO UPDATE SET
    "fullName" = EXCLUDED."fullName",
    phone      = EXCLUDED.phone,
    -- Respect manual override: if admin set the class, don't overwrite it
    grade    = CASE WHEN students.manual_class_override
                    THEN students.grade    ELSE EXCLUDED.grade    END,
    "classId" = CASE WHEN students.manual_class_override
                    THEN students."classId" ELSE EXCLUDED."classId" END;
    -- NEVER touched on conflict:
    -- "currentStatus", push_token, fcm_token, "deviceToken", "lastSeen"
END;
$$;
```

---

## Step 3 — Production Verification (1–2 Days)

**Goal:** Confirm that the live Supabase project matches the migration files. Many issues are "the migration exists but was never applied."

### 3A: Verify all RPCs exist

Run in Supabase SQL Editor:

```sql
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'verify_admin_pin', 'verify_supervisor_pin', 'get_admin_pin_length',
    'submit_departure', 'approve_departure', 'reject_departure',
    'cancel_departure', 'return_departure', 'tick_departures',
    'sync_student_from_sheet', 'correct_student_id_number'
  )
ORDER BY routine_name;
```

**If any are missing:** Apply the migration file that defines them. The three auth RPCs (`verify_admin_pin`, `verify_supervisor_pin`, `get_admin_pin_length`) are the most critical — if they're missing, admin and supervisor login is completely broken and has been silently failing since launch.

### 3B: Audit GRANT state of sensitive functions

```sql
-- Check which roles can execute the PIN-change function
SELECT grantee, routine_name, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_schema = 'public'
  AND routine_name IN ('change_admin_pin', 'verify_admin_pin', 'submit_departure')
ORDER BY routine_name, grantee;
```

**Important note:** Granting `authenticated` is meaningless here — students have no Supabase Auth accounts and are never in the `authenticated` role. They operate as `anon`. So:

```sql
-- change_admin_pin should ONLY be callable from service_role (Edge Functions)
REVOKE EXECUTE ON FUNCTION change_admin_pin FROM anon;
REVOKE EXECUTE ON FUNCTION change_admin_pin FROM authenticated;
-- Do NOT grant to authenticated — no one is authenticated in this system
```

### 3C: Verify schema integrity

```sql
-- Confirm departures table has GiST exclusion constraint (non-overlapping departures)
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = 'departures'::regclass;
-- Should include an exclusion constraint (contype = 'x')

-- Confirm idNumber has a UNIQUE constraint (required for sync conflict target)
SELECT conname
FROM pg_constraint
WHERE conrelid = 'students'::regclass AND contype = 'u';
-- Should include a constraint on "idNumber"

-- Confirm manual_class_override column was added
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'students' AND column_name = 'manual_class_override';
```

### 3D: Check pgcrypto extension (needed for Step 6)

```sql
SELECT * FROM pg_extension WHERE extname = 'pgcrypto';
-- If no row: run CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

---

## Step 4 — Security Quick Wins (1 Week)

### 4A: Revoke anon access from RPCs — split by who calls them

**⚠️ Critical distinction:** Students use the public anon key. Revoking anon from student-facing RPCs breaks the entire student experience silently. These must be handled separately.

**Safe to revoke anon immediately (admin/supervisor-only RPCs):**

```sql
-- Migration: 20260510_revoke_anon_admin_rpcs.sql

-- These are never called by student code:
REVOKE EXECUTE ON FUNCTION approve_departure   FROM anon;
REVOKE EXECUTE ON FUNCTION reject_departure    FROM anon;
REVOKE EXECUTE ON FUNCTION change_admin_pin    FROM anon;
REVOKE EXECUTE ON FUNCTION sync_student_from_sheet FROM anon;
REVOKE EXECUTE ON FUNCTION correct_student_id_number FROM anon;

-- These should only come from Edge Functions (service_role) or
-- from an authenticated admin session (which doesn't exist yet).
-- For now, leave them callable only by service_role:
-- (service_role is never revoked — it's the internal role)
```

**Cannot revoke anon yet — student-facing RPCs (document as known debt):**

```sql
-- DO NOT revoke anon from these until student auth is redesigned:
-- submit_departure   — called by students to submit a departure request
-- cancel_departure   — called by students to cancel their departure
-- return_departure   — called by students when they return
-- verify_admin_pin   — called during admin login
-- verify_supervisor_pin — called during supervisor login
--
-- To revoke anon from these, students need Supabase Auth accounts
-- or requests must be proxied through an authenticated Edge Function.
-- This is a known architectural debt item.
```

**Document this in CLAUDE.md section 19 (Known Debt):**

> `[ ]` Student RPC anon access: `submit_departure`, `cancel_departure`, `return_departure` are callable by anyone with the anon key. Full lockdown requires either student Supabase Auth accounts or proxying student calls through an authenticated Edge Function. Currently deferred.

### 4B: Secure `notify-admin-quota-full` open registration

**File:** `supabase/functions/notify-admin-quota-full/index.ts:75–87`  
**Problem:** Any HTTP POST with `action='register'` and any `deviceId` registers a push subscription as an admin recipient. The attacker receives all admin push notifications indefinitely.

**Fix:**

```typescript
// supabase/functions/notify-admin-quota-full/index.ts
if (req.method === 'POST') {
  const body = await req.json()

  if (body.action === 'register') {
    // Require a shared secret known only to the admin app
    const provided = req.headers.get('X-Admin-Registration-Secret') ?? ''
    const expected = Deno.env.get('ADMIN_REGISTRATION_SECRET') ?? ''

    if (!expected) {
      // Secret not configured — reject all registrations until it is set
      return new Response(JSON.stringify({ error: 'registration_disabled' }), { status: 503 })
    }
    if (provided !== expected) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
    }
    // Proceed with existing registration logic...
  }
}
```

**Add to Supabase Edge Function secrets:** `ADMIN_REGISTRATION_SECRET` = a long random string.  
**Add to the admin PWA:** include this header in the registration request. Store the value in `VITE_ADMIN_REGISTRATION_SECRET` (admin-only env var, not committed).

### 4C: Fix `p_actor_role` client-supplied trust for ADMIN_OVERRIDE (CRITICAL)

**File:** `supabase/migrations/20260423_unified_departures.sql:287`  
**Problem:** Any HTTP client can call `supabase.rpc('submit_departure', { p_source: 'ADMIN_OVERRIDE', p_actor_role: 'ADMIN' })` and bypass quota entirely. The server trusts the role string from the client with no verification.

**Immediate mitigation — add PIN verification helper:**

```sql
-- Migration: 20260510_verify_actor_pin.sql

CREATE OR REPLACE FUNCTION _verify_admin_pin_internal(p_pin TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_stored TEXT;
BEGIN
  SELECT value INTO v_stored FROM app_settings WHERE key = 'admin_pin';
  RETURN p_pin IS NOT NULL AND p_pin = v_stored;
END;
$$;
```

**Update `submit_departure` RPC signature** (add `p_actor_pin TEXT DEFAULT NULL`):

```sql
-- In submit_departure: replace the current ADMIN_OVERRIDE check:
-- OLD:
--   IF p_source = 'ADMIN_OVERRIDE' AND p_actor_role NOT IN ('ADMIN', 'SUPERVISOR') THEN

-- NEW:
IF p_source = 'ADMIN_OVERRIDE' THEN
  IF p_actor_role = 'ADMIN' THEN
    IF NOT _verify_admin_pin_internal(p_actor_pin) THEN
      RETURN jsonb_build_object('error', 'invalid_admin_pin');
    END IF;
  ELSIF p_actor_role = 'SUPERVISOR' THEN
    -- Supervisor ADMIN_OVERRIDE is not currently supported
    -- (Supervisors use source='SUPERVISOR', not ADMIN_OVERRIDE)
    RETURN jsonb_build_object('error', 'supervisors_cannot_use_admin_override');
  ELSE
    RETURN jsonb_build_object('error', 'invalid_actor_role_for_override');
  END IF;
END IF;
```

**Update `supabaseClient.ts`:** when calling `submitDeparture` with `source: 'ADMIN_OVERRIDE'`, retrieve the admin PIN from `authStore` and pass it as `p_actor_pin`.

### 4D: Apply Realtime filter to useDeparturesRealtime (privacy fix)

**File:** `src/hooks/useDeparturesRealtime.ts:28–41`  
**Problem:** Options (`studentId`, `classId`, `grade`) are stored in refs but never applied to the channel subscription. Every subscriber receives changes for ALL departures.

**Fix:**

```typescript
// src/hooks/useDeparturesRealtime.ts

// Build the Postgres filter string from options:
const filter = useMemo(() => {
  if (optionsRef.current.studentId) {
    return `student_id=eq.${optionsRef.current.studentId}`
  }
  if (optionsRef.current.classId) {
    return `class_id=eq.${optionsRef.current.classId}`
  }
  return undefined  // Admin: no filter = all departures
}, [/* options keys */])

// Apply filter in the channel subscription:
const channel = supabase
  .channel(`departures-${filter ?? 'all'}`)  // Unique name per filter
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'departures',
    filter,
  }, callback)
  .subscribe()
```

Note: The channel name must include the filter to avoid different subscribers sharing a channel with different filter expectations.

---

## Step 5 — RLS on Admin-Only Tables (2 Days)

Enable RLS on tables that don't require knowing the supervisor identity. Full RLS on `students` and `departures` waits until Step 6 (supervisor tables must exist first).

```sql
-- Migration: 20260510_rls_admin_tables.sql

-- app_settings: contains admin_pin in plaintext — restrict writes strictly
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Read: allow all (settings like campus_lat, quota formulas are non-sensitive).
-- EXCEPTION: admin_pin key must be read only by service_role.
-- Implement a view to expose only safe settings if needed.
CREATE POLICY "app_settings_read_safe" ON app_settings
  FOR SELECT USING (key != 'admin_pin' OR auth.role() = 'service_role');

-- Write: only service_role (Edge Functions have full access; anon/authenticated cannot write)
CREATE POLICY "app_settings_write_service_only" ON app_settings
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- admin_overrides: append-only audit log (written by DB trigger, not directly)
ALTER TABLE admin_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_overrides_read_all" ON admin_overrides
  FOR SELECT USING (true);

-- INSERT is blocked for all roles — rows are created ONLY by the
-- DB trigger on departures, which runs as the definer (service_role).
-- This is the correct behavior: no direct writes to the audit log.
CREATE POLICY "admin_overrides_no_direct_write" ON admin_overrides
  FOR INSERT WITH CHECK (false);  -- WITH CHECK for INSERT, not USING

CREATE POLICY "admin_overrides_no_update" ON admin_overrides
  FOR UPDATE USING (false);

CREATE POLICY "admin_overrides_no_delete" ON admin_overrides
  FOR DELETE USING (false);
```

**Note on students and departures:** These tables contain all 381 students' data and all departure records. RLS for these tables requires knowing whether the requester is the admin, a supervisor (and which class), or the student themselves. This identity model doesn't exist yet — it's built in Step 6. Apply full RLS in Step 6G after the supervisors table is in place.

---

## Step 6 — Supervisor Architecture Redesign (~3 Weeks)

**Why this is mandatory before the services layer:** The `approve_departure` supervisor check is completely broken today (any supervisor approves any class, Bug A). Every permission feature the user described requires supervisors to be first-class database entities, not PINs in a key-value store. This must be built before RLS on `students`/`departures`, before any service methods that check actor permissions, and before any new supervisor-facing features.

### 6A: Enable pgcrypto and create supervisor tables

```sql
-- Migration: 20260510_create_supervisors.sql

-- Required for bcrypt PIN hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE supervisors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name   TEXT NOT NULL,
  pin_hash    TEXT NOT NULL,       -- bcrypt hash via pgcrypto crypt()
  created_at  TIMESTAMPTZ DEFAULT now(),
  expires_at  TIMESTAMPTZ,         -- NULL = permanent; set for temporary supervisors
  created_by  TEXT                 -- free text: which admin created this record
);

CREATE TABLE supervisor_classes (
  supervisor_id UUID NOT NULL REFERENCES supervisors(id) ON DELETE CASCADE,
  class_id      TEXT NOT NULL,   -- Exact match of students.classId (e.g., 'כיתה הרב אבישי')
  can_approve   BOOLEAN DEFAULT true,
  can_view_gps  BOOLEAN DEFAULT false,
  PRIMARY KEY (supervisor_id, class_id)
);

CREATE INDEX idx_supervisor_classes_class_id ON supervisor_classes(class_id);
```

### 6B: Migrate from PIN scheme to supervisors table

**Important:** After this migration runs, the old PIN scheme (app_settings `class_code_*` keys) is deleted. Supervisors will need to be told their new PIN is unchanged (same digits they always used).

```sql
-- Migration: 20260510_migrate_pins_to_supervisors.sql
-- Run AFTER 20260510_create_supervisors.sql

DO $$
DECLARE
  r              RECORD;
  v_admin_pin    TEXT;
  v_class_id     TEXT;
  v_code         TEXT;
  v_full_pin     TEXT;
  v_hashed_pin   TEXT;
  v_supervisor_id UUID;
BEGIN
  -- Read current admin PIN
  SELECT value INTO v_admin_pin FROM app_settings WHERE key = 'admin_pin';

  IF v_admin_pin IS NULL THEN
    RAISE EXCEPTION 'admin_pin not found in app_settings';
  END IF;

  FOR r IN SELECT key, value FROM app_settings WHERE key LIKE 'class_code_%' LOOP
    v_class_id   := substring(r.key FROM length('class_code_') + 1);
    v_code       := r.value;
    v_full_pin   := v_admin_pin || v_code;  -- The old combined PIN

    -- Hash the PIN with bcrypt (cost factor 10)
    v_hashed_pin := crypt(v_full_pin, gen_salt('bf', 10));

    INSERT INTO supervisors (full_name, pin_hash, created_by)
    VALUES ('רכז ' || v_class_id, v_hashed_pin, 'migration-2026-05-10')
    RETURNING id INTO v_supervisor_id;

    INSERT INTO supervisor_classes (supervisor_id, class_id, can_approve)
    VALUES (v_supervisor_id, v_class_id, true);

    -- Remove the old class_code entry
    DELETE FROM app_settings WHERE key = r.key;

    RAISE NOTICE 'Migrated supervisor for class: %', v_class_id;
  END LOOP;
END;
$$;
```

### 6C: Rewrite verify_supervisor_pin RPC

```sql
-- Migration: 20260510_rewrite_verify_supervisor_pin.sql

CREATE OR REPLACE FUNCTION verify_supervisor_pin(p_pin TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_supervisor  supervisors%ROWTYPE;
  v_class_ids   TEXT[];
BEGIN
  -- Find supervisor by bcrypt PIN comparison
  -- crypt(input, stored_hash) re-hashes using the same salt and compares
  SELECT * INTO v_supervisor
  FROM supervisors
  WHERE pin_hash = crypt(p_pin, pin_hash)
    AND (expires_at IS NULL OR expires_at > now());

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'invalid_pin');
  END IF;

  -- Collect all authorized class IDs for this supervisor
  SELECT array_agg(class_id ORDER BY class_id) INTO v_class_ids
  FROM supervisor_classes
  WHERE supervisor_id = v_supervisor.id;

  RETURN jsonb_build_object(
    'supervisorId',       v_supervisor.id::text,
    'fullName',           v_supervisor.full_name,
    'authorizedClassIds', COALESCE(v_class_ids, '{}'),
    'expiresAt',          v_supervisor.expires_at
  );
END;
$$;
```

### 6D: Fix approve_departure, reject_departure, cancel_departure supervisor checks

Replace the broken check (Bug A — checks any class code exists, not this supervisor's) in all three RPCs:

```sql
-- In each of approve_departure, reject_departure, cancel_departure:
-- Replace:
--   IF p_actor_role = 'SUPERVISOR' THEN
--     IF NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'class_code_' || v_dep.class_id) THEN
--       RETURN jsonb_build_object('error', 'class_mismatch');
--     END IF;
--   END IF;
--
-- With:
IF p_actor_role = 'SUPERVISOR' THEN
  IF NOT EXISTS (
    SELECT 1
    FROM supervisor_classes sc
    JOIN supervisors s ON s.id = sc.supervisor_id
    WHERE s.id::text = p_actor_id            -- THIS supervisor specifically
      AND sc.class_id = v_dep.class_id        -- authorized for THIS class
      AND sc.can_approve = true               -- with approve permission
      AND (s.expires_at IS NULL OR s.expires_at > now())  -- not expired
  ) THEN
    RETURN jsonb_build_object('error', 'supervisor_not_authorized_for_class');
  END IF;
END IF;
```

### 6E: Update supervisor session model in TypeScript

**File:** `src/lib/auth/supervisorAuth.ts`

```typescript
// src/lib/auth/supervisorAuth.ts — replace ClassSupervisorInfo entirely:

export interface ClassSupervisorSession {
  supervisorId:       string;     // UUID from supervisors.id
  fullName:           string;     // for display
  authorizedClassIds: string[];   // currently always length 1; built to support N
  expiresAt?:         number;     // Unix ms timestamp; undefined = permanent
}

// Helper:
export function isSessionValid(session: ClassSupervisorSession): boolean {
  if (!session.expiresAt) return true
  return Date.now() < session.expiresAt
}
```

**File:** `src/store/authStore.ts`

```typescript
// Replace:
//   classSupervisor: ClassSupervisorInfo | null
// With:
supervisorSession: ClassSupervisorSession | null

// loginClassSupervisor action:
loginClassSupervisor: async (pin: string): Promise<boolean> => {
  const { data, error } = await supabase.rpc('verify_supervisor_pin', { p_pin: pin })
  if (error) return false

  const result = data as {
    supervisorId?: string
    fullName?: string
    authorizedClassIds?: string[]
    expiresAt?: string
    error?: string
  }
  if (result.error) return false

  set({
    supervisorSession: {
      supervisorId:       result.supervisorId!,
      fullName:           result.fullName!,
      authorizedClassIds: result.authorizedClassIds ?? [],
      expiresAt:          result.expiresAt
        ? new Date(result.expiresAt).getTime()
        : undefined,
    }
  })
  return true
},

logoutSupervisor: () => set({ supervisorSession: null }),
```

### 6F: Update ClassSupervisorDashboard

**File:** `src/pages/class-supervisor/ClassSupervisorDashboard.tsx`

```typescript
// 1. Replace the single classId extraction:
// OLD (line 447):
//   const classId = classSupervisor?.classId ?? ''

// NEW:
const { supervisorSession } = useAuthStore()
const authorizedClassIds = supervisorSession?.authorizedClassIds ?? []
const [selectedClassId, setSelectedClassId] = useState<string>(authorizedClassIds[0] ?? '')

// 2. Pass real supervisor ID (not literal string) to all RPC calls:
// OLD (line 189):
//   actorId: 'supervisor'
// NEW:
actorId: supervisorSession?.supervisorId ?? ''

// 3. Fix hook violation (line 477):
// The early return MUST come AFTER all hook calls, not before.
// Move any if(!classId) return null to the JSX section, AFTER all useEffects.

// 4. Add class picker (renders only when supervisor has multiple classes — future-ready):
{authorizedClassIds.length > 1 && (
  <div className="mb-4">
    <Select value={selectedClassId} onValueChange={setSelectedClassId} dir="rtl">
      <SelectTrigger><SelectValue placeholder="בחר כיתה" /></SelectTrigger>
      <SelectContent>
        {authorizedClassIds.map(id => (
          <SelectItem key={id} value={id}>{id}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
)}
```

### 6G: Add admin_overrides ON DELETE SET NULL

This is an audit log. When a student is hard-deleted from the dashboard, we want the audit record to remain (with studentId nulled out), not cascade-deleted.

```sql
-- Migration: 20260510_admin_overrides_set_null.sql

-- Check current constraint:
SELECT conname FROM pg_constraint
WHERE conrelid = 'admin_overrides'::regclass AND contype = 'f';

-- If there's a CASCADE on studentId FK, replace it:
ALTER TABLE admin_overrides
  DROP CONSTRAINT IF EXISTS admin_overrides_studentid_fkey;

ALTER TABLE admin_overrides
  ADD CONSTRAINT admin_overrides_studentid_fkey
  FOREIGN KEY ("studentId")
  REFERENCES students(id)
  ON DELETE SET NULL;
```

### 6H: RLS on students and departures (Phase 2B — do after 6A through 6G are complete)

```sql
-- Migration: 20260510_rls_students_departures.sql
-- PREREQUISITE: supervisors + supervisor_classes tables must exist (Step 6A)

ALTER TABLE students  ENABLE ROW LEVEL SECURITY;
ALTER TABLE departures ENABLE ROW LEVEL SECURITY;

-- CRITICAL: Students read their own data using the anon key.
-- DO NOT block anon reads on students entirely — it breaks login.
-- Instead, block writes from anon:

CREATE POLICY "students_anon_read" ON students
  FOR SELECT USING (true);  -- Allow all reads for now (student login requires this)

CREATE POLICY "students_no_anon_write" ON students
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "students_no_anon_update" ON students
  FOR UPDATE USING (auth.role() = 'service_role');

CREATE POLICY "students_no_anon_delete" ON students
  FOR DELETE USING (auth.role() = 'service_role');

-- Departures: same approach — reads needed by students
CREATE POLICY "departures_anon_read" ON departures
  FOR SELECT USING (true);

CREATE POLICY "departures_no_anon_write" ON departures
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- NOTE: The above policies block INSERT/UPDATE/DELETE for anon on students and departures.
-- But the RPCs (submit_departure, etc.) use SECURITY DEFINER, so they run as the
-- function owner (postgres/service_role) — they bypass RLS correctly.
-- Direct table writes from the anon key are blocked. RPC calls still work.

-- Full per-entity RLS (supervisor sees only their class, student sees only their data)
-- requires Supabase Auth JWT claims. This is outstanding debt, documented in CLAUDE.md.
```

---

## Step 7 — Data Model & DB Contract (~2 Weeks)

### 7A: Runtime configuration service

**Problem:** 7 business-critical values are compile-time constants. Changing them requires a code deploy.

**Migration — seed config keys:**

```sql
-- Migration: 20260510_runtime_config.sql
INSERT INTO app_settings (key, value) VALUES
  ('campus_lat',                        '31.5253'),
  ('campus_lng',                        '35.1056'),
  ('campus_radius_meters',              '300'),
  ('area_radius_meters',                '5000'),
  ('student_cancel_window_seconds',     '300'),
  ('sync_retry_max',                    '10'),
  ('push_template_departure_approved',  'בוקר טוב! היציאה שלך אושרה, לך בשלום 🎉')
ON CONFLICT (key) DO NOTHING;
```

**Create config service with hardcoded defaults as fallback:**

```typescript
// src/services/config/appConfig.ts

const CONFIG_KEYS = [
  'campus_lat',
  'campus_lng',
  'campus_radius_meters',
  'area_radius_meters',
  'student_cancel_window_seconds',
  'sync_retry_max',
  'push_template_departure_approved',
] as const

type ConfigKey = (typeof CONFIG_KEYS)[number]

// Hardcoded defaults: used if DB is unreachable at startup or key is missing.
// These match the current hardcoded values so behavior is unchanged on failure.
const DEFAULTS: Record<ConfigKey, string> = {
  campus_lat:                       '31.5253',
  campus_lng:                       '35.1056',
  campus_radius_meters:             '300',
  area_radius_meters:               '5000',
  student_cancel_window_seconds:    '300',
  sync_retry_max:                   '10',
  push_template_departure_approved: 'בוקר טוב! היציאה שלך אושרה, לך בשלום 🎉',
}

let config: Record<string, string> = { ...DEFAULTS }

export async function loadConfig(): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', CONFIG_KEYS)
    if (!error && data) {
      for (const row of data) {
        config[row.key] = row.value
      }
    }
  } catch {
    // Network failure: silently fall back to defaults
    console.warn('[AppConfig] Using defaults — DB unreachable at startup')
  }
}

export function getConfig(key: ConfigKey): string {
  return config[key] ?? DEFAULTS[key]
}

export function getConfigNumber(key: ConfigKey): number {
  return parseFloat(getConfig(key))
}
```

**Call `loadConfig()` in `src/App.tsx`:**

```typescript
// src/App.tsx — call before rendering any authenticated route:
useEffect(() => {
  loadConfig()  // Non-blocking; defaults are already in place
}, [])
```

**Update consumers (delete hardcoded constants, replace with config service calls):**

| File | Hardcoded constant | Replace with |
|---|---|---|
| `src/lib/location/gps.ts:5` | `CAMPUS_LAT = 31.5253` | `getConfigNumber('campus_lat')` |
| `src/lib/location/gps.ts:6` | `CAMPUS_LNG = 35.1056` | `getConfigNumber('campus_lng')` |
| `src/lib/location/gps.ts:7` | `CAMPUS_RADIUS_METERS = 300` | `getConfigNumber('campus_radius_meters')` |
| `src/lib/location/gps.ts:8` | `AREA_RADIUS_METERS = 5000` | `getConfigNumber('area_radius_meters')` |
| `src/pages/student/HomePage.tsx:190` | `5 * 60 * 1000` | `getConfigNumber('student_cancel_window_seconds') * 1000` |
| `src/lib/api/supabaseClient.ts:241` | Hebrew push string | `getConfig('push_template_departure_approved')` |
| `src/lib/sync/syncEngine.ts:5` | `STUCK_RETRY_THRESHOLD = 3` | `getConfigNumber('sync_retry_max')` |

### 7B: rename_class() RPC — prevents silent quota corruption

**Problem (from v4 Part VIII):** When a class is renamed in Google Sheets and sync runs, students get the new classId but all departure rows still have the old `class_id`. The quota check finds zero active departures for the new class name and allows unlimited departures simultaneously.

```sql
-- Migration: 20260510_rename_class_rpc.sql

CREATE OR REPLACE FUNCTION rename_class(p_old_id TEXT, p_new_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_students_updated   INT;
  v_departures_updated INT;
BEGIN
  IF p_old_id = p_new_id THEN
    RETURN jsonb_build_object('error', 'old and new names are identical');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM students WHERE "classId" = p_old_id LIMIT 1) THEN
    RETURN jsonb_build_object('error', 'class not found', 'class_id', p_old_id);
  END IF;

  UPDATE students  SET "classId"  = p_new_id WHERE "classId"  = p_old_id;
  GET DIAGNOSTICS v_students_updated = ROW_COUNT;

  UPDATE departures SET class_id  = p_new_id WHERE class_id  = p_old_id;
  GET DIAGNOSTICS v_departures_updated = ROW_COUNT;

  UPDATE supervisor_classes SET class_id = p_new_id WHERE class_id = p_old_id;

  -- Clean up any orphaned class_code_ keys (should be gone after Step 6, but be safe)
  UPDATE app_settings
  SET key = 'class_code_' || p_new_id
  WHERE key = 'class_code_' || p_old_id;

  RETURN jsonb_build_object(
    'success', true,
    'students_updated', v_students_updated,
    'departures_updated', v_departures_updated
  );
END;
$$;
```

**Important:** Automatic rename detection in `sync-from-sheets` is fragile (a class that loses students can look like a rename of another class). **The safe approach is manual:** when a class is renamed in Sheets, run `SELECT rename_class('old name', 'new name')` in the Supabase SQL Editor BEFORE running the sync.

**Document in CLAUDE.md:**

> **Before renaming a class in Google Sheets:**  
> 1. Run: `SELECT rename_class('כיתה הרב משה', 'כיתה הרב משה ב');`  
> 2. Then run the sync. If you sync first, quota counts will be wrong until all old departures expire.

### 7C: Dexie schema v4 — remove absenceRequests, add lastAttemptAt

**File:** `src/lib/db/schema.ts`

```typescript
// src/lib/db/schema.ts

// Bump to version 4:
db.version(4).stores({
  events:    'id, studentId, type, timestamp',
  students:  'id, idNumber, classId, currentStatus',
  syncQueue: '++id, type, retryCount, lastAttemptAt',
  // absenceRequests: intentionally removed — table no longer exists in schema
}).upgrade(() => {
  // No migration data to move. absenceRequests is unused.
  // lastAttemptAt is a new field on existing rows; defaults to undefined,
  // which is treated as 0 in the retry logic (retry immediately on first attempt).
})
```

Note: `lastAttemptAt` is indexed in the schema so `syncEngine.ts` can query by it efficiently. Step 1C uses this field — do this step simultaneously with Step 1C.

### 7D: Dashboard aggregation RPC + IApiClient method

**Problem:** `DashboardPage.tsx:181` calls `api.getStudents()` — fetches all 381 student rows — just to count 3 integers.

**Migration:**

```sql
-- Migration: 20260510_campus_status_counts_rpc.sql

CREATE OR REPLACE FUNCTION get_campus_status_counts()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT jsonb_build_object(
    'onCampus',  COUNT(*) FILTER (WHERE "currentStatus" = 'ON_CAMPUS'),
    'offCampus', COUNT(*) FILTER (WHERE "currentStatus" IN ('OFF_CAMPUS', 'OVERDUE')),
    'pending',   COUNT(*) FILTER (WHERE "currentStatus" = 'PENDING'),
    'total',     COUNT(*) FILTER (WHERE "currentStatus" != 'PENDING')
  )
  FROM students;
$$;
```

**Add to IApiClient (`src/lib/api/types.ts`):**

```typescript
getCampusStatusCounts(): Promise<AppResult<{
  onCampus: number;
  offCampus: number;
  pending: number;
  total: number;
}>>
```

**Implement in `supabaseClient.ts`:**

```typescript
async getCampusStatusCounts() {
  const { data, error } = await supabase.rpc('get_campus_status_counts')
  if (error) return { error }
  return { data }
},
```

**Implement in `mockClient.ts`:**

```typescript
async getCampusStatusCounts() {
  const onCampus  = this.students.filter(s => s.currentStatus === 'ON_CAMPUS').length
  const offCampus = this.students.filter(s => ['OFF_CAMPUS', 'OVERDUE'].includes(s.currentStatus)).length
  const pending   = this.students.filter(s => s.currentStatus === 'PENDING').length
  return { data: { onCampus, offCampus, pending, total: onCampus + offCampus } }
},
```

**Update `DashboardPage.tsx`:** replace `api.getStudents()` pie-chart call with `api.getCampusStatusCounts()`. Remove the inline `onCampus`/`offCampus` computation over the 381-item array.

---

## Step 8 — API Layer Split + Mock Client Contract Tests (~2 Weeks)

### 8A: Fix the 5 mock client divergences

**File:** `src/lib/api/mockClient.ts`

**Divergence 1 — createEvent() missing student status update:**

```typescript
// In mockClient createEvent(), add after the event is pushed to the store:
const student = this._students.find(s => s.id === eventData.studentId)
if (student) {
  if (eventData.type === 'CHECK_IN'  || eventData.type === 'SMS_IN') {
    student.currentStatus = 'ON_CAMPUS'
  } else if (eventData.type === 'CHECK_OUT' || eventData.type === 'SMS_OUT') {
    student.currentStatus = 'OFF_CAMPUS'
  }
}
// (adjust this._students to match mockClient's actual internal storage name)
```

**Divergence 2 — getDashboardStats() total includes PENDING:**

```typescript
// mockClient getDashboardStats() — fix:
const activeStudents = this._students.filter(s => s.currentStatus !== 'PENDING')
// Replace: total: this._students.length
// With:
total: activeStudents.length,
```

**Divergence 3 — listDepartures() filters by current class, not departure snapshot:**

```typescript
// mockClient listDepartures() — fix:
// FROM: departures.filter(d => this._students.find(s => s.id === d.student_id)?.classId === classId)
// TO:
departures = departures.filter(d => d.class_id === options.classId)
// class_id is the snapshot value frozen at submission time — matches supabaseClient
```

**Divergence 4 — approveDeparture() no push notification simulation:**

```typescript
// mockClient approveDeparture() — add after audit record:
if (process.env.NODE_ENV !== 'test') {
  console.log(`[Mock] Push notification → student ${departure.student_id}: departure approved`)
}
// In test environments, suppress this log to keep test output clean
```

**Divergence 5 — createAdminOverride() bypasses cancelDeparture:**

```typescript
// mockClient createAdminOverride() — change:
// FROM: directly writing departure.status = 'CANCELLED'
// TO: call this.cancelDeparture() for each active departure
for (const dep of activeDepartures) {
  await this.cancelDeparture(dep.id, actorId, actorRole, override.note)
  // This triggers the same audit entry that supabaseClient creates
}
```

### 8B: Add contract tests

```typescript
// src/lib/api/__tests__/contract.test.ts

import { describe, it, expect, beforeEach } from 'vitest'
import { MockApiClient }   from '../mockClient'

// No supabaseClient tests here — requires live DB. Contract tests run on mockClient only.
// Future: add supabaseClient variant against a test Supabase project when one exists.

function createSeededMock() {
  const client = new MockApiClient()
  // Seed with a known student in OFF_CAMPUS state
  const student = client._seedStudent({
    idNumber: '123456789',
    fullName: 'Test Student',
    currentStatus: 'OFF_CAMPUS',
    classId: 'כיתה הרב אבישי',
    grade: 'שיעור א',
  })
  return { client, student }
}

describe('IApiClient contract', () => {
  it('createEvent CHECK_IN sets currentStatus to ON_CAMPUS', async () => {
    const { client, student } = createSeededMock()
    await client.createEvent({ studentId: student.id, type: 'CHECK_IN', timestamp: new Date() })
    const updated = await client.getStudent(student.id)
    expect(updated.data?.currentStatus).toBe('ON_CAMPUS')
  })

  it('getDashboardStats total excludes PENDING students', async () => {
    const { client } = createSeededMock()
    client._seedStudent({ currentStatus: 'PENDING' })
    const { data: stats } = await client.getDashboardStats()
    expect(stats!.total).toBe(stats!.onCampus + stats!.offCampus)
    expect(stats!.total).not.toContain(stats!.pending)
  })

  it('listDepartures classId filter uses class_id snapshot, not current classId', async () => {
    const { client, student } = createSeededMock()
    // Seed a departure with class_id = old class
    client._seedDeparture({ student_id: student.id, class_id: 'כיתה הרב הלל', status: 'ACTIVE' })
    // Move student to a new class
    await client.updateStudent(student.id, { classId: 'כיתה הרב אבישי' })
    // Query by old class_id — departure should still appear
    const { data: deps } = await client.listDepartures({ classId: 'כיתה הרב הלל' })
    expect(deps?.length).toBe(1)
    // Query by new class — departure should NOT appear (it was submitted for old class)
    const { data: newDeps } = await client.listDepartures({ classId: 'כיתה הרב אבישי' })
    expect(newDeps?.length).toBe(0)
  })

  it('getCampusStatusCounts returns correct counts', async () => {
    const { client } = createSeededMock()  // 1 OFF_CAMPUS
    client._seedStudent({ currentStatus: 'ON_CAMPUS' })
    client._seedStudent({ currentStatus: 'ON_CAMPUS' })
    client._seedStudent({ currentStatus: 'PENDING' })
    const { data } = await client.getCampusStatusCounts()
    expect(data).toEqual({ onCampus: 2, offCampus: 1, pending: 1, total: 3 })
  })
})
```

### 8C: Split supabaseClient.ts by domain

The current `supabaseClient.ts` (~700 lines, 28 methods) mixes student data, departure lifecycle, push, config, and audit log concerns. Split:

```
src/lib/api/
  index.ts                  — re-exports the active client (supabaseClient or mockClient)
  types.ts                  — IApiClient interface + AppResult type
  supabaseClient.ts         — creates Supabase instance; assembles from sub-clients
  mockClient.ts             — in-memory implementation of IApiClient
  clients/
    studentClient.ts        — getStudent, getStudents, addStudent, updateStudent, deleteStudent, getCampusStatusCounts
    departureClient.ts      — listDepartures, submitDeparture, approveDeparture, rejectDeparture, cancelDeparture, returnDeparture
    eventClient.ts          — createEvent, getStudentHistory
    adminClient.ts          — getDashboardStats, getAuditLog, createAdminOverride, changeAdminPin
  __tests__/
    contract.test.ts        — runs IApiClient contract tests against mockClient
```

Note: `configClient.ts` is NOT a separate API client — the app config service (`src/services/config/appConfig.ts` from Step 7A) handles config reads. The API clients call `getConfig()` when they need a configured value.

---

## Step 9 — Domain Layer (~1 Week)

Pure TypeScript — no Supabase imports, no React imports, no side effects. Everything here is testable in isolation with `vitest --no-deps`.

### 9A: Move quota logic to domain layer

`src/lib/quota.ts` already exists. **Move it** (don't copy) to `src/domain/quota.ts`. Add a re-export in `src/lib/quota.ts` for backward compatibility during migration:

```typescript
// src/lib/quota.ts (temporary shim — delete after all imports are updated)
export { calcQuota, isQuotaAvailable } from '../domain/quota'
```

```typescript
// src/domain/quota.ts
export function calcQuota(classSize: number): number {
  // MUST match SQL: GREATEST(1, ROUND((classSize * 3)::numeric / 25))
  return Math.max(1, Math.round((classSize * 3) / 25))
}

export function isQuotaAvailable(currentOut: number, classSize: number): boolean {
  return currentOut < calcQuota(classSize)
}
```

### 9B: Departure state machine

```typescript
// src/domain/departureTransitions.ts

export type DepartureStatus =
  | 'PENDING' | 'APPROVED' | 'ACTIVE'
  | 'COMPLETED' | 'REJECTED' | 'CANCELLED'

const VALID_TRANSITIONS: Readonly<Record<DepartureStatus, DepartureStatus[]>> = {
  PENDING:   ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED:  ['ACTIVE',   'CANCELLED'],
  ACTIVE:    ['COMPLETED','CANCELLED'],
  COMPLETED: [],
  REJECTED:  [],
  CANCELLED: [],
}

export function canTransition(from: DepartureStatus, to: DepartureStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

export function isTerminalStatus(status: DepartureStatus): boolean {
  return VALID_TRANSITIONS[status].length === 0
}

export function allowedNextStatuses(from: DepartureStatus): DepartureStatus[] {
  return [...VALID_TRANSITIONS[from]]
}
```

### 9C: Israel date utilities

```typescript
// src/domain/israelDate.ts

const TZ = 'Asia/Jerusalem'

export function nowInJerusalem(): Date {
  // Returns a Date whose local time matches Jerusalem's wall clock
  // NOTE: This date is in UTC internally — use only for display comparisons
  return new Date(new Date().toLocaleString('en-US', { timeZone: TZ }))
}

export function formatJerusalemDate(date: Date): string {
  return date.toLocaleDateString('he-IL', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function toJerusalemMidnight(date: Date): Date {
  // Returns the start of the day in Jerusalem (midnight local time)
  const str = date.toLocaleDateString('en-CA', { timeZone: TZ }) // 'YYYY-MM-DD'
  return new Date(`${str}T00:00:00+03:00`)  // Jerusalem is UTC+2/+3 (DST)
}

// NOTE: Do NOT use new Date().toISOString() for user-facing dates.
// Always pass a TZ-aware TIMESTAMPTZ to Supabase; Postgres handles conversion.
```

### 9D: Domain events bus

**Use `mitt`** (tiny 200-byte event emitter, already in many Vite project dependency trees — add with `npm install mitt` if not present):

```typescript
// src/services/events/domainEvents.ts
import mitt from 'mitt'

type DepartureEvents = {
  'departure.submitted': {
    departureId: string; studentId: string; classId: string; source: string
  }
  'departure.approved': {
    departureId: string; studentId: string; approvedBy: string
    pushToken: string | null  // null if student has no push subscription
  }
  'departure.rejected': {
    departureId: string; studentId: string; rejectedBy: string
  }
  'departure.cancelled': {
    departureId: string; studentId: string; cancelledBy: string
  }
  'departure.returned': {
    departureId: string; studentId: string
  }
}

export const domainEvents = mitt<DepartureEvents>()

// Subscribers are registered at app startup (in src/App.tsx or main.tsx):
// domainEvents.on('departure.approved', sendApprovalPushHandler)
// domainEvents.on('departure.approved', logApprovalToExternalAudit)  // future
```

**Update `supabaseClient.ts` — `approveDeparture()`:**

```typescript
// REMOVE: _sendApprovalPush() and its 2 extra round-trips (lines 217–238)

// After approve_departure RPC succeeds:
await domainEvents.emit('departure.approved', {
  departureId: id,
  studentId:   data.student_id,   // RPC must return this
  approvedBy:  actorId,
  pushToken:   data.push_token,   // RPC must return this (avoids 2 extra round-trips)
})
```

**Update `approve_departure` SQL RPC** to JOIN with students and return `student_id` and `push_token` in its result:

```sql
-- In approve_departure, change the final RETURN statement:
RETURN jsonb_build_object(
  'success',    true,
  'departureId', p_id,
  'student_id', v_dep.student_id,
  'push_token', (SELECT push_token FROM students WHERE id = v_dep.student_id)
);
```

**Register the push handler at startup** (`src/main.tsx` or `src/App.tsx`):

```typescript
import { domainEvents }       from './services/events/domainEvents'
import { sendApprovalPush }   from './services/push/pushService'

domainEvents.on('departure.approved', async (event) => {
  if (!event.pushToken) return  // Student has no push subscription
  try {
    await sendApprovalPush(event.pushToken, event.studentId)
  } catch (err) {
    console.error('[PushService] Failed to send approval push:', err)
    // Non-fatal: departure is approved regardless of push delivery
  }
})
```

The push call is fire-and-forget WITHIN the handler — `domainEvents.emit` does not await the handler's return value, so push latency does not block `approveDeparture`.

---

## Step 10 — Realtime + Offline Idempotency + Cancel Window (~1 Week)

### 10A: Singleton Realtime Service

**Problem:** 8+ raw `supabase.channel()` calls. Two components subscribing to the same channel name each get their own subscription — doubling callbacks and wasting connections.

```typescript
// src/services/realtime/realtimeService.ts
import { supabase }       from '../../lib/api/supabaseClient'
import type { RealtimeChannel } from '@supabase/supabase-js'

type Filter = { table: string; filter?: string }
type Callback = (payload: unknown) => void

class RealtimeService {
  private channels     = new Map<string, RealtimeChannel>()
  private subscribers  = new Map<string, Set<Callback>>()

  subscribe(filter: Filter, callback: Callback): () => void {
    const key = `${filter.table}:${filter.filter ?? '*'}`

    if (!this.channels.has(key)) {
      const subs = new Set<Callback>()
      this.subscribers.set(key, subs)

      const channel = supabase
        .channel(key)
        .on('postgres_changes', {
          event:  '*',
          schema: 'public',
          table:  filter.table,
          filter: filter.filter,
        }, (payload) => {
          subs.forEach(cb => cb(payload))
        })
        .subscribe()

      this.channels.set(key, channel)
    } else {
      this.subscribers.get(key)!.add(callback)
    }

    if (this.subscribers.has(key)) {
      this.subscribers.get(key)!.add(callback)
    }

    // Return unsubscribe function
    return () => {
      const subs = this.subscribers.get(key)
      subs?.delete(callback)
      if (subs?.size === 0) {
        this.channels.get(key)?.unsubscribe()
        this.channels.delete(key)
        this.subscribers.delete(key)
      }
    }
  }
}

export const realtimeService = new RealtimeService()
```

**Update the 9 raw channel call sites:**

Replace each `supabase.channel(name).on(...).subscribe()` block with:

```typescript
const unsubscribe = realtimeService.subscribe(
  { table: 'departures', filter: `class_id=eq.${classId}` },
  (payload) => { /* existing callback */ }
)
// In cleanup / useEffect return:
return () => unsubscribe()
```

Sites to update: `useDeparturesRealtime.ts`, `DashboardPage.tsx`, `ExceptionsPage.tsx`, `AuditLogPanel.tsx`, `RollCallPage.tsx` (3 channels), `studentsStore.ts`, `ClassSupervisorDashboard.tsx` (2 channels).

### 10B: Server-side cancel window enforcement

**Problem:** The 5-minute undo window in `HomePage.tsx:190` is in-memory React state. App kill/refresh removes it. Student can still cancel at the Supabase level forever.

**Update `cancel_departure` SQL RPC** to enforce the window server-side:

```sql
-- In cancel_departure RPC, add at the top of the function body (before status check):
DECLARE
  v_dep            departures%ROWTYPE;
  v_cancel_window  INT;
  v_created_at     TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_dep FROM departures WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'departure_not_found');
  END IF;

  -- Server-side cancel window for STUDENT actors only
  IF p_actor_role = 'STUDENT' THEN
    SELECT value::int INTO v_cancel_window
    FROM app_settings WHERE key = 'student_cancel_window_seconds';

    v_cancel_window := COALESCE(v_cancel_window, 300);  -- Default 5 minutes

    IF now() > v_dep.created_at + (v_cancel_window || ' seconds')::INTERVAL THEN
      RETURN jsonb_build_object('error', 'cancel_window_expired');
    END IF;
  END IF;

  -- Existing status transition logic follows...
```

**Update `HomePage.tsx`:** The countdown timer remains as UX feedback. On expiry, the button is disabled client-side. If the student somehow calls cancel after the window (e.g., via devtools), the server returns `cancel_window_expired` and the client shows an error toast.

---

## Step 11 — UI Performance + Tests + CI (~3 Weeks)

### 11A: Route-level lazy loading

**File:** `src/App.tsx:1–20`  
All 8 admin pages are statically imported. Student users download Recharts, RollCall, AuditLog, and all admin logic — none of which they ever use.

```typescript
// src/App.tsx — replace static imports with lazy:
import React, { Suspense, lazy } from 'react'

const DashboardPage         = lazy(() => import('./pages/admin/DashboardPage'))
const StudentsPage          = lazy(() => import('./pages/admin/StudentsPage'))
const ExceptionsPage        = lazy(() => import('./pages/admin/ExceptionsPage'))
const RollCallPage          = lazy(() => import('./pages/admin/RollCallPage'))
const AuditLogPage          = lazy(() => import('./pages/admin/AuditLogPage'))
const SettingsPage          = lazy(() => import('./pages/admin/SettingsPage'))
const ClassSupervisorDashboard = lazy(
  () => import('./pages/class-supervisor/ClassSupervisorDashboard')
)

// Wrap the entire authenticated router section in ONE Suspense (not per-route):
<Suspense fallback={<SplashScreen />}>
  <Routes>
    <Route path="/admin/*"            element={<AdminRoutes />} />
    <Route path="/class-supervisor/*" element={<SupervisorRoutes />} />
    {/* Student routes are already lightweight — lazy optional */}
  </Routes>
</Suspense>
```

### 11B: useMemo for chart data in DashboardPage

**File:** `src/pages/admin/DashboardPage.tsx:301–320`  
The 60-second `setTick()` animation re-renders the component with new array references for `pieData` and `gradeChartData`, causing Recharts to fully re-render even when the underlying data has not changed.

```typescript
// DashboardPage.tsx — wrap derived arrays in useMemo:

const pieData = useMemo(() => [
  { name: 'בקמפוס',      value: stats?.onCampus  ?? 0, fill: 'var(--green)' },
  { name: 'מחוץ לקמפוס', value: stats?.offCampus ?? 0, fill: 'var(--orange)' },
], [stats?.onCampus, stats?.offCampus])  // Only re-creates when counts actually change

const gradeChartData = useMemo(
  () => computeGradeBreakdown(students),
  [students]  // students reference changes only when data loads or realtime updates
)
// computeGradeBreakdown = the existing inline grade-grouping logic, extracted to a function
```

### 11C: Fix ClassSupervisorDashboard hook violation

**File:** `src/pages/class-supervisor/ClassSupervisorDashboard.tsx:477`

```typescript
// CURRENT (wrong): early return before hooks
function ClassSupervisorDashboard() {
  const { supervisorSession } = useAuthStore()
  const classId = supervisorSession?.authorizedClassIds[0]  // After Step 6

  if (!classId) return null  // ← Line 477: BEFORE useEffect calls — violates Rules of Hooks

  useEffect(() => { ... }, [classId])
  // ...
}

// FIXED: early return INSIDE hooks or at the end
function ClassSupervisorDashboard() {
  const { supervisorSession } = useAuthStore()
  const selectedClassId = supervisorSession?.authorizedClassIds[0] ?? ''

  useEffect(() => {
    if (!selectedClassId) return  // Guard INSIDE the hook, not before it
    // ... subscription setup ...
  }, [selectedClassId])

  // All hooks called unconditionally above. Early return here is safe:
  if (!selectedClassId) {
    return <div className="text-center p-8">טוען נתוני כיתה...</div>
  }

  return ( /* existing JSX */ )
}
```

### 11D: Quota formula cross-check test

The TypeScript and SQL formulas must be identical. This test validates that.

```typescript
// src/domain/__tests__/quota.test.ts

import { describe, it, expect } from 'vitest'
import { calcQuota } from '../quota'

// SQL formula: GREATEST(1, ROUND((classSize * 3)::numeric / 25))
describe('calcQuota — must match SQL formula exactly', () => {
  const cases: [number, number][] = [
    [1,  1],   // minimum: always at least 1
    [8,  1],   // ROUND(0.96) = 1
    [9,  1],   // ROUND(1.08) = 1
    [25, 3],   // ROUND(3.0) = 3
    [26, 3],   // ROUND(3.12) = 3
    [29, 3],   // ROUND(3.48) = 3
    [30, 4],   // ROUND(3.6) = 4
    [37, 4],   // ROUND(4.44) = 4
    [38, 5],   // ROUND(4.56) = 5
    [85, 10],  // ROUND(10.2) = 10 (אברכים ובוגרצ class)
  ]

  it.each(cases)('calcQuota(%i) = %i', (size, expected) => {
    expect(calcQuota(size)).toBe(expected)
  })

  it('never returns less than 1', () => {
    expect(calcQuota(0)).toBe(1)
    expect(calcQuota(1)).toBe(1)
  })
})
```

### 11E: Baseline metrics — record before starting

Measure these before Step 1 begins. Record again after each major step.

| Metric | How to measure | Target |
|---|---|---|
| Dashboard initial load | DevTools Performance → first paint after login | < 1s |
| Student list network | DevTools Network → `getStudents` response size | → `getCampusStatusCounts` call only (Step 7D) |
| Admin JS bundle size | `vite build` → largest `.js` chunk in `dist/assets/` | Reduced by ~40% after lazy loading |
| Student JS bundle size | `dist/assets/*.js` size on student routes (after Step 11A) | Recharts excluded |
| Sync queue size | `db.syncQueue.count()` in browser console | Should drain to 0; any item > 10 retries = dead-letter |
| Live departure quota check | Run sync mid-departure → query `currentStatus` immediately | Must still be `OFF_CAMPUS` (Step 1A) |

---

## Summary: Execution Order and Estimates

| Step | Description | Est. Time | Critical Dependency |
|---|---|---|---|
| 1 | Emergency fixes (5 bugs) | 1 day | None — do today |
| 2 | Student CRUD from admin dashboard | 3–5 days | Step 1 complete |
| 3 | Production verification (RPCs, grants, schema) | 1–2 days | Can run parallel with Step 2 |
| 4 | Security quick wins | 1 week | Step 3 complete |
| 5 | RLS on admin tables only | 2 days | Step 3 complete |
| 6 | Supervisor architecture (tables, migration, session, RLS on students/departures) | 3 weeks | Steps 4, 5 complete |
| 7 | Data model (runtime config, rename_class, Dexie v4, dashboard RPC) | 2 weeks | Step 6 complete |
| 8 | API layer split + mock client contract tests | 2 weeks | Step 7 complete |
| 9 | Domain layer (quota, state machine, dates, domain events) | 1 week | Step 8 complete |
| 10 | Realtime singleton + offline idempotency + cancel window | 1 week | Step 9 complete |
| 11 | UI performance + lazy loading + tests | 3 weeks | Steps 9, 10 complete |
| **Total** | | **~18–20 weeks** | |

**Most dangerous active bug:** `sync-from-sheets` resets `currentStatus` to `ON_CAMPUS` on every sync. Fix Step 1A today — one SQL migration and one TypeScript change.

**Most important architectural investment:** The `supervisors` table (Step 6). Every permission feature the user described is blocked until supervisors are first-class database entities.

---

*Based on plan-review-notes-v4.txt — 47 findings from line-by-line audit of 30+ files. All file paths and line numbers verified as of 2026-05-10.*
