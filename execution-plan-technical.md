# Yeshiva Attendance System — Technical Execution Plan

**Based on:** plan-review-notes-v4.txt (47 code-grounded findings)  
**Date:** 2026-05-10  
**Branch:** claude/review-system-plan-LxyuO  
**Status:** PLANNING DOCUMENT — Do NOT implement without explicit approval

---

## Architecture Decisions (Confirmed by User)

| Decision | Confirmed |
|---|---|
| Students: ID number only, no password, no Supabase Auth accounts | ✅ |
| Admin dashboard is primary student management (add/edit/delete from UI) | ✅ |
| Sync from Sheets = optional/annual import (not destructive source of truth) | ✅ |
| Sync must NOT overwrite currentStatus, push_token, fcm_token, deviceToken | ✅ |
| Supervisors: always only their own class, forever. Cross-class = future feature only | ✅ |
| Hard delete students when removed (CASCADE behavior preserved) | ✅ |
| Only 1 admin, forever | ✅ |
| No staging environment — safe to implement directly | ✅ |

---

## Step 1 — Emergency Production Fixes (1 Day)

These are **active defects in production today**. Fix before anything else.

### 1A: Fix sync-from-sheets overwriting student status (BUG B)

**File:** `supabase/functions/sync-from-sheets/index.ts:99`  
**Problem:** Every sync sets `currentStatus: 'ON_CAMPUS'` for all students. A student who is currently OUTSIDE (ACTIVE departure) gets their status silently reset to ON_CAMPUS.

**Fix — Create a new Supabase RPC:**

```sql
-- Migration: add_sync_student_rpc.sql
CREATE OR REPLACE FUNCTION sync_student_from_sheet(
  p_id_number TEXT,
  p_full_name TEXT,
  p_phone TEXT,
  p_grade TEXT,
  p_class_id TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO students ("idNumber", "fullName", phone, grade, "classId", "currentStatus", "createdAt")
  VALUES (p_id_number, p_full_name, p_phone, p_grade, p_class_id, 'ON_CAMPUS', now())
  ON CONFLICT ("idNumber") DO UPDATE SET
    "fullName" = EXCLUDED."fullName",
    grade      = EXCLUDED.grade,
    "classId"  = EXCLUDED."classId",
    phone      = EXCLUDED.phone;
    -- NOTE: currentStatus, push_token, fcm_token, deviceToken are NEVER updated here
END;
$$;
```

**Fix — Update sync function caller:**

```typescript
// supabase/functions/sync-from-sheets/index.ts
// Replace the bulk upsert loop with:
for (const student of students) {
  const { error } = await supabase.rpc('sync_student_from_sheet', {
    p_id_number: student.idNumber,
    p_full_name: student.fullName,
    p_phone: student.phone,
    p_grade: student.grade,
    p_class_id: student.classId,
  });
  if (error) console.error('sync_student_from_sheet error:', error);
}
```

**Test:** Student is OFF_CAMPUS with ACTIVE departure → trigger a sync → assert `students.currentStatus` is still `OFF_CAMPUS`.

---

### 1B: Remove phantom class IDs (BUG C)

**File:** `src/lib/constants/grades.ts:21–25`  
**Problem:** `getClasses()` generates IDs like `"שיעור א כיתה 1"`. Real DB values are `"כיתה הרב אבישי"`. These phantom IDs match zero students.

**Fix:**

1. Delete `getClasses()` function entirely from `src/lib/constants/grades.ts`
2. Delete `ALL_CLASS_IDS` export entirely
3. Add the correct hardcoded class list (taken from CLAUDE.md §3):

```typescript
// src/lib/constants/grades.ts — replace getClasses() with:
export const ALL_CLASS_IDS: string[] = [
  'כיתה הרב אבישי', 'כיתה הרב בועז', 'כיתה הרב הלל',
  'כיתה הרב יעקב', 'כיתה הרב משה', 'כיתה הרב תמיר',
  'כיתה הרב אהרלה', 'כיתה הרב דוד לנדאו', 'כיתה הרב דודו', 'כיתה הרב מוטי',
  'כיתה הרב בועז רויטל', 'כיתה הרב חגי', 'כיתה הרב רפי',
  'כיתה שיעור ד', 'כיתה שיעור ה',
  'כיתה אברכים ובוגרצ',
];
```

4. Find all usages of `ALL_CLASS_IDS` and `getClasses()` with grep:
   ```bash
   grep -r "ALL_CLASS_IDS\|getClasses" src/
   ```
5. Replace each usage with the new hardcoded list or a DB query as appropriate.

---

### 1C: Fix sync queue retry storm (BUG E)

**File:** `src/lib/sync/syncEngine.ts:5,73`  
**Problem:** Items retry forever. A dead item retries every 30s + every foreground/online event. No cap. No backoff.

**Fix:**

```typescript
// src/lib/sync/syncEngine.ts — replace STUCK_RETRY_THRESHOLD with:
const MAX_RETRIES = 10
const BACKOFF_BASE_MS = 30_000

// In processQueue(), replace the retry logic:
async function processQueue() {
  const items = await db.syncQueue.toArray()
  for (const item of items) {
    // Dead-letter: remove permanently failed items
    if (item.retryCount >= MAX_RETRIES) {
      await db.syncQueue.delete(item.id)
      toast.error(`פעולה נכשלה לצמיתות: ${item.type}`)
      console.error('SyncQueue dead-letter:', item)
      continue
    }
    // Exponential backoff: only retry when enough time has passed
    const nextRetryAt = (item.lastAttemptAt ?? 0) + BACKOFF_BASE_MS * Math.pow(2, item.retryCount)
    if (Date.now() < nextRetryAt) continue

    // ... existing retry logic ...
    await db.syncQueue.update(item.id, {
      retryCount: item.retryCount + 1,
      lastAttemptAt: Date.now(),
    })
  }
}
```

---

### 1D: Add idNumber correction RPC (BUG D)

**Problem:** When a student's ID number has a typo corrected in Google Sheets, the old row is deleted (CASCADE destroys all departures and history) and a new row is created.

**Fix — Create a safe correction RPC:**

```sql
-- Migration: add_correct_student_id_rpc.sql
CREATE OR REPLACE FUNCTION correct_student_id_number(
  p_old_id TEXT,
  p_new_id TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- This is a direct UPDATE on the PK-adjacent unique column.
  -- Cascade updates all FKs because student.id (UUID) doesn't change.
  UPDATE students SET "idNumber" = p_new_id WHERE "idNumber" = p_old_id;
END;
$$;
```

**Document in CLAUDE.md:** Add to section 19 (Known Debt):
> "Never rely on sync to correct a student's idNumber. A typo correction in Sheets will hard-delete the student and all their history. Instead, run `SELECT correct_student_id_number('old', 'new')` in the Supabase SQL Editor BEFORE the sync runs."

---

### 1E: Fix sync queue idempotency for INSERTs (GAP 4)

**File:** `src/lib/sync/syncEngine.ts:54–56`  
**Problem:** If a sync INSERT succeeds but the network drops before the queue item is deleted, the retry fires a duplicate INSERT → PRIMARY KEY violation → item stuck forever.

**Fix:** Pass client-generated UUID in the payload and use `ON CONFLICT DO NOTHING` on the server:

```typescript
// When queuing an INSERT operation:
const itemId = crypto.randomUUID()
await db.syncQueue.add({
  id: itemId,
  type: 'INSERT_EVENT',
  payload: { id: itemId, ...eventData }, // include id in payload
  retryCount: 0,
  createdAt: Date.now(),
})

// In supabaseClient — when replaying an INSERT event:
const { error } = await supabase
  .from('events')
  .insert(payload)
  .onConflict('id')  // PostgREST: ignoreDuplicates on conflict
// If the row already exists (idempotent retry), this is a no-op
```

---

## Step 2 — Student Management from Admin Dashboard

**User Decision:** The admin dashboard becomes the primary way to manage students. Google Sheets sync becomes an optional import (e.g., at the start of the year). Sync must NOT delete students that were added manually from the dashboard.

### 2A: Add student CRUD to admin dashboard

**New API methods to add to `src/lib/api/types.ts` (IApiClient interface):**

```typescript
// src/lib/api/types.ts
addStudent(student: {
  idNumber: string;
  fullName: string;
  phone: string;
  grade: string;
  classId: string;
}): Promise<AppResult<Student>>;

updateStudent(id: string, updates: Partial<Pick<Student,
  'fullName' | 'phone' | 'grade' | 'classId'
>>): Promise<AppResult<Student>>;

deleteStudent(id: string): Promise<AppResult<void>>;
```

**Implement in `src/lib/api/supabaseClient.ts`:**

```typescript
async addStudent(student) {
  const { data, error } = await supabase
    .from('students')
    .insert({
      ...student,
      currentStatus: 'ON_CAMPUS',
      createdAt: new Date().toISOString(),
    })
    .select()
    .single()
  if (error) return { error }
  return { data }
},

async updateStudent(id, updates) {
  const { data, error } = await supabase
    .from('students')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) return { error }
  return { data }
},

async deleteStudent(id) {
  const { error } = await supabase
    .from('students')
    .delete()
    .eq('id', id)
  if (error) return { error }
  return { data: undefined }
},
```

**New UI components to add:**

- `src/components/admin/AddStudentModal.tsx` — form with fields: שם מלא, מספר זהות, טלפון, שיעור, כיתה
- `src/components/admin/EditStudentModal.tsx` — same form pre-filled, updateStudent on save
- Add "הוסף תלמיד" button to `src/pages/admin/StudentsPage.tsx`
- Add delete button (with confirmation dialog) to each student row

**Also implement in `src/lib/api/mockClient.ts`** — same logic but against the in-memory students array.

---

### 2B: Change sync behavior — stop deleting students

**File:** `supabase/functions/sync-from-sheets/index.ts:137–143`

**Current behavior:** Students in DB but not in the Sheets payload are hard-deleted (with full CASCADE).

**New behavior:** Sync is an import/update only. It never deletes. Admin deletes from dashboard.

**Fix:**

```typescript
// supabase/functions/sync-from-sheets/index.ts
// DELETE the following block entirely (approximately lines 137-143):
// const idsInSheet = students.map(s => s.idNumber)
// await supabase.from('students').delete().not('idNumber', 'in', `(${idsInSheet.join(',')})`)

// Replace with a comment:
// NOTE: Sync does not delete students. Use admin dashboard to remove students.
// Deletion from dashboard triggers cascade (departures, events, audit log).
```

**Also update CLAUDE.md:** Revise Iron Rule #1:
> "Iron Rule #1 (UPDATED): Google Sheets is an import source, not the live source of truth. The admin dashboard is now the primary student management interface. Sync imports/updates students from Sheets but never deletes them. Deletions happen only from the admin dashboard."

---

### 2C: Add `manual_class_override` column (for future-proofing class moves)

This column marks students whose class was set manually by the admin. Sync respects it.

```sql
-- Migration: add_manual_class_override.sql
ALTER TABLE students ADD COLUMN manual_class_override BOOLEAN DEFAULT FALSE;
```

**Update `sync_student_from_sheet()` RPC (from Step 1A):**

```sql
ON CONFLICT ("idNumber") DO UPDATE SET
  "fullName" = EXCLUDED."fullName",
  grade      = CASE WHEN students.manual_class_override THEN students.grade ELSE EXCLUDED.grade END,
  "classId"  = CASE WHEN students.manual_class_override THEN students."classId" ELSE EXCLUDED."classId" END,
  phone      = EXCLUDED.phone;
  -- When manual_class_override = true, sync keeps the admin's class assignment
```

**Update `updateStudent()` in supabaseClient** — when classId is changed, set `manual_class_override = true`.

---

## Step 3 — Production Verification (1–2 Days)

**Goal:** Confirm what actually exists in the live Supabase database vs what the migrations say.

### 3A: Verify auth RPCs exist in live Supabase

Run in Supabase SQL Editor:

```sql
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'verify_admin_pin', 'verify_supervisor_pin', 'get_admin_pin_length',
    'submit_departure', 'approve_departure', 'reject_departure',
    'cancel_departure', 'return_departure', 'tick_departures',
    'sync_student_from_sheet', 'correct_student_id_number'
  );
```

**Expected:** All RPCs show up. If any are missing, apply the migrations that define them.

### 3B: Fix `change_admin_pin` GRANT issue

Run in Supabase SQL Editor:

```sql
-- Check if anon role can call change_admin_pin
SELECT grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_name = 'change_admin_pin' AND routine_schema = 'public';
```

If `anon` has EXECUTE privilege, revoke it:

```sql
REVOKE EXECUTE ON FUNCTION change_admin_pin FROM anon;
GRANT EXECUTE ON FUNCTION change_admin_pin TO authenticated;
-- Or: only to service_role if no authenticated users use this path
```

### 3C: Verify migrations are applied in order

Run in Supabase SQL Editor:

```sql
-- Check if unified departures migration ran (the MAIN migration)
SELECT COUNT(*) FROM pg_proc WHERE proname = 'submit_departure';
-- Should return 1

-- Confirm departures table has gist_exclude constraint
SELECT conname FROM pg_constraint
WHERE conrelid = 'departures'::regclass AND contype = 'x';
-- Should return the exclusion constraint
```

---

## Step 4 — Security Quick Wins / Phase 2A (1 Week)

These security fixes do NOT require the supervisor table redesign. Do these first.

### 4A: Revoke anon role from sensitive RPCs

```sql
-- Migration: revoke_anon_rpcs.sql
REVOKE EXECUTE ON FUNCTION submit_departure FROM anon;
REVOKE EXECUTE ON FUNCTION approve_departure FROM anon;
REVOKE EXECUTE ON FUNCTION reject_departure FROM anon;
REVOKE EXECUTE ON FUNCTION cancel_departure FROM anon;
REVOKE EXECUTE ON FUNCTION return_departure FROM anon;
REVOKE EXECUTE ON FUNCTION sync_student_from_sheet FROM anon;

-- These RPCs are called by authenticated client sessions only.
-- The anon key is public (in the PWA bundle). Remove its RPC access.
GRANT EXECUTE ON FUNCTION submit_departure TO authenticated;
GRANT EXECUTE ON FUNCTION approve_departure TO authenticated;
-- etc.
```

**Note:** Students log in by ID number only (no Supabase Auth accounts). Until proper auth is added, these RPCs will need to be called via service_role key from Edge Functions, or a custom auth scheme must be devised. Document this limitation.

### 4B: Fix `notify-admin-quota-full` open registration

**File:** `supabase/functions/notify-admin-quota-full/index.ts:75–87`  
**Problem:** Any POST with `action='register'` stores a push token as an admin token. No authentication.

**Fix:**

```typescript
// supabase/functions/notify-admin-quota-full/index.ts
if (action === 'register') {
  // Require a shared secret for admin device registration
  const secret = req.headers.get('X-Admin-Registration-Secret')
  const expectedSecret = Deno.env.get('ADMIN_REGISTRATION_SECRET')
  if (!secret || secret !== expectedSecret) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }
  // ... existing registration logic ...
}
```

Add `ADMIN_REGISTRATION_SECRET` to Supabase Edge Function secrets.

### 4C: Fix `p_actor_role` client-supplied trust (CRITICAL security)

**File:** `supabase/migrations/20260423_unified_departures.sql:287`  
**Problem:** Any client can pass `p_actor_role = 'ADMIN'` and bypass quota entirely.

**Immediate mitigation** (before the full supervisor table redesign in Step 6):

```sql
-- In submit_departure: add a PIN verification step for ADMIN_OVERRIDE
-- Replace:
IF p_source = 'ADMIN_OVERRIDE' AND p_actor_role NOT IN ('ADMIN', 'SUPERVISOR') THEN

-- With a PIN check (uses the existing app_settings.admin_pin):
CREATE OR REPLACE FUNCTION _verify_actor_pin(
  p_actor_role TEXT,
  p_actor_pin TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  v_admin_pin TEXT;
BEGIN
  IF p_actor_role = 'ADMIN' THEN
    SELECT value INTO v_admin_pin FROM app_settings WHERE key = 'admin_pin';
    RETURN p_actor_pin = v_admin_pin;
  END IF;
  -- For SUPERVISOR: verify class code combination
  -- (Full supervisor table verification comes in Step 6)
  RETURN FALSE;
END; $$;

-- In submit_departure, change the ADMIN_OVERRIDE check:
IF p_source = 'ADMIN_OVERRIDE' THEN
  IF NOT _verify_actor_pin(p_actor_role, p_actor_pin) THEN
    RETURN jsonb_build_object('error', 'unauthorized_override');
  END IF;
END IF;
```

**Update `submit_departure` RPC signature** to accept `p_actor_pin TEXT` parameter.  
**Update `supabaseClient.ts`** to pass the admin PIN when calling `submit_departure` with `ADMIN_OVERRIDE`.

### 4D: Add client-side realtime privacy filter

**File:** `src/hooks/useDeparturesRealtime.ts:41`  
**Problem:** Every subscriber gets all departure changes regardless of filters passed.

**Fix — Apply filters in the channel subscription:**

```typescript
// src/hooks/useDeparturesRealtime.ts
const filter = options.classId
  ? `class_id=eq.${options.classId}`
  : options.studentId
  ? `student_id=eq.${options.studentId}`
  : undefined

const channel = supabase.channel('departures-realtime')
  .on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'departures',
      filter,  // Apply the filter here
    },
    (payload) => {
      // existing callback
    }
  )
  .subscribe()
```

---

## Step 5 — Add RLS (Row Level Security) on Admin Tables (Phase 2A, subset)

These tables can be locked down without a supervisor identity model:

```sql
-- Migration: rls_admin_tables.sql

-- Enable RLS on app_settings (only service_role or admin should write)
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_settings_read" ON app_settings
  FOR SELECT USING (true);  -- Read-only for all (settings are not sensitive individually)
CREATE POLICY "admin_settings_write" ON app_settings
  FOR ALL USING (auth.role() = 'service_role');

-- Enable RLS on admin_overrides (read only, no anonymous write)
ALTER TABLE admin_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_read" ON admin_overrides
  FOR SELECT USING (true);
CREATE POLICY "audit_no_direct_write" ON admin_overrides
  FOR INSERT USING (false);  -- Written only by DB trigger, not directly
```

**Note:** Full RLS on `students` and `departures` tables MUST wait until Step 6 (supervisor identity model). Without it, we can't write correct RLS policies for supervisors.

---

## Step 6 — Supervisor Architecture Redesign (Phase 7A + 7B, ~3 Weeks)

**This is the most important structural investment.** Every future permission feature depends on it.

### 6A: Create supervisors tables

```sql
-- Migration: create_supervisors_tables.sql

CREATE TABLE supervisors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,           -- bcrypt hash
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,           -- NULL = permanent (for future time-window permissions)
  created_by TEXT                   -- admin who provisioned this supervisor
);

CREATE TABLE supervisor_classes (
  supervisor_id UUID REFERENCES supervisors(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL,           -- matches students.classId exactly
  can_approve BOOLEAN DEFAULT true,
  can_view_gps BOOLEAN DEFAULT false,
  PRIMARY KEY (supervisor_id, class_id)
);

-- Index for RPC lookups
CREATE INDEX idx_supervisor_classes_class ON supervisor_classes(class_id);
```

### 6B: Migrate from PIN scheme to supervisors table

```sql
-- Migration: migrate_pins_to_supervisors.sql
-- Run AFTER supervisors tables exist

DO $$
DECLARE
  r RECORD;
  v_admin_pin TEXT;
  v_class_id TEXT;
  v_code TEXT;
  v_pin TEXT;
  v_supervisor_id UUID;
BEGIN
  SELECT value INTO v_admin_pin FROM app_settings WHERE key = 'admin_pin';

  FOR r IN SELECT key, value FROM app_settings WHERE key LIKE 'class_code_%' LOOP
    v_class_id := substring(r.key FROM length('class_code_') + 1);
    v_code := r.value;
    v_pin := v_admin_pin || v_code;

    INSERT INTO supervisors (full_name, pin_hash, created_by)
    VALUES (
      'רכז ' || v_class_id,
      -- Use pgcrypto to hash: crypt(v_pin, gen_salt('bf'))
      -- For now, store plaintext with a TODO to add bcrypt
      v_pin,
      'migration'
    )
    RETURNING id INTO v_supervisor_id;

    INSERT INTO supervisor_classes (supervisor_id, class_id, can_approve)
    VALUES (v_supervisor_id, v_class_id, true);

    -- Remove old key-value entry
    DELETE FROM app_settings WHERE key = r.key;
  END LOOP;
END;
$$;
```

### 6C: Rewrite verify_supervisor_pin RPC

```sql
-- Migration: rewrite_verify_supervisor_pin.sql

CREATE OR REPLACE FUNCTION verify_supervisor_pin(p_pin TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_supervisor supervisors%ROWTYPE;
  v_class_ids TEXT[];
BEGIN
  -- Find supervisor by PIN (plaintext comparison for now; add bcrypt in Phase 7B final)
  SELECT * INTO v_supervisor
  FROM supervisors
  WHERE pin_hash = p_pin
    AND (expires_at IS NULL OR expires_at > now());

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'invalid_pin');
  END IF;

  -- Get all authorized class IDs
  SELECT array_agg(class_id) INTO v_class_ids
  FROM supervisor_classes
  WHERE supervisor_id = v_supervisor.id;

  RETURN jsonb_build_object(
    'supervisorId', v_supervisor.id::text,
    'fullName', v_supervisor.full_name,
    'authorizedClassIds', v_class_ids
  );
END;
$$;
```

### 6D: Update approve_departure RPC supervisor check

Replace the broken check (Bug A) with:

```sql
-- In approve_departure RPC, replace the supervisor check block:
IF p_actor_role = 'SUPERVISOR' THEN
  IF NOT EXISTS (
    SELECT 1 FROM supervisor_classes sc
    JOIN supervisors s ON s.id = sc.supervisor_id
    WHERE s.id::text = p_actor_id
      AND sc.class_id = v_dep.class_id
      AND sc.can_approve = true
      AND (s.expires_at IS NULL OR s.expires_at > now())
  ) THEN
    RETURN jsonb_build_object('error', 'supervisor_not_authorized_for_class');
  END IF;
END IF;
```

Apply the same fix to `reject_departure` and `cancel_departure` RPCs.

### 6E: Update authStore to use new session format

**File:** `src/store/authStore.ts`

```typescript
// src/lib/auth/supervisorAuth.ts — replace ClassSupervisorInfo:
export interface ClassSupervisorSession {
  supervisorId: string;           // UUID from supervisors table
  fullName: string;
  authorizedClassIds: string[];   // can be multiple in the future
  expiresAt?: number;             // from supervisors.expires_at
}

// src/store/authStore.ts — replace:
// classSupervisor: ClassSupervisorInfo | null
// with:
supervisorSession: ClassSupervisorSession | null

// loginClassSupervisor action:
loginClassSupervisor: async (pin: string) => {
  const { data, error } = await supabase.rpc('verify_supervisor_pin', { p_pin: pin })
  if (error || data?.error) return false
  set({
    supervisorSession: {
      supervisorId: data.supervisorId,
      fullName: data.fullName,
      authorizedClassIds: data.authorizedClassIds,
    }
  })
  return true
}
```

### 6F: Update ClassSupervisorDashboard

**File:** `src/pages/class-supervisor/ClassSupervisorDashboard.tsx`

1. Replace `const classId = classSupervisor?.classId ?? ''` (line 447) with:
   ```typescript
   const { supervisorSession } = useAuthStore()
   const authorizedClassIds = supervisorSession?.authorizedClassIds ?? []
   const [selectedClassId, setSelectedClassId] = useState(authorizedClassIds[0] ?? '')
   ```

2. Replace literal `actorId: 'supervisor'` (line 189) with:
   ```typescript
   actorId: supervisorSession?.supervisorId ?? ''
   ```

3. Add class picker when `authorizedClassIds.length > 1` (for future multi-class support):
   ```tsx
   {authorizedClassIds.length > 1 && (
     <Select value={selectedClassId} onValueChange={setSelectedClassId}>
       {authorizedClassIds.map(id => (
         <SelectItem key={id} value={id}>{id}</SelectItem>
       ))}
     </Select>
   )}
   ```

### 6G: RLS on students and departures (Phase 2B, after supervisor tables exist)

```sql
-- Migration: rls_students_departures.sql
-- ONLY apply after supervisors + supervisor_classes tables exist

ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE departures ENABLE ROW LEVEL SECURITY;

-- Students: supervisors see only their class(es)
-- Note: Until Supabase Auth is integrated, this uses a custom session approach
-- For now, use service_role from Edge Functions (full access)
-- and restrict the anon key from all student reads:

CREATE POLICY "no_anon_student_read" ON students
  FOR SELECT USING (auth.role() != 'anon');

CREATE POLICY "no_anon_departure_read" ON departures
  FOR SELECT USING (auth.role() != 'anon');

-- Full per-supervisor RLS requires Supabase Auth JWT claims
-- (This is the outstanding known debt — requires student auth redesign)
```

---

## Step 7 — Data Model & DB Contract (Phase 3, ~2 Weeks)

### 7A: Runtime configuration service

**Migration — add config keys to app_settings:**

```sql
-- Migration: add_runtime_config.sql
INSERT INTO app_settings (key, value) VALUES
  ('campus_lat', '31.5253'),
  ('campus_lng', '35.1056'),
  ('campus_radius_meters', '300'),
  ('area_radius_meters', '5000'),
  ('undo_window_seconds', '300'),
  ('sync_retry_max', '10'),
  ('push_template_departure_approved', 'בוקר טוב! היציאה שלך אושרה, לך בשלום 🎉')
ON CONFLICT (key) DO NOTHING;
```

**Create config service:**

```typescript
// src/services/config/appConfig.ts
const CONFIG_KEYS = [
  'campus_lat', 'campus_lng', 'campus_radius_meters', 'area_radius_meters',
  'undo_window_seconds', 'sync_retry_max', 'push_template_departure_approved',
] as const

type ConfigKey = typeof CONFIG_KEYS[number]

let config: Record<string, string> = {}
let loaded = false

export async function loadConfig(): Promise<void> {
  const { data } = await supabase
    .from('app_settings')
    .select('key,value')
    .in('key', CONFIG_KEYS)
  if (data) {
    config = Object.fromEntries(data.map(r => [r.key, r.value]))
    loaded = true
  }
}

export function getConfig(key: ConfigKey): string {
  if (!loaded) throw new Error('Config not loaded. Call loadConfig() first.')
  return config[key]
}

export function getConfigNumber(key: ConfigKey): number {
  return parseFloat(getConfig(key))
}
```

**Update consumers:**

- `src/lib/location/gps.ts:5–8` — delete `CAMPUS_LAT`, `CAMPUS_LNG`, `CAMPUS_RADIUS_METERS`. Replace with `getConfigNumber('campus_lat')` etc.
- `src/pages/student/HomePage.tsx:190` — replace `5 * 60 * 1000` with `getConfigNumber('undo_window_seconds') * 1000`
- `src/lib/api/supabaseClient.ts:241` — replace hardcoded Hebrew string with `getConfig('push_template_departure_approved')`
- `src/lib/sync/syncEngine.ts:5` — replace `STUCK_RETRY_THRESHOLD` with `getConfigNumber('sync_retry_max')`

**Call `loadConfig()` in `src/App.tsx`** on startup, before rendering any authenticated page.

### 7B: rename_class() RPC — prevents silent quota corruption

```sql
-- Migration: add_rename_class_rpc.sql
CREATE OR REPLACE FUNCTION rename_class(p_old_id TEXT, p_new_id TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Update all students
  UPDATE students SET "classId" = p_new_id WHERE "classId" = p_old_id;

  -- Update all departures (including historical — they should reflect the rename)
  UPDATE departures SET class_id = p_new_id WHERE class_id = p_old_id;

  -- Update supervisor_classes join table
  UPDATE supervisor_classes SET class_id = p_new_id WHERE class_id = p_old_id;

  -- Update app_settings if any class_code_ keys remain (should be none after Step 6)
  UPDATE app_settings
  SET key = 'class_code_' || p_new_id
  WHERE key = 'class_code_' || p_old_id;

  RAISE NOTICE 'Class renamed: % → %', p_old_id, p_new_id;
END;
$$;
```

**Update sync-from-sheets** to detect renames:

```typescript
// supabase/functions/sync-from-sheets/index.ts
// After getting existing DB classes and new sheet classes:
const existingClasses = await supabase.from('students').select('"classId"').distinct()
const incomingClasses = new Set(students.map(s => s.classId))

// Detect potential renames: class disappeared + new class appeared in same grade
for (const oldClassId of existingClasses) {
  if (!incomingClasses.has(oldClassId)) {
    // Class disappeared — check if a new class appeared in the same grade
    const oldGrade = students.find... // find grade from DB
    const newClass = [...incomingClasses].find(c => c is in same grade and not in DB)
    if (newClass) {
      console.log(`Detected rename: ${oldClassId} → ${newClass}`)
      await supabase.rpc('rename_class', { p_old_id: oldClassId, p_new_id: newClass })
    }
  }
}
```

### 7C: Dexie schema v4 — remove absenceRequests

**File:** `src/lib/db/schema.ts`

```typescript
// src/lib/db/schema.ts
const db = new Dexie('YeshivaAttendanceDB')
db.version(4).stores({
  events: 'id, studentId, type, timestamp',
  students: 'id, idNumber, classId, currentStatus',
  syncQueue: '++id, type, retryCount, lastAttemptAt',
  // absenceRequests: REMOVED — table no longer exists
}).upgrade(tx => {
  // No data migration needed — absenceRequests is empty/unused
  return tx.table('absenceRequests')?.clear()
})
```

### 7D: Dashboard aggregation RPC (performance)

**Problem:** `DashboardPage.tsx:181` loads all 381 students to compute 3 numbers.

```sql
-- Migration: add_dashboard_aggregation_rpc.sql
CREATE OR REPLACE FUNCTION get_campus_status_counts()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT jsonb_build_object(
    'onCampus',  COUNT(*) FILTER (WHERE "currentStatus" = 'ON_CAMPUS'),
    'offCampus', COUNT(*) FILTER (WHERE "currentStatus" IN ('OFF_CAMPUS', 'OVERDUE')),
    'pending',   COUNT(*) FILTER (WHERE "currentStatus" = 'PENDING')
  )
  FROM students;
$$;
```

**Update DashboardPage.tsx:**

```typescript
// Replace the api.getStudents() call for the pie chart with:
const { data: counts } = await supabase.rpc('get_campus_status_counts')
// { onCampus: 312, offCampus: 65, pending: 4 }
// Use these 3 numbers for the pie chart — no need to load 381 student rows
```

---

## Step 8 — API Layer Split + Mock Client Contract Tests (Phase 4, ~2 Weeks)

### 8A: Fix the 5 mock client divergences

**File:** `src/lib/api/mockClient.ts`

**Divergence 1 — createEvent() missing status update:**
```typescript
// mockClient.ts createEvent() — add after event insert:
if (event.type === 'CHECK_IN') {
  const student = this.students.find(s => s.id === event.studentId)
  if (student) student.currentStatus = 'ON_CAMPUS'
} else if (event.type === 'CHECK_OUT') {
  const student = this.students.find(s => s.id === event.studentId)
  if (student) student.currentStatus = 'OFF_CAMPUS'
}
```

**Divergence 2 — getDashboardStats() total:**
```typescript
// mockClient.ts getDashboardStats() — change:
// FROM: total: students.length
// TO:
const activeSudents = students.filter(s => s.currentStatus !== 'PENDING')
total: activeStudents.length
```

**Divergence 3 — listDepartures() class filter:**
```typescript
// mockClient.ts listDepartures() — change:
// FROM: filtering by current student.classId
// TO: filtering by departure.class_id (snapshot value)
departures = departures.filter(d => d.class_id === options.classId)
// (Use the class_id stored on the departure row, not the student's current class)
```

**Divergence 4 — approveDeparture() missing push simulation:**
```typescript
// mockClient.ts approveDeparture() — add:
// Simulate push notification (log to console in mock mode)
console.log(`[Mock] Push notification sent to student ${departure.student_id}: approved`)
```

**Divergence 5 — createAdminOverride() audit count:**
```typescript
// mockClient.ts createAdminOverride() — change:
// FROM: direct status write + single audit entry
// TO: call this.cancelDeparture() per departure (matching supabaseClient behavior)
for (const dep of activeDepartures) {
  await this.cancelDeparture(dep.id, override.note)
}
```

### 8B: Add contract tests

Create `src/lib/api/__tests__/contract.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { createMockClient } from '../mockClient'
import { createTestSupabaseClient } from '../testHelpers'

const implementations = [
  { name: 'mockClient', client: createMockClient() },
  // { name: 'supabaseClient', client: createTestSupabaseClient() },
]

describe.each(implementations)('IApiClient contract — $name', ({ client }) => {
  it('createEvent CHECK_IN sets student status to ON_CAMPUS', async () => {
    const student = await client.getStudent(TEST_STUDENT_ID)
    // ... set student OFF_CAMPUS first ...
    await client.createEvent({ studentId: student.id, type: 'CHECK_IN', timestamp: new Date() })
    const updated = await client.getStudent(student.id)
    expect(updated.currentStatus).toBe('ON_CAMPUS')
  })

  it('getDashboardStats total excludes PENDING students', async () => {
    const stats = await client.getDashboardStats()
    expect(stats.total).toBe(stats.onCampus + stats.offCampus)
    // Should not include PENDING
  })

  // ... one test per divergence ...
})
```

### 8C: Split supabaseClient.ts by domain

The current `supabaseClient.ts` is ~700 lines. Split into:

```
src/lib/api/
  supabaseClient.ts          — barrel export, creates client
  clients/
    studentClient.ts         — getStudent, getStudents, updateStudent, addStudent, deleteStudent
    departureClient.ts       — listDepartures, submitDeparture, approveDeparture, etc.
    eventClient.ts           — createEvent, getStudentHistory
    adminClient.ts           — getDashboardStats, getAuditLog, createAdminOverride
    configClient.ts          — getConfig (wraps app_settings queries)
```

---

## Step 9 — Domain Layer (Phase 5, ~1 Week)

Create pure TypeScript domain files — no Supabase, no React, no side effects.

### 9A: Quota domain

```typescript
// src/domain/quota.ts
// This file is the SINGLE source of truth for quota calculation.
// The submit_departure RPC SQL must use IDENTICAL formula.

export function calcQuota(classSize: number): number {
  return Math.max(1, Math.round((classSize * 3) / 25))
}

export function isQuotaAvailable(
  currentOut: number,
  classSize: number
): boolean {
  return currentOut < calcQuota(classSize)
}
```

### 9B: Departure state machine domain

```typescript
// src/domain/departureTransitions.ts
type DepartureStatus = 'PENDING' | 'APPROVED' | 'ACTIVE' | 'COMPLETED' | 'REJECTED' | 'CANCELLED'

const VALID_TRANSITIONS: Record<DepartureStatus, DepartureStatus[]> = {
  PENDING:   ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED:  ['ACTIVE', 'CANCELLED'],
  ACTIVE:    ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  REJECTED:  [],
  CANCELLED: [],
}

export function canTransition(from: DepartureStatus, to: DepartureStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

export function isTerminal(status: DepartureStatus): boolean {
  return VALID_TRANSITIONS[status].length === 0
}
```

### 9C: Israel date utilities

```typescript
// src/domain/israelDate.ts
const TZ = 'Asia/Jerusalem'

export function nowInJerusalem(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TZ }))
}

export function toJerusalemISOString(date: Date): string {
  // Returns ISO string adjusted for Jerusalem timezone
  const offset = getJerusalemOffset(date)
  const local = new Date(date.getTime() + offset * 60_000)
  return local.toISOString().replace('Z', `+0${Math.floor(offset / 60)}:00`)
}
```

### 9D: Domain events bus

```typescript
// src/services/events/domainEvents.ts
type DepartureEvent =
  | { type: 'departure.submitted';  departureId: string; studentId: string; classId: string }
  | { type: 'departure.approved';   departureId: string; studentId: string; approvedBy: string; pushToken?: string }
  | { type: 'departure.rejected';   departureId: string; studentId: string; rejectedBy: string }
  | { type: 'departure.cancelled';  departureId: string; studentId: string; cancelledBy: string }
  | { type: 'departure.returned';   departureId: string; studentId: string }

type EventHandler<T extends DepartureEvent> = (event: T) => void | Promise<void>

class DomainEventBus {
  private handlers = new Map<string, EventHandler<any>[]>()

  on<T extends DepartureEvent>(type: T['type'], handler: EventHandler<T>) {
    const list = this.handlers.get(type) ?? []
    this.handlers.set(type, [...list, handler])
  }

  async emit(event: DepartureEvent) {
    const handlers = this.handlers.get(event.type) ?? []
    await Promise.allSettled(handlers.map(h => h(event)))
  }
}

export const domainEvents = new DomainEventBus()

// Push notification subscriber — registered at app startup:
// domainEvents.on('departure.approved', sendApprovalPush)
```

**Update `supabaseClient.ts` `approveDeparture()`:**

```typescript
// After approve_departure RPC succeeds:
// OLD: call _sendApprovalPush() (fire-and-forget, 2 extra round-trips)
// NEW: emit domain event (push is sent by a registered subscriber)
await domainEvents.emit({
  type: 'departure.approved',
  departureId: id,
  studentId: data.student_id,    // RPC now returns this
  approvedBy: actorId,
  pushToken: data.push_token,    // RPC now returns this too (no extra round-trip)
})
```

**Update `approve_departure` RPC** to return `student_id` and `push_token` in its response.

---

## Step 10 — Realtime + Offline + Push (Phase 8, ~1 Week)

### 10A: Singleton Realtime Service

**Problem:** 8+ raw `supabase.channel()` calls scattered across the codebase. Concurrent mounts double callbacks.

```typescript
// src/services/realtime/realtimeService.ts
import { supabase } from '../api/supabaseClient'
import type { RealtimeChannel } from '@supabase/supabase-js'

type RealtimeFilter = {
  table: string
  filter?: string  // e.g., 'class_id=eq.כיתה הרב אבישי'
}

type RealtimeCallback = (payload: any) => void

class RealtimeService {
  private channels = new Map<string, RealtimeChannel>()
  private subscribers = new Map<string, Set<RealtimeCallback>>()

  subscribe(filter: RealtimeFilter, callback: RealtimeCallback): () => void {
    const key = `${filter.table}:${filter.filter ?? '*'}`

    if (!this.channels.has(key)) {
      const channel = supabase.channel(key)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: filter.table,
          filter: filter.filter,
        }, (payload) => {
          this.subscribers.get(key)?.forEach(cb => cb(payload))
        })
        .subscribe()
      this.channels.set(key, channel)
      this.subscribers.set(key, new Set())
    }

    this.subscribers.get(key)!.add(callback)

    return () => {
      this.subscribers.get(key)?.delete(callback)
      if (this.subscribers.get(key)?.size === 0) {
        this.channels.get(key)?.unsubscribe()
        this.channels.delete(key)
        this.subscribers.delete(key)
      }
    }
  }
}

export const realtimeService = new RealtimeService()
```

**Update `useDeparturesRealtime.ts`** to use `realtimeService.subscribe()` instead of raw `supabase.channel()`.

**Replace all 8 raw channel calls** (DashboardPage, ExceptionsPage, AuditLogPanel, RollCallPage, studentsStore, ClassSupervisorDashboard) with `realtimeService.subscribe()`.

### 10B: Server-side cancel window enforcement

**Update `cancel_departure` RPC:**

```sql
-- In cancel_departure RPC, add for STUDENT cancellations:
IF p_actor_role = 'STUDENT' THEN
  DECLARE
    v_created_at TIMESTAMPTZ;
    v_window_seconds INT;
  BEGIN
    SELECT created_at INTO v_created_at FROM departures WHERE id = p_id;
    SELECT value::int INTO v_window_seconds FROM app_settings WHERE key = 'undo_window_seconds';

    IF now() > v_created_at + (v_window_seconds || ' seconds')::INTERVAL THEN
      RETURN jsonb_build_object('error', 'undo_window_expired');
    END IF;
  END;
END IF;
```

---

## Step 11 — UI Performance + Tests + CI (Phases 9–11, ~3 Weeks)

### 11A: Route-level lazy loading

**File:** `src/App.tsx:1–20`  
All 8 admin pages are statically imported. Student users download the entire admin bundle.

```typescript
// src/App.tsx — replace static imports with React.lazy():
const DashboardPage = React.lazy(() => import('./pages/admin/DashboardPage'))
const StudentsPage = React.lazy(() => import('./pages/admin/StudentsPage'))
const ExceptionsPage = React.lazy(() => import('./pages/admin/ExceptionsPage'))
const RollCallPage = React.lazy(() => import('./pages/admin/RollCallPage'))
const AuditLogPage = React.lazy(() => import('./pages/admin/AuditLogPage'))
const SettingsPage = React.lazy(() => import('./pages/admin/SettingsPage'))
const ClassSupervisorDashboard = React.lazy(
  () => import('./pages/class-supervisor/ClassSupervisorDashboard')
)

// Wrap routes in Suspense:
<Suspense fallback={<SplashScreen />}>
  <Route path="/admin/dashboard" element={<DashboardPage />} />
  ...
</Suspense>
```

### 11B: useMemo for chart data in DashboardPage

**File:** `src/pages/admin/DashboardPage.tsx:301–320`  
The 60-second animation tick causes chart re-renders even when data hasn't changed.

```typescript
// DashboardPage.tsx
const pieData = useMemo(() => [
  { name: 'בקמפוס', value: stats?.onCampus ?? 0, color: 'var(--green)' },
  { name: 'מחוץ לקמפוס', value: stats?.offCampus ?? 0, color: 'var(--orange)' },
], [stats?.onCampus, stats?.offCampus])

const gradeChartData = useMemo(() => 
  computeGradeBreakdown(students),
  [students]
)
```

### 11C: Fix ClassSupervisorDashboard hook violation

**File:** `src/pages/class-supervisor/ClassSupervisorDashboard.tsx:477`  
Early return before hooks violates React rules.

```typescript
// ClassSupervisorDashboard.tsx — move the early return AFTER all hooks:
// WRONG (current):
if (!classId) return null  // line 477 — BEFORE useEffect calls

// CORRECT:
// Keep all hooks at the top. Use classId in hook conditions:
useEffect(() => {
  if (!classId) return  // Early return INSIDE the hook, not before it
  // ... effect logic ...
}, [classId])

// At the bottom of the component, after all hooks:
if (!classId) return <LoadingSpinner />
```

### 11D: Quota formula cross-check test

```typescript
// src/domain/__tests__/quota.test.ts
import { calcQuota } from '../quota'

describe('calcQuota formula — must match SQL: GREATEST(1, ROUND((classSize * 3)::numeric / 25))', () => {
  const cases = [
    { size: 1,  expected: 1 },
    { size: 9,  expected: 1 },
    { size: 25, expected: 3 },
    { size: 26, expected: 3 },
    { size: 30, expected: 4 },
    { size: 85, expected: 10 },
  ]
  it.each(cases)('calcQuota($size) = $expected', ({ size, expected }) => {
    expect(calcQuota(size)).toBe(expected)
  })
})
```

### 11E: Baseline metrics to track improvement

Record these **before** starting, and again **after** each phase:

| Metric | How to measure | Baseline |
|---|---|---|
| Student list load time | DevTools Network — `getStudents` request | ? ms |
| Dashboard load time | DevTools — time to first chart render | ? ms |
| Admin JS bundle size | `vite build` → dist/assets/*.js size | ? KB |
| Student JS bundle size | After lazy loading — chunk for student routes | ? KB |
| Sync queue dead items | `db.syncQueue.where('retryCount').above(10).count()` | ? |

---

## Summary: Correct Phase Order

| Phase | What | Est. Time |
|---|---|---|
| Step 1 | Emergency production fixes (5 bugs) | 1 day |
| Step 2 | Student management from admin dashboard | 3–5 days |
| Step 3 | Production verification (RPCs, grants) | 1–2 days |
| Step 4 | Security quick wins (anon revoke, notify-admin fix, actor_role fix) | 1 week |
| Step 5 | RLS on admin tables (app_settings, admin_overrides) | 2 days |
| Step 6 | Supervisor architecture redesign (tables, migration, session) | 3 weeks |
| Step 7 | Data model (runtime config, rename_class, Dexie v4, dashboard RPC) | 2 weeks |
| Step 8 | API layer split + mock client fixes + contract tests | 2 weeks |
| Step 9 | Domain layer (quota, state machine, dates, domain events) | 1 week |
| Step 10 | Realtime singleton + offline idempotency + cancel window | 1 week |
| Step 11 | UI performance + lazy loading + tests + CI | 3 weeks |
| **Total** | | **~18–20 weeks** |

**The single most dangerous bug in production right now:**  
`sync-from-sheets` resets every student's status to `ON_CAMPUS` on every sync. A student who is currently outside (ACTIVE departure) has their DB status silently corrupted. **Fix Step 1A first, today.**

**The single most important architectural investment:**  
The `supervisors` table (Step 6). Every future permission feature traces back to supervisors being first-class entities. Build it before writing any services layer.

---

*This document was generated from `plan-review-notes-v4.txt` — a deep code review by 3 parallel agents scanning 30+ files line-by-line. All file paths and line numbers are exact as of 2026-05-10.*
