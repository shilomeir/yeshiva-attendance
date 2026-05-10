# Efficiency Project — Session Context

> **Read this file when the user says "efficiency project" or "continue the digestion project".**
> It describes exactly where this work left off and what comes next.

---

## What This Project Is

A full architectural review and improvement plan for the yeshiva attendance system.
**No code has been changed yet.** All work so far is planning documents.

Working branch: `claude/review-system-plan-LxyuO`

---

## Current Status: PLANNING COMPLETE — AWAITING IMPLEMENTATION APPROVAL

Three documents exist in the project root (all committed on branch above):

| File | Purpose |
|------|---------|
| `execution-plan-technical.md` | 11-step implementation guide with exact SQL/TypeScript, file paths, line numbers |
| `execution-plan-hebrew.md` | Hebrew plain-language explanation for the non-programmer owner |
| `plan-review-notes-v4.txt` | Deep line-by-line code scan findings (47 grounded issues) that informed the plan |

**Do NOT implement any step without the user saying "go ahead" or explicitly approving.**

---

## What the Plan Found (high-level)

### 5 Active Production Bugs (Step 1 — Emergency)

| ID | Bug | File | Impact |
|----|-----|------|--------|
| A | Supervisor departure check uses literal `'supervisor'` string | `ClassSupervisorDashboard.tsx:189` | Any supervisor can cancel any student's departure |
| B | Sync resets every student's status to ON_CAMPUS on every run | `sync-from-sheets/index.ts:99` | All statuses corrupted after every Google Sheets sync |
| C | `getClasses()` generates phantom class IDs that don't exist in DB | `constants/grades.ts:21-25` | UI shows classes that have no students; quota fails |
| D | Students can submit departure with mismatched idNumber | `supabaseClient.ts` | Data integrity |
| E | Sync queue: stuck items never truly retried (only badge updated) | `syncEngine.ts:5,73` | Offline operations silently lost |

### Architecture Issues (Steps 2–11)

- Student CRUD needs to move to admin dashboard (currently Sheets-only, user wants UI)
- Supervisor auth uses PIN concatenation stored in `app_settings`; needs proper `supervisors` table with bcrypt
- RLS is completely absent — anyone with the anon key can read all 381 students' data
- `useDeparturesRealtime` filter options are stored but never applied (every subscriber gets all departures)
- 8+ raw Supabase `channel()` calls scattered across pages (no singleton)
- `supabaseClient.ts` and `mockClient.ts` have 5 behavioral divergences
- `DashboardPage.tsx:181` loads all 381 students to compute 3 numbers for a pie chart
- React routes are all statically imported (student downloads full admin bundle)

---

## Architecture Decisions Locked In (don't re-debate)

1. **Students: ID number only, no Supabase Auth accounts** — students use public anon key
2. **Admin dashboard = primary student management** — add/edit/delete from UI
3. **Google Sheets sync = non-destructive import only** — no more hard-deletes from sync
4. **Sync must NOT overwrite** `currentStatus`, `push_token`, `fcm_token`, `deviceToken`
5. **Supervisors: always only their own class** — no cross-class access, ever
6. **Hard delete with CASCADE preserved** — if student is deleted from UI, all history is deleted
7. **Only 1 admin, forever**
8. **No staging environment** — changes go directly to production Supabase

---

## Critical Security Warning (Step 4)

When adding RLS or revoking anon permissions, **never** revoke anon from:
- `submit_departure` RPC
- `cancel_departure` RPC
- `return_departure` RPC

Students use the **public anon key** (no Supabase Auth). Revoking anon from these RPCs silently breaks all student functionality. Only admin-only RPCs (approve/reject/change_admin_pin/sync) are safe to restrict to authenticated roles.

---

## The 11 Steps in Order

```
Step 1:  Emergency Production Fixes — 1 day (do first, before anything else)
Step 2:  Student CRUD from Admin Dashboard — 3-5 days
Step 3:  Production Verification — 1-2 days
Step 4:  Security Quick Wins — 1 week
Step 5:  RLS on admin tables only (app_settings, admin_overrides) — 2 days
Step 6:  Supervisor Architecture (new supervisors table, bcrypt) — 3 weeks
Step 7:  Data Model (runtime config, Dexie v4, campus status counts RPC) — 2 weeks
Step 8:  API Layer Split + Contract Tests — 2 weeks
Step 9:  Domain Layer (domain events, date utilities, quota module) — 1 week
Step 10: Realtime + Offline (singleton RealtimeService, cancel window) — 1 week
Step 11: UI Performance + Tests (lazy loading, useMemo, hook fix) — 3 weeks
```

**Next step if user approves:** Start Step 1A — the sync-from-sheets fix.

---

## Step 1A — What to Do First

**The single most dangerous active bug:** `sync-from-sheets` resets every student's `currentStatus` to `ON_CAMPUS` on every sync because the upsert includes `currentStatus: 'ON_CAMPUS'` in the payload.

**Fix:**
1. Create SQL RPC `sync_student_from_sheet(p_id_number TEXT, p_full_name TEXT, p_phone TEXT, p_grade TEXT, p_class_id TEXT)` that upserts only identity fields, never touches `currentStatus`/`push_token`/`fcm_token`/`deviceToken`
2. Update `supabase/functions/sync-from-sheets/index.ts` to call this RPC in batches of 50 via `Promise.all()` instead of bulk upsert
3. New migration file: `supabase/migrations/20260510_sync_student_rpc.sql`

The exact SQL and TypeScript are in `execution-plan-technical.md` under "Step 1A".

---

## Key File Locations

```
execution-plan-technical.md          — Full implementation guide (read before coding)
execution-plan-hebrew.md             — Hebrew version for owner review
plan-review-notes-v4.txt             — Raw code scan findings

src/store/authStore.ts:20            — classSupervisor: single object (needs → supervisorSession)
src/hooks/useDeparturesRealtime.ts:41 — filter options never applied
src/pages/admin/DashboardPage.tsx:181 — loads all students for 3-number pie chart
src/pages/class-supervisor/ClassSupervisorDashboard.tsx:189 — actorId: 'supervisor' literal (Bug A)
src/pages/class-supervisor/ClassSupervisorDashboard.tsx:477 — early return before hooks (Rules violation)
src/lib/constants/grades.ts:21-25    — phantom class IDs generated (Bug C)
src/lib/sync/syncEngine.ts:5,73      — retry cap never enforced (Bug E)
supabase/functions/sync-from-sheets/index.ts:99 — currentStatus reset on every sync (Bug B)
supabase/migrations/20260423_unified_departures.sql:287 — p_actor_role trusted from client
supabase/migrations/20260423_unified_departures.sql:466-475 — broken supervisor check (Bug A source)
```

---

## Git State

- Branch: `claude/review-system-plan-LxyuO`
- Latest commit: `a9b449e` — "Revise execution plan documents after full line-by-line review"
- No production code has been changed in this project

---

## What Has NOT Been Done Yet

- No SQL migrations have been written for any fix
- No TypeScript files have been modified
- No Supabase RPCs have been created or modified
- The supervisor table does not exist yet
- RLS is still completely absent
- All 5 production bugs are still live in production
