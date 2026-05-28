# Rishumei Hevron — Development & Design Specification

> **For engineers, designers, and DBAs who will build the production system.**
> Version 1.0 · Status: Approved by management, ready for development.
> Companion document to `docs/rishumei-hevron-master-plan.md` (Hebrew, product/management focus).
> **The system UI is Hebrew/RTL. This specification document is in English.**

---

## How to Read This Document

This spec is the implementation blueprint. The master plan answers *what* and *why*; this document answers *how*. When the two disagree, **this document wins** for implementation decisions — but flag the conflict so the master plan can be updated.

Structure:
- **Part I — Foundations:** architecture, stack, conventions, security baseline.
- **Part II — Domain Model:** schema, JSON contracts, RPC, RLS, realtime.
- **Part III — Subsystems:** every functional area (import, auth, builder, preview, reports, push, etc.) in depth.
- **Part IV — UI/UX:** information architecture, screens, components, states, accessibility, RTL.
- **Part V — Engineering Practices:** error handling, edge cases, testing, observability.
- **Part VI — Phased Implementation Plan:** what to build in what order, with acceptance criteria.
- **Part VII — Appendices:** sample contracts, SQL sketches, column dictionaries.

### Tag conventions
| Tag | Meaning |
|---|---|
| **[MUST]** | Required for v1 release. |
| **[SHOULD]** | Strongly recommended; deviate only with explicit reason. |
| **[MAY]** | Optional; nice-to-have. |
| **[OUT-OF-SCOPE]** | Explicitly not built. Documented so the team does not re-add it. |
| **[FUTURE]** | Intentionally deferred. Mentioned to avoid loss. |
| **[ASSUMPTION]** | Working assumption. Verify before merging into release. |
| **[RISK]** | Known risk. Owners must mitigate. |

### Hard product carryovers (from master plan)
- System name: **רישומי חברון** (UI in Hebrew/RTL).
- Two roles only: **student**, **admin**. No supervisor.
- Multiple humans may use the admin side but **the system treats "admin" as a single logical actor**. No per-admin auth, no per-admin audit, no per-admin permissions. One shared admin PIN.
- Student login: Israeli ID number only.
- PWA only (no native).
- Push: best-effort. Internal notification center is the safety net.
- Student source: **CSV upload**, manual sync only.
- System reads from CSV and never writes back.
- Every registration has a primary question. **Default is a three-option question: present / absent / undecided** (Hebrew: נוכח / לא נוכח / מתלבט). Admin may pick any question type and any answer values (including binary yes/no). `undecided` is a real answer — a student who picks it counts as **responded**, not "not answered," and is a distinct concept from the `seen` status.
- Conditional follow-up questions: supported.
- Students see only their own registrations and responses; no aggregate results.
- Admin can edit a student's response on the student's behalf; the previous response value is retained as one historical version.
- Capacity limits / waitlists / seen-but-not-responded toggle for aggregate visibility — **[OUT-OF-SCOPE]** per management decision (do not build, do not stub).
- Three-state per-student status per registration: `sent → seen → responded`.
- All exports requested (Excel multi-sheet, CSV, PDF, JSON, WhatsApp copy formats).
- Hosting region: Supabase **Frankfurt** (eu-central-1).

---

# Part I — Foundations

## 1. Product Recap (one screen)

A general registration system for the yeshiva. The admin creates registrations of any shape ("Shabbat", "transportation", "trip", "meal choice", etc.). The system delivers them to a chosen audience of students. Students answer on mobile in seconds. The admin sees a live, organized dashboard with breakdowns and exports.

The system is **entirely separate** from the existing attendance system: separate Vercel project, separate Supabase project, separate database, separate domain. The attendance codebase (`yeshiva-attendance`) is used **only as a technical reference** for: ID-based student login flow, admin PIN model, CSV/Sheets parsing patterns (Hebrew normalization, zero-padding), VAPID Web Push transport, and RTL conventions. No business logic, schema, or UI is copied.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Browser (PWA)                              │
│  ┌────────────────────┐         ┌────────────────────────────┐     │
│  │   Student App      │         │   Admin App                │     │
│  │   (mobile-first)   │         │   (desktop-first, resp.)   │     │
│  └────────┬───────────┘         └────────────┬───────────────┘     │
│           │                                  │                      │
│           │  HTTPS (Supabase client SDK)     │                      │
└───────────┼──────────────────────────────────┼─────────────────────┘
            │                                  │
            ▼                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                Supabase Project (eu-central-1, Frankfurt)           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  PostgreSQL  ── tables, views, RPC, triggers, RLS, indexes  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Edge Functions:                                             │  │
│  │    • send-student-push         (Web Push, RFC 8291)         │  │
│  │    • send-admin-push           (Web Push to admin devices)  │  │
│  │    • csv-import-validate       (heavy parse/validate)       │  │
│  │    • export-build              (xlsx/pdf generation)        │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Realtime  ── narrowly scoped to active registration views   │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Architectural principles
1. **Two thin clients, one backend.** No separate Node/Express server. Supabase carries DB + auth-equivalent (custom token claim) + functions + realtime.
2. **PostgreSQL is the source of truth for everything system-owned.** No state lives only in client memory or localStorage beyond auth/device tokens.
3. **Server-side computation by default.** Aggregates (counts, breakdowns) come from views/RPC, not client-side aggregation.
4. **Realtime is opt-in and scoped.** The default is "fetch on demand." Realtime is enabled only on the admin's active-registration monitoring view, scoped to a single `registration_id`.
5. **The CSV source is read-only.** The system never writes back. Period.
6. **Stateless client.** Reloading any page must restore correct UI from server state (plus a tiny localStorage cache for auth/device tokens).

---

## 3. Tech Stack & Hosting

### Frontend
- **React 18** + **TypeScript** (strict mode).
- **Vite** build.
- **Tailwind CSS** with RTL plugin; CSS variables for theme tokens.
- **shadcn/ui** as the component primitive layer (Radix under the hood) — accessibility comes for free.
- **Framer Motion** for animations.
- **TanStack Query (React Query)** for server state.
- **Zustand** for UI-only state (theme, sidebar, transient).
- **react-hook-form** + **zod** for forms and validation.
- **recharts** for charts (Bento dashboard tiles).
- **date-fns** + `date-fns-tz` for Asia/Jerusalem date math.
- **Workbox** (via Vite plugin) for PWA service worker and offline shell.

### Backend
- **Supabase** (Postgres 15+, Edge Functions on Deno, Realtime, Storage if needed).
- **Region: eu-central-1 (Frankfurt).** Lowest latency to Israel within Supabase's supported regions.

### Export libraries
- **ExcelJS** for `.xlsx` (multi-sheet, RTL, Hebrew fonts).
- **pdfmake** (or `@react-pdf/renderer`) for PDF, with Hebrew font (e.g., Heebo/Assistant embedded).
- Native browser APIs for CSV.

### Hosting
- **Vercel** for the PWA. Two Vercel projects are NOT required — one project serves both `/` (student) and `/admin` (admin) routes.
- **Domain**: `[tbd].co.il` (production); `[tbd]-staging.vercel.app` (staging). **[ASSUMPTION]** domain to be provided.

### Why this stack
Identical to the attendance project. Reuses the team's existing operational know-how, dev tooling, and deployment muscle memory. There is no engineering reason to introduce a different stack.

---

## 4. Repository Layout

```
rishumei-hevron/
├── public/
│   ├── manifest.webmanifest
│   ├── icons/
│   └── locales/                    # Hebrew strings (single locale)
├── src/
│   ├── app/                        # App-level providers, router
│   │   ├── App.tsx
│   │   ├── routes.tsx
│   │   └── providers.tsx
│   ├── pages/
│   │   ├── student/
│   │   │   ├── LoginPage.tsx
│   │   │   ├── HomePage.tsx
│   │   │   ├── RegistrationDetailPage.tsx
│   │   │   ├── ArchivePage.tsx
│   │   │   └── NotificationsPage.tsx
│   │   └── admin/
│   │       ├── LoginPage.tsx
│   │       ├── DashboardPage.tsx
│   │       ├── RegistrationsListPage.tsx
│   │       ├── RegistrationBuilderPage.tsx
│   │       ├── RegistrationMonitorPage.tsx
│   │       ├── StudentsPage.tsx
│   │       ├── CsvImportPage.tsx
│   │       ├── QuestionsLibraryPage.tsx
│   │       ├── GroupsLibraryPage.tsx
│   │       ├── TemplatesLibraryPage.tsx
│   │       ├── ArchivePage.tsx
│   │       ├── NotificationsPage.tsx
│   │       └── SettingsPage.tsx
│   ├── features/                   # Domain modules (vertical slices)
│   │   ├── auth/
│   │   ├── students/
│   │   ├── csv-import/
│   │   ├── registrations/
│   │   ├── questions/
│   │   ├── groups/
│   │   ├── templates/
│   │   ├── responses/
│   │   ├── audience/
│   │   ├── preview/                # student preview mode lives here
│   │   ├── exports/
│   │   ├── notifications/
│   │   └── reports/
│   ├── components/
│   │   ├── ui/                     # shadcn primitives
│   │   ├── layout/
│   │   ├── data-display/
│   │   └── feedback/
│   ├── lib/
│   │   ├── api/                    # supabase client + typed wrappers
│   │   ├── hebrew/                 # normalization, israeli-id validation
│   │   ├── date/
│   │   ├── csv/
│   │   ├── push/
│   │   ├── conditional/            # conditional question evaluator
│   │   └── theme/
│   ├── store/                      # Zustand stores (UI only)
│   ├── styles/
│   │   ├── tokens.css              # design tokens (CSS vars)
│   │   └── globals.css
│   └── types/                      # shared types + generated DB types
├── supabase/
│   ├── migrations/                 # one SQL file per migration
│   ├── functions/
│   │   ├── send-student-push/
│   │   ├── send-admin-push/
│   │   ├── csv-import-validate/
│   │   └── export-build/
│   └── seed.sql                    # local dev seed only
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
└── docs/                           # this spec + master plan
```

---

## 5. Environments & Secrets

### Environments
| Env | Purpose | Branch | URL |
|---|---|---|---|
| `local` | Developer machine | feature branches | `localhost:5173` |
| `staging` | Pre-prod, QA, demos | `main` | `[name]-staging.vercel.app` |
| `production` | Live | tag-based deploys from `main` | `[domain].co.il` |

### Frontend env vars (`.env.local`)
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_VAPID_PUBLIC_KEY=
VITE_APP_ENV=local|staging|production
VITE_SENTRY_DSN=                # optional
```

### Supabase function secrets
```
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT                   # e.g., mailto:ops@...
ADMIN_PIN_BOOTSTRAP             # used only by initial migration; never read by app
```

### Never in env vars
- Service-role keys must not appear in the client bundle.
- The admin PIN value lives in `app_settings`, not in env.

---

## 6. Naming Conventions

### Database (PostgreSQL)
- `snake_case` table and column names.
- Singular table-level concepts get plural table names (`students`, `registrations`).
- Boolean flags: `is_`, `has_` prefix (`is_active`, `has_seen`).
- Timestamps: `_at` suffix (`created_at`, `seen_at`, `responded_at`).
- Foreign keys: `[entity]_id` (`student_id`, `registration_id`).
- JSON columns: `_schema` for definitions, `_value` or `_values` for instances.

### Frontend
- React components: `PascalCase`.
- Hooks: `useCamelCase`.
- Files: components and pages in `PascalCase.tsx`; everything else `camelCase.ts`.
- Tailwind: avoid `arbitrary-values` unless necessary; use design tokens.
- CSS variables: `--rh-*` prefix (`--rh-color-accent`).

### API (typed client wrappers)
- Wrappers in `src/lib/api/` are named after the operation: `submitResponse`, `listOpenRegistrationsForStudent`, `markSeen`.
- Wrappers return `{ data, error }` shape (mirror Supabase but type-safe).

---

## 7. Hebrew & RTL Standards

Everything user-facing is Hebrew. The entire app runs RTL.

### Rules
1. `<html dir="rtl" lang="he">` at the root.
2. Tailwind config has the RTL plugin enabled; **use `start`/`end`, never `left`/`right`** in utility classes.
3. Icons that imply direction (back arrow, chevrons, sort indicators) flip with the RTL plugin or via explicit `rtl:rotate-180`.
4. Numbers in Hebrew UI: keep Latin digits (Israeli convention).
5. Dates: format with `date-fns` + `he` locale + `Asia/Jerusalem` zone. Long format: `יום ראשון, 14 ביוני 2026, 19:30`.
6. ID number formatting: display as a continuous 9-digit number; never with dashes.
7. **Hebrew string normalization** for any equality comparison: strip apostrophe variants (`'`, `'`, `״`, `׳`) and normalize whitespace. Implement `lib/hebrew/normalize.ts` — pattern lifted conceptually from the attendance project's `normalizeTabName`.
8. Mixed Hebrew + English text in admin labels: wrap English fragments with `<bdi>` to prevent direction glitches.
9. Form inputs: `dir="auto"` on text inputs so user-typed strings render in their natural direction.
10. CSV import: tolerate header variations using the same normalization.

### Fonts
- Body: a modern Hebrew variable font (**[ASSUMPTION]** Heebo Variable, weights 300/400/500/700; Assistant or Ploni acceptable alternatives).
- Numbers: tabular figures variant for tables.
- Self-host fonts; no external font CDN.

---

## 8. Design System Foundations

### Tokens (CSS variables)
```
/* color (light) */
--rh-bg              /* page background */
--rh-bg-2            /* secondary surface */
--rh-surface         /* card surface */
--rh-border          /* dividers */
--rh-text            /* primary text */
--rh-text-muted      /* secondary text */
--rh-text-subtle     /* tertiary text */
--rh-accent          /* primary action / "needs attention" */
--rh-accent-fg       /* text on accent */
--rh-success         /* responded */
--rh-warning         /* needs attention */
--rh-danger          /* destructive / errors */
--rh-info            /* neutral informational */

/* radii */
--rh-radius-sm: 8px;
--rh-radius-md: 14px;
--rh-radius-lg: 20px;
--rh-radius-xl: 28px;

/* shadows (soft, modern) */
--rh-shadow-sm
--rh-shadow-md
--rh-shadow-lg
```
Every token has a dark-mode counterpart defined under `:root[data-theme="dark"]`.

### Three-state visual language (sent / seen / responded)
This vocabulary is used **everywhere** the registration appears: cards on the student home, rows in the admin table, summary charts.
- `sent`: subtle outline + muted background, accent dot — "needs your attention."
- `seen`: same card, no dot but accent border-start — "you opened it, still need to answer."
- `responded`: success-tinted card, calm.
- `closed`: dimmed/grayscale, no actions.

### Bento grid (admin dashboard)
A 12-column grid; tile sizes from 3-col to 12-col. Each tile is a `<DashboardTile>` with header, content, and optional footer action.

---

## 9. Data Efficiency Principles

Codified as enforceable rules:

1. **No `select *` from the client.** Every typed wrapper specifies columns explicitly.
2. **All list queries are paginated.** Default page size: 50. Virtualize tables beyond 100 rows.
3. **Aggregates come from server.** Use SQL views or RPC; do not pull all rows to count.
4. **Realtime only on `RegistrationMonitorPage`**, filtered by `registration_id`. No other page subscribes.
5. **`seen_at` is upserted once.** Use `INSERT … ON CONFLICT DO NOTHING WHERE seen_at IS NULL`. Never overwrite.
6. **CSV preview happens in an Edge Function**, not by uploading rows one by one.
7. **Client caching via React Query**: 30s `staleTime` for lists, 5s for the active monitor view, indefinite for static lookups (groups, libraries) until invalidated.
8. **Exports stream**: large exports build in an Edge Function and the browser downloads a single file; never assemble in memory in the SPA.

---

## 10. Security Model (Baseline)

### Threat model (concise)
- **In scope:** unauthorized cross-student data access; unauthorized admin actions; CSV containing sensitive IDs leaking via UI.
- **Out of scope:** student-to-student impersonation via ID number guessing (explicit management decision: trust students). Do not add layers to "fix" this without product authorization.

### Authentication
- **Student auth:** ID-number-only via custom RPC `student_login(p_id_number)` that returns a signed JWT-like token bound to a `student_id` claim. The token is stored in `localStorage` and added as `Authorization: Bearer ...` on subsequent requests.
- **Admin auth:** PIN-only via `admin_login(p_pin)` that returns a signed JWT-like token with claim `role=admin`.
- **Token lifetime:** student token 30 days (sliding); admin token 8 hours (sliding).
- **No password recovery, no email signup** — neither role uses email.
- **[ASSUMPTION]** We do not use Supabase Auth's email/password directly. We mint our own JWTs using a Postgres function that signs with a server-only secret stored in Supabase config. Alternatively, use Supabase's "anonymous sessions" pattern and embed `student_id`/`role` claims via custom hooks. The chosen implementation must let RLS read these claims via `auth.jwt()` or equivalent.

### Authorization (RLS principles)
- Student tokens: can `SELECT` only rows where `student_id = auth.jwt() ->> 'student_id'` in tables `registration_targets`, `responses` (own only), and `notifications` (own only).
- Student tokens cannot `INSERT/UPDATE` directly. All write paths go through RPC functions that are `SECURITY DEFINER` and validate the claim.
- Admin tokens: full read/write on admin-only tables via RLS or via RPC marked `SECURITY DEFINER`.
- No anonymous reads other than `students.id_number → exists?` (used by login UX to validate ID format before issuing a token). **[RISK]** This could enable enumeration; mitigate by rate-limiting `student_login` per IP via Edge Function gate.

### Transport & storage
- All traffic HTTPS.
- ID numbers stored as-is in `students.id_number`. **[ASSUMPTION]** No hashing — they are used for login matching. (If a future hardening pass requires it, switch to a verifier function that compares hashes.)
- No PII exported by default (Excel/WhatsApp): names only; ID/phone only on explicit admin opt-in per export.

### Rate limiting
- `student_login`: 5 attempts / IP / minute, 30 / IP / hour.
- `admin_login`: 5 attempts / IP / minute, 20 / IP / hour. Lock the PIN for 5 minutes after 10 failed attempts globally (since PIN is shared).
- `mark_seen`: idempotent, no rate limit needed.

---

# Part II — Domain Model

## 11. Entity Catalog

| Entity | Owner | Cardinality | Notes |
|---|---|---|---|
| `students` | mixed (source + system) | ~400 | Identity from CSV; activity flags system-owned. |
| `registrations` | system | tens per month | The "form" itself. |
| `registration_targets` | system | per `(registration, student)` | Audience snapshot + seen tracking. |
| `responses` | system | per `(registration, student)` | The current response. |
| `response_history` | system | retained for admin edits | One prior version on admin edit. |
| `groups` | system | dozens | Saved student groups. |
| `group_members` | system | many-to-many | Static membership at v1. |
| `question_library_items` | system | dozens | Reusable question/block definitions. |
| `templates` | system | dozens | Reusable registration shells. |
| `notifications` | system | thousands | Internal notification center. |
| `push_subscriptions_student` | system | per student device | Web Push subscription JSON. |
| `push_subscriptions_admin` | system | per admin device | Web Push subscription JSON. |
| `admin_notifications` | system | tens per week | Admin-side internal notifications. |
| `app_settings` | system | a handful | PIN, feature flags, etc. |
| `csv_import_runs` | system | one per import | Audit + last-run preview, ephemeral. |

---

## 12. Database Schema

> The schemas below are the authoritative source. SQL sketches are in Appendix C. All timestamps are `TIMESTAMPTZ` (UTC in storage, displayed in `Asia/Jerusalem`).

### 12.1 `students`
| Column | Type | Constraints | Source | Notes |
|---|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | system | Internal stable ID. |
| `id_number` | `text` | unique, not null, regex `^[0-9]{9}$` | CSV (source-owned) | Israeli 9-digit ID, zero-padded. |
| `full_name` | `text` | not null | CSV (source-owned) | Display name. |
| `grade` | `text` | not null | CSV (source-owned) | "שכבת גיל", e.g., `שיעור א`. |
| `class_id` | `text` | not null | CSV (source-owned) | Specific class label, e.g., `כיתה הרב משה`. |
| `is_active` | `boolean` | default `true` | system-owned | False = absent from latest CSV import, or admin-disabled. |
| `inactivated_at` | `timestamptz` | nullable | system-owned | Set when flipped to false. |
| `inactivated_reason` | `text` | nullable | system-owned | `csv_missing` \| `admin_disabled`. |
| `created_at` | `timestamptz` | default now | system | First time the student was imported. |
| `last_imported_at` | `timestamptz` | nullable | system | Set on every CSV import that includes them. |

**Indexes:**
- `unique (id_number)`
- `index (grade)`, `index (class_id)`, `index (is_active)` — for dashboard filters.

**Source-of-truth rule** (see §17.4 for full conflict resolution):
- CSV-owned: `id_number`, `full_name`, `grade`, `class_id`.
- System-owned: everything else.
- A CSV import never modifies system-owned columns.

### 12.2 `registrations`
| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `title` | `text` | not null | e.g., `שבת פרשת בא`. |
| `description` | `text` | nullable | Free text, can be empty. |
| `status` | `text` | not null, check in (`draft`, `scheduled`, `open`, `closed`, `archived`) | |
| `opens_at` | `timestamptz` | nullable | If null, opens immediately on publish. |
| `closes_at` | `timestamptz` | not null | Deadline for new responses. |
| `edit_until` | `timestamptz` | nullable | If null, defaults to `closes_at`. Must be ≥ `closes_at` allowed? No: must be ≤ `closes_at` typically, but admin may set it later than `closes_at` to allow late edits after intake closes. Validation: `edit_until ≥ created_at`. |
| `questions_schema` | `jsonb` | not null | The question definitions (see §13.1). |
| `audience_summary` | `jsonb` | not null | Human-readable summary `{ groups: [], grades: [], classes: [], individuals_count: n, total: n }`. Audit/UI only — the authoritative audience lives in `registration_targets`. |
| `created_at` | `timestamptz` | default now | |
| `published_at` | `timestamptz` | nullable | Set on first transition to `open` or `scheduled`. |
| `closed_at` | `timestamptz` | nullable | |
| `archived_at` | `timestamptz` | nullable | |
| `admin_note` | `text` | nullable | Private to admin. Not exported by default. |
| `template_id` | `uuid` | nullable, FK → `templates(id)` ON DELETE SET NULL | If created from a template. |

**Indexes:**
- `index (status)`
- `index (closes_at)` — for "closing soon" queries.
- `index (archived_at)` — for archive view.

**Constraints:**
- `check (closes_at > coalesce(opens_at, created_at))`
- `check (edit_until is null or edit_until >= created_at)`

### 12.3 `registration_targets`
This table is the heart of the three-state model and the audience snapshot.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `registration_id` | `uuid` | FK → `registrations(id)` ON DELETE CASCADE | |
| `student_id` | `uuid` | FK → `students(id)` ON DELETE RESTRICT | Restrict so we never lose audit. |
| `student_snapshot` | `jsonb` | not null | Snapshot of `full_name`, `grade`, `class_id` at audience build time. Protects reports against later student edits. |
| `added_at` | `timestamptz` | default now | When the student was added to the audience (publish or later admin add). |
| `seen_at` | `timestamptz` | nullable | First time the student opened this registration's detail page. Set once. |
| `removed_at` | `timestamptz` | nullable | If admin removes this student from the audience after publish, set this rather than deleting. |
| `removed_reason` | `text` | nullable | |

**Primary key:** `(registration_id, student_id)`.

**Indexes:**
- `index (registration_id) where removed_at is null` — partial index for active audience queries.
- `index (student_id) where removed_at is null` — for student home queries.
- `index (registration_id, seen_at)` — for three-state aggregates.

### 12.4 `responses`
| Column | Type | Constraints | Notes |
|---|---|---|---|
| `registration_id` | `uuid` | FK → `registrations(id)` ON DELETE CASCADE | |
| `student_id` | `uuid` | FK → `students(id)` ON DELETE RESTRICT | |
| `values` | `jsonb` | not null | Keyed by `question_id`, see §13.2. |
| `responded_at` | `timestamptz` | not null, default now | Last update time. |
| `submitted_via` | `text` | not null, check in (`student`, `admin_on_behalf`) | |
| `last_edited_by_admin_at` | `timestamptz` | nullable | If `submitted_via='admin_on_behalf'` or admin edited later. |

**Primary key:** `(registration_id, student_id)`.
**Indexes:** `index (registration_id)`, `index (student_id)`.

### 12.5 `response_history`
Holds **exactly one prior version** per admin edit. Not a full audit log — minimal per the master plan's audit-minimal decision.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `registration_id` | `uuid` | FK | |
| `student_id` | `uuid` | FK | |
| `previous_values` | `jsonb` | not null | The values *before* the admin edit. |
| `previous_responded_at` | `timestamptz` | not null | The timestamp of the prior response. |
| `previous_submitted_via` | `text` | not null | |
| `replaced_at` | `timestamptz` | default now | When the admin overwrote. |

**Behavior:** when an admin saves an on-behalf edit, the existing `responses` row's prior values are moved into a new `response_history` row, then `responses` is updated. If a second admin edit happens, the existing history row is **overwritten** (we keep exactly one prior version, per product decision).

### 12.6 `groups`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `name` | `text` | not null, e.g., `תורנים`. |
| `description` | `text` | nullable |
| `created_at` | `timestamptz` | |

### 12.7 `group_members`
Static membership. `(group_id, student_id)` composite PK.

### 12.8 `question_library_items`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `label` | `text` | Display label in the library. |
| `kind` | `text` | check in (`single_question`, `block`). |
| `payload` | `jsonb` | A question definition or array of definitions (block). |
| `created_at` | `timestamptz` | |

### 12.9 `templates`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `name` | `text` | e.g., `שבת רגילה`. |
| `description` | `text` | nullable |
| `template_payload` | `jsonb` | Includes default `title`, `description`, `questions_schema`, default audience (optional), default deadlines as relative offsets. |
| `created_at` | `timestamptz` | |
| `last_used_at` | `timestamptz` | nullable; updated on instantiation. |

### 12.10 `notifications` (student-side internal center)
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `student_id` | `uuid` | FK |
| `kind` | `text` | check in (`new_registration`, `reminder`, `deadline_changed`, `reopened`, `closing_soon`). |
| `registration_id` | `uuid` | nullable FK |
| `body` | `text` | precomputed Hebrew message. |
| `created_at` | `timestamptz` | |
| `read_at` | `timestamptz` | nullable; null = unread. |

### 12.11 `admin_notifications`
Internal center for the admin role. Single shared bucket — all admin devices read the same rows.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `kind` | `text` | check in (`closing_soon`, `low_response_rate`, `many_unanswered`, `sync_problem`, `export_ready`, `push_failure_summary`). |
| `registration_id` | `uuid` | nullable FK |
| `severity` | `text` | check in (`info`, `warn`, `urgent`). |
| `body` | `text` | precomputed Hebrew message. |
| `data` | `jsonb` | nullable, structured payload (e.g., counts). |
| `created_at` | `timestamptz` | |
| `read_at` | `timestamptz` | nullable. |

### 12.12 `push_subscriptions_student` / `push_subscriptions_admin`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `student_id` / (none for admin) | `uuid` | nullable for admin table |
| `device_label` | `text` | nullable, optional UI label. |
| `subscription` | `jsonb` | the PushSubscription object (endpoint + keys). |
| `created_at` | `timestamptz` | |
| `last_seen_at` | `timestamptz` | updated on app open. |
| `failure_count` | `int` | default 0; increments on send error; 5 = mark stale. |

### 12.13 `app_settings`
Key–value. Notable keys:
- `admin_pin` — hashed value of the shared admin PIN.
- `csv_default_inactivate_missing` — boolean, default true.
- `notifications.closing_soon_hours` — int, default 6.
- `notifications.low_response_threshold` — float (0..1), default 0.3.

### 12.14 `csv_import_runs`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `started_at` | `timestamptz` | |
| `finished_at` | `timestamptz` | nullable |
| `status` | `text` | `previewing` \| `committed` \| `aborted` \| `failed` |
| `summary` | `jsonb` | counts: created/updated/inactivated/errors |
| `errors` | `jsonb` | array of row-level errors |

---

## 13. JSON Schemas

### 13.1 `questions_schema` (on `registrations`)
An array of question definitions, ordered. Each item:

```jsonc
{
  "id": "q_primary",                // stable id within this registration; client-generated nanoid.
  "type": "presence" | "yes_no" | "single_choice" | "multi_choice" | "text",
  "label": "האם תישאר לשבת?",
  "help_text": "אפשר לערוך עד יום חמישי" | null,
  "required": true,
  "options": [                      // present for single_choice / multi_choice
    { "value": "north", "label": "צפון" },
    { "value": "center", "label": "מרכז" },
    { "value": "south", "label": "דרום" }
  ],
  "allow_other": false,             // single_choice/multi_choice only
  "labels": {                       // OPTIONAL override of fixed labels
    "present": "נוכח",              // presence type only
    "absent": "לא נוכח",
    "undecided": "מתלבט",
    "yes": "כן",                   // yes_no (binary) type only
    "no": "לא"
  },
  "conditional_on": null | {
    "question_id": "q_primary",
    "equals": "present" | <string|number|boolean>   // for presence: "present" | "absent" | "undecided"
  }
}
```

**v1 question types:** `presence` (**the default primary type — three options**), `yes_no` (binary), `single_choice`, `multi_choice`, `text`.

- `presence` is the system default for the primary question. It renders three fixed answer values — `present`, `absent`, `undecided` — with Hebrew labels `נוכח` / `לא נוכח` / `מתלבט` (relabelable via the optional `labels` map).
- `yes_no` (binary, values `yes`/`no`, labels `כן`/`לא`) remains available for admins who explicitly want only two options (e.g., "מאשר את התקנון?").

**[CRITICAL — do not conflate two different three-way concepts]:**
- `undecided` is an **answer value** (`מתלבט`). A student who selects it has **responded** (status `responded`). It is *not* the same as the per-student status `seen` ("opened but did not answer at all"). Reports must count `undecided` under "responded" and break it out as its own answer slice.

**[OUT-OF-SCOPE for v1]** `number`, `phone`, `date`, `time`, `note` (longer textarea), confirmation checkbox — listed for future. Do not stub their UI.

**Constraint:** the first item in `questions_schema` is the **primary question**. Its `conditional_on` must be `null`. Validate in the builder and in `submit_response` RPC.

### 13.2 `responses.values`
```jsonc
{
  "q_primary": "undecided",
  "q_transport": ["north"],
  "q_notes": "אגיע מאוחר"
}
```
- `presence` → `"present" | "absent" | "undecided"` (the **default** primary type).
- `yes_no` → `"yes" | "no"`.
- `single_choice` → string (option value, or `__other__` with a sibling `*_other` field if `allow_other`).
- `multi_choice` → array of strings.
- `text` → string.
- Missing key = "not answered" (only valid if the question was hidden by a conditional or not required). **Note:** a present value of `"undecided"` is **answered**, not missing.

### 13.3 Conditional evaluation
A question is **visible to the student** iff `conditional_on === null` OR `responses.values[conditional_on.question_id] === conditional_on.equals` (string equality after normalization). For `multi_choice` source questions, treat `equals` as "value is included in the array."

Validation (server-side, in `submit_response`):
- Required-and-visible questions must be present.
- Hidden questions must NOT be present; if present, drop them silently before persisting.
- Re-evaluate visibility on every save, both student-side and admin-on-behalf.

---

## 14. RPC Functions

All write operations go through these. Each is `SECURITY DEFINER`, validates the JWT claim, and runs in a single transaction.

### 14.1 `student_login(p_id_number text)`
Returns `{ token, student_id, full_name, grade, class_id }` or `{ error: 'not_found' | 'inactive' | 'rate_limited' }`.

### 14.2 `admin_login(p_pin text)`
Returns `{ token }` or `{ error }`. Compares against hashed PIN in `app_settings`.

### 14.3 `mark_registration_seen(p_registration_id uuid)`
Reads `student_id` from JWT. Sets `seen_at = now()` on `registration_targets` only if currently null. Idempotent. Returns `{ already_seen: bool, seen_at }`.

### 14.4 `submit_response(p_registration_id uuid, p_values jsonb)`
- Reads `student_id` from JWT.
- Validates registration is `open` and (`closes_at > now()` for new, or `edit_until > now()` for edits).
- Strips hidden-by-condition fields.
- Validates required-and-visible questions.
- Upserts into `responses` with `submitted_via='student'`.
- Side effect: if first response, ensure `seen_at` is set (defensive).
- Returns `{ status: 'ok', registration_status, edit_until }`.

### 14.5 `admin_submit_response_on_behalf(p_registration_id, p_student_id, p_values)`
- Requires admin JWT.
- Same validations except deadline rules — admins may edit after `edit_until` (but not after `archived_at`).
- Moves current values into `response_history` if a response exists.
- Updates `responses` with `submitted_via='admin_on_behalf'`, `last_edited_by_admin_at=now()`.
- Returns `{ status: 'ok' }`.

### 14.6 `publish_registration(p_registration_id, p_audience jsonb)`
- Requires admin JWT.
- `p_audience` shape: `{ groups: uuid[], grades: text[], classes: text[], individuals: uuid[], everyone: bool, paste_ids: text[] }`.
- Server resolves the union of the audience to a list of `student_id`s.
- Inserts a row per student into `registration_targets` (snapshot of student name/grade/class).
- Sets `status='open'` or `status='scheduled'` (based on `opens_at`), sets `published_at=now()`.
- Triggers `send-student-push` for each target's known subscriptions.
- Inserts `notifications` rows (one per student) of kind `new_registration`.
- Returns `{ audience_count, push_attempted, push_failed_count }`.

### 14.7 `update_audience(p_registration_id, p_add, p_remove)`
Adds/removes students from an already-published registration. Soft-removal via `removed_at`. New additions get push.

### 14.8 `close_registration(p_registration_id)` / `reopen_registration(p_registration_id)`
State transitions; push `closing_soon` / `reopened` to all current targets where appropriate.

### 14.9 `archive_registration(p_registration_id)`
Only allowed if `status='closed'`. Sets `archived_at`. Hidden from lists by default.

### 14.10 `mark_notification_read(p_notification_id)`
Student or admin variants based on JWT role.

### 14.11 `import_students_preview(p_rows jsonb)` (Edge Function, not in-DB)
Validates a parsed CSV, returns a diff against `students`. Stateless.

### 14.12 `import_students_commit(p_run_id uuid)`
Applies the previously previewed diff. See §17.

---

## 15. Realtime Strategy

Realtime is **scoped, opt-in, and deliberately narrow** to honor the data-efficiency requirement.

| Page | Realtime? | Channel |
|---|---|---|
| Student home | No | refetch on focus + push triggers React Query invalidation. |
| Student registration detail | No | refetch on focus. |
| Admin dashboard (overview) | No | refetch on focus; 30s `staleTime`. |
| Admin registrations list | No | refetch on focus. |
| **Admin registration monitor** | **Yes** | filter `registration_targets` and `responses` by single `registration_id`. |
| Admin notifications panel | No | refetch on focus + push wakes invalidation. |

Implementation: a single `useRegistrationMonitorRealtime(registrationId)` hook that subscribes/unsubscribes on mount/unmount.

---

## 16. RLS Strategy

Enable RLS on **all** tables. Default `deny`, then allow specifically.

### Student token
- `select` on `registration_targets` where `student_id = jwt.student_id and removed_at is null`.
- `select` on `responses` where `student_id = jwt.student_id`.
- `select` on `notifications` where `student_id = jwt.student_id`.
- `select` on `registrations` where the row has at least one matching `registration_targets` row (via join through a security-defined view `student_visible_registrations`).
- `insert/update` is **forbidden directly** — all writes go through RPC.

### Admin token
- Full `select` on all tables.
- Direct `insert/update/delete` allowed on `groups`, `group_members`, `question_library_items`, `templates`, `app_settings`. State-changing operations on registrations/responses still go through RPC for consistency.

### Anonymous (no token)
- No table access.
- Allowed to call `student_login` and `admin_login` RPC only.

---

# Part III — Subsystems

## 17. CSV Import & Safe Sync

### 17.1 Goals
- Manual, deliberate, idempotent.
- Always preview before commit.
- Never overwrite system-owned columns.
- Never destroy historical responses or `registration_targets`.

### 17.2 CSV format
**Match the attendance project's source structure** (the management's explicit direction). The new system reads a CSV with one row per student.

**Required columns (Hebrew headers, tolerated with normalization):**
| Header (Hebrew) | DB field | Notes |
|---|---|---|
| `שם מלא` | `full_name` | Trim whitespace; normalize internal spaces. |
| `תעודת זהות` | `id_number` | Zero-pad to 9 digits; strip non-digits; reject if not 9 digits after padding. |
| `שכבה` (or `שיעור`) | `grade` | One of `שיעור א`, `שיעור ב`, `שיעור ג`, `שיעור ד-ה`, `אברכים ובוגרצ`. Tolerate apostrophe variants via `normalizeHebrew`. |
| `כיתה` | `class_id` | Free text; must be prefixed `כיתה ` (auto-prefix if missing). |

**Optional columns (ignored if absent):** `טלפון` — **[ASSUMPTION]** if the source includes phone, we ignore it for now; phone is not required and is not exported.

**Encoding:** UTF-8. UTF-8 with BOM is tolerated. Excel-saved CSVs in Windows-1255 must be re-saved to UTF-8 (instruct the admin in the UI). Detect non-UTF-8 by attempting to parse and producing an error if Hebrew is mangled.

### 17.3 Import flow

```
[Admin opens "Import students"]
        │
        ▼
[Drag-and-drop or pick a .csv file]
        │
        ▼
[Client parses with PapaParse → rows[]]
        │
        ▼
[POST rows[] to csv-import-validate Edge Function]
        │
        ▼
[Edge Function validates, computes diff vs `students`, returns preview]
        │
        ▼
[Admin sees preview screen: 4 sections]
   • To create:    X students (table)
   • To update:    Y students (table with old → new per field)
   • To inactivate: Z students (no longer in CSV)
   • Errors:       N rows (table with row#, value, reason)
        │
        ▼
[Admin clicks "Apply" → POST run_id to csv-import-commit]
        │
        ▼
[Server applies in a single transaction]
        │
        ▼
[Done screen with summary + link to students list]
```

### 17.4 Field ownership and conflict resolution

| Field | Owner | On CSV import |
|---|---|---|
| `id_number` | CSV (immutable identity) | Match key. Never updated for an existing student. |
| `full_name` | CSV | Overwritten by CSV value. Show diff in preview. |
| `grade` | CSV | Overwritten. Diff shown. |
| `class_id` | CSV | Overwritten. Diff shown. |
| `is_active` | System | **Never overwritten by CSV directly.** A student missing from CSV gets `is_active=false, inactivated_reason='csv_missing', inactivated_at=now()` if and only if they were active before. A student present in CSV who was previously inactive gets reactivated (`is_active=true`, clear `inactivated_*`). |
| `inactivated_at`, `inactivated_reason` | System | Managed by the import process and admin actions. |
| `created_at`, `last_imported_at` | System | `created_at` set on first creation; `last_imported_at` set on every import that includes the student. |

**Conflict policy:** the CSV always wins for source-owned fields. The preview is the safety net — every change must be visible before the admin clicks Apply.

### 17.5 Edge cases

| Case | Behavior |
|---|---|
| Duplicate `id_number` in CSV | Reject the entire import; show the row pair. The admin must fix the source. |
| `id_number` of fewer than 9 digits (after stripping) | Zero-pad to 9. If still invalid (non-numeric or too long), reject the row. |
| Empty `full_name` | Reject the row. |
| Unknown `grade` value | Reject the row; show the allowed list. |
| `class_id` without `כיתה ` prefix | Auto-prefix and proceed. |
| Student exists, was inactive, present in CSV again | Reactivate. Preview must show "will reactivate." |
| Student exists, currently has an in-flight `registration_targets` (open registrations), and CSV omits them | Inactivate the student (no longer in CSV), **but** do not delete `registration_targets` — they remain visible to admin as "this student is now inactive." Existing responses retained. |
| File is not UTF-8 / Hebrew is mangled | Reject; show instructions on saving CSV as UTF-8 from Excel/Sheets. |
| File has zero rows | Reject. |
| File has > 5,000 rows | Warn (we expect a few hundred); allow with confirmation. |

### 17.6 What the import never does
- Never deletes a `students` row.
- Never writes to the CSV/source.
- Never touches `groups`, `group_members`, `responses`, `registration_targets`, push tokens, or any registration data.
- Never runs on a schedule. Only on explicit admin click.

---

## 18. Authentication

### 18.1 Student login UX
1. Page: `/login` (default route for students).
2. Single input: 9 digits for ID.
3. As the student types, validate format client-side.
4. When 9 valid digits are present, automatically call `student_login(p_id_number)`.
5. On success: display `שלום, [full_name]` plus a "המשך" button. The button is a deliberate "confirm" step so the student can catch typing mistakes.
6. On `not_found`: show "לא נמצא תלמיד עם מספר זה — פנה למשרד". Do not differentiate from "inactive" (avoids enumeration leakage).
7. On `inactive`: same message as `not_found`.
8. On click "המשך": store the JWT in `localStorage` under `rh.student.token`; navigate to `/`.

### 18.2 Admin login UX
1. Page: `/admin/login`.
2. Single input: PIN (digits, length stored in settings, e.g., 4–8).
3. On success: store token under `rh.admin.token`; navigate to `/admin`.
4. On failure: show generic error. After 5 failures in this client, add a 30s soft delay.

### 18.3 Session handling
- A single React context `<AuthProvider>` reads the token from `localStorage` on boot.
- `useStudentAuth()` and `useAdminAuth()` expose the parsed claims (`student_id`, `full_name`, etc.).
- Token refresh: any successful API call returns a new token if the existing one is within 1 day of expiry (sliding window for student; sliding for admin too).
- Logout: clear `localStorage` key + redirect to login.

### 18.4 Push registration tied to login
- After student login, request notification permission. If granted, register a service worker subscription and POST to `push_subscriptions_student`.
- After admin login, do the same for `push_subscriptions_admin`. There may be multiple devices; that is fine — they all share the same logical admin and all receive admin pushes.

---

## 19. Registration Lifecycle

### 19.1 State machine
```
draft ──► scheduled ──► open ──► closed ──► archived
   │           │                     ▲           
   │           └─────► open ─────────┘           
   │                                             
   └─► open (immediate publish if no opens_at)   
                                                 
   closed ──► open  (reopen)                     
```
Allowed transitions:
- `draft → scheduled` (publish with future `opens_at`).
- `draft → open` (publish immediately).
- `scheduled → open` (auto, via "open if now ≥ opens_at" check on student/admin load).
- `open → closed` (admin click, or "closed_at reached" check — see 19.3).
- `closed → open` (admin "reopen").
- `closed → archived` (admin click).

### 19.2 Why no cron
Unlike the attendance system, there is **no `tick` job** flipping states by time. Reasons:
- `scheduled → open` and `open → closed` checks are cheap to enforce on read (compare `closes_at` to `now()`).
- All write paths (`submit_response`) re-validate windows server-side.
- This removes an entire subsystem from operations.

### 19.3 Closing semantics
A registration is "effectively closed" if `status='open' AND closes_at <= now()`. The server refuses new responses past `closes_at`. The UI shows it as closed once `closes_at` passes, even before the admin clicks "close." The actual `status` flip to `closed` happens when (a) admin clicks "close," or (b) any admin action on the registration after `closes_at` triggers a lazy update.

**[ASSUMPTION]** This lazy model is acceptable. If hard close timing is needed, add a tiny scheduled task; not in v1.

### 19.4 Edit window
- `edit_until` controls when an already-submitted student can edit their own response.
- After `edit_until`, only an admin can edit (on-behalf).
- After `archived_at`, even admin cannot edit; the registration is read-only.

---

## 20. Question Builder & Conditional Logic

### 20.1 Builder UX (admin)
The builder edits `registrations.questions_schema` in-place.

**Layout** (desktop):
- Left rail: ordered list of questions, drag-to-reorder.
- Center: the **selected question's editor** — type picker, label, required toggle, options table (when relevant), `allow_other`, conditional rule editor.
- Right pane: the **Student Preview** (see §22) live-updating.

**Mobile:** tabs replace the three-pane layout: "שאלות" / "תצוגה מקדימה".

### 20.2 Question type editors
- `presence` (default): label + required. Three fixed answer values (`present`/`absent`/`undecided`); the admin may optionally relabel them via the `labels` map (defaults `נוכח` / `לא נוכח` / `מתלבט`).
- `yes_no`: label + required. Two values (`yes`/`no`); optional relabel.
- `single_choice`: label + options (rows with `value`, `label`; `value` auto-derived if blank); `allow_other` toggle.
- `multi_choice`: same as single, plus implicit "select all that apply" helper text.
- `text`: label + placeholder.

### 20.3 Conditional rule editor
On any non-primary question, the admin can add:
> *"הצג שאלה זו אם התשובה ל-[dropdown of earlier questions] היא [value picker]."*

UI rules:
- The dropdown lists only earlier questions (no forward references).
- The value picker shows the source question's options (for choice questions), a three-way picker (`present` / `absent` / `undecided`) for `presence`, a `yes/no` toggle for `yes_no`, or a free text input for `text`.
- A question may have at most one conditional rule (v1). Nested/compound conditions are **[FUTURE]**.

### 20.4 Validation in the builder
- Primary question must be the first item and `conditional_on=null`.
- A question removed from the schema while later questions condition on it: prompt the admin to confirm; if confirmed, those conditionals are cleared.
- Option values must be unique within a question.
- Required and conditional-hidden: allowed (the question won't be shown unless the condition is met; if shown, it's required).

### 20.5 Library integration
- "Pull from library" inserts a copy of the library item's payload at the current cursor position. The copy is independent; editing it does not affect the library.
- "Save to library" copies the current question (or selected block of questions) into `question_library_items`.

---

## 21. Audience Selection

### 21.1 Picker UX
A composable audience builder. The admin can combine selections additively and subtractively.

**Pickers (multi-select where applicable):**
- **Individuals:** type-ahead search by name or ID, multi-select.
- **By grade:** checkboxes for the five grade values.
- **By class:** searchable list of class names. Filtering by grade hides irrelevant classes.
- **Saved groups:** searchable list.
- **Everyone:** single toggle (all active students).
- **Paste IDs:** textarea accepting 9-digit IDs separated by newline/space/comma. Validated and matched on the fly; matches and misses shown.

**Subtraction:** the admin can remove individuals or whole grades/classes from the resolved audience before publishing.

**Live count:** "אוכלוסיית יעד: 142 תלמידים." Updates as filters change.

### 21.2 Resolution at publish time
The selection is sent as the `p_audience` payload to `publish_registration`. The server expands to a concrete `student_id[]`, dedupes, and writes `registration_targets` rows. The snapshot of student fields is stored in `student_snapshot` (see §12.3).

### 21.3 Post-publish modifications
- **Add students** later via `update_audience(add: [...])` — new rows are inserted; push is sent to the new additions only.
- **Remove students** later via `update_audience(remove: [...])` — rows are not deleted; `removed_at` is set. The student no longer sees the registration on their home; their existing response (if any) is retained for admin review.

### 21.4 Paste-by-name (vs by ID)
- ID paste is the primary path.
- Name paste is **[OUT-OF-SCOPE for v1]** because ambiguity resolution is high-cost UX. If admin needs to paste names, they can search and multi-select individuals instead.

---

## 22. Student Preview Mode (a.k.a. "Live Student Preview")

This is a marquee feature. It deserves its own subsystem.

### 22.1 Goal
Whenever the admin is building, editing, or reviewing a registration, they see a **device-shaped preview** of exactly what a real student on a mobile phone would see — and that preview updates **live** with every change.

### 22.2 Where it appears
- **Registration builder** (the primary place): right pane on desktop, "preview" tab on mobile.
- **Edit-existing registration** screen: same preview, populated with the current questions.
- **Audience review** before publish: the preview is shown alongside the audience summary so the admin can read the rendered Hebrew one last time before sending.

### 22.3 What it shows
The preview is a **rendered student detail page**, not a thumbnail. It includes:
- The registration title, description, and the "edit until" notice.
- The primary question rendered exactly as the student will see it (e.g., the default three buttons `נוכח` / `לא נוכח` / `מתלבט`, choice options, etc.).
- Follow-up questions appearing/disappearing per conditional logic as the previewed answers change.
- The submit button (disabled in preview — see 22.6).
- An empty state for "this registration is closed" if the admin previews that state.
- A "post-submit success" state if the admin toggles it.

### 22.4 Preview state controls
Above the preview frame, the admin has a small control bar to simulate the student context:
| Control | Values | Purpose |
|---|---|---|
| Device size | `phone-narrow (360)`, `phone-wide (414)`, `tablet (768)` | Visual check of typography and tap targets. |
| State | `unanswered`, `viewing`, `answered`, `editing`, `closed`, `submitted-success` | Simulate the lifecycle. |
| Simulated answers | per question | Lets the admin verify conditionals branch correctly. |
| Time | `before opens`, `during open`, `past edit deadline`, `past closes_at` | Verify deadline messaging. |
| Theme | `light`, `dark`, `OS` | RTL/dark mode check. |

Reset button restores `unanswered + during open + light`.

### 22.5 Implementation contract
- The preview is the **same component** that renders the real student detail screen — not a sketch. It is hoisted from `features/registrations/StudentRegistrationDetail.tsx` and parameterized.
- The component receives props for `registration`, `responseValues`, `now`, and `targetWindow` so the admin's simulation overrides server state.
- No network calls in preview mode: the component must accept all state via props.
- The conditional evaluator (`lib/conditional/evaluate.ts`) is shared with the real student flow. There is exactly one implementation.

### 22.6 Safety
- Buttons in preview are inert; submit is a no-op with a toast `(תצוגה מקדימה — אין שמירה)`.
- The preview never reads or writes to the real `responses` table.
- Push notifications and side effects are blocked.

### 22.7 Why this matters
The most common bug class in a builder of forms is mis-rendered or mis-targeted conditional logic. A live, real-component preview reduces this risk to near zero. It also catches Hebrew typos before 400 students see them.

### 22.8 Edge cases
| Case | Behavior |
|---|---|
| Admin pastes a long title | Preview wraps/truncates exactly like production. |
| Conditional rule references a removed question | Preview shows an inline error pill on the affected question; admin must fix before saving. |
| Empty options list | Preview shows "no options yet" message; submit blocked. |
| Required field has no label | Preview shows red placeholder "שאלה ללא תווית"; save blocked. |

---

## 23. Response Submission & Edit (student-side)

### 23.1 Flow
1. Student opens a registration from home → `RegistrationDetailPage`.
2. On mount, fire-and-forget `mark_registration_seen(registrationId)`. (Don't block on it.)
3. Render the questions via the shared component (also used by preview).
4. Local form state via `react-hook-form` + `zod` validation derived from the schema.
5. As answers change, conditional fields appear/disappear; values for hidden fields are dropped on submit.
6. "שמור" button calls `submit_response`. On success, show a success state with a summary of saved values.
7. If the edit window is still open, "עריכה" remains visible.

### 23.2 Re-entry after submission
- The detail page shows the latest saved values, the edit window status, and an "ערוך" button if still allowed.
- A small badge: "תשובתך נקלטה ב-[date/time]".

### 23.3 Edit semantics
- Editing replaces the values entirely (no per-field history). The new full set is upserted.
- If admin had previously edited on behalf and student re-edits within the window, that's allowed. The student's edit overwrites and clears `last_edited_by_admin_at`.

### 23.4 Submit failures
| Failure | UI |
|---|---|
| Network | Toast "אין חיבור — נסה שוב". Retain form values. |
| Registration closed since open | Replace form with a closed-state message; redirect to home after 3s. |
| Validation (required missing) | Inline errors on the offending questions; don't submit. |
| Server 5xx | Generic error toast; keep form values. |

---

## 24. Seen Tracking (three-state model)

### 24.1 What is "seen"
`seen` = the student opened the registration detail page for the first time. We do **not** mark "seen" merely because the card appeared on the home screen.

### 24.2 Mechanism
- On `RegistrationDetailPage` mount, fire `mark_registration_seen(registrationId)`.
- The RPC sets `seen_at = now()` only if currently null. Idempotent and cheap.
- Optimistic UI: the card on home updates immediately to "seen" without waiting for server.

### 24.3 Admin-side rendering
| State | Label (Hebrew) | Color |
|---|---|---|
| `seen_at IS NULL AND no response` | `טרם נצפה` | muted |
| `seen_at IS NOT NULL AND no response` | `ראה ולא ענה` | warn (amber) |
| `responded` | `ענה` | success |

The admin monitor view shows a **three-tile summary** (`ענה / ראה ולא ענה / טרם נצפה`) and a stacked bar chart broken down by class.

### 24.4 Pitfalls
- **Do not** infer "the student is ignoring us" from `טרם נצפה`. Push is best-effort; many students simply haven't opened the app since the registration was sent. Labels must remain neutral.
- **Do not** reset `seen_at` on re-opens. It is a one-time mark.

---

## 25. Admin Edit on Behalf of Student

### 25.1 Flow
- From `RegistrationMonitorPage`, click any student row → opens the same form rendering the student would see, prefilled with their current response.
- Save calls `admin_submit_response_on_behalf`.
- Result: response updated, `last_edited_by_admin_at=now()`, prior values stored in `response_history` (overwriting any earlier prior).

### 25.2 What the student sees
- The student's view is unchanged in structure. Their submitted values reflect the admin edit (since the response is the truth).
- A small inline badge on the student's detail page: `נערך על ידי המנהל ב-[date]` — for transparency.

### 25.3 Disabled after archive
After `archived_at`, no on-behalf edits.

---

## 26. Response Audit & History (minimal)

Per the master plan, audit is intentionally minimal.

### 26.1 What is retained
- For every response row: `responded_at`, `submitted_via`, `last_edited_by_admin_at`.
- For every admin-on-behalf edit: exactly one prior version in `response_history`.

### 26.2 What is purged
- Nothing in v1. The retention is small enough that purge isn't needed monthly. **[NOTE: this diverges from the master plan's "monthly purge."]** Rationale: with only one prior version per response, the table grows at most by the count of admin edits. The master plan should be updated to reflect this.

### 26.3 UI surfacing
- The admin monitor row shows a tiny icon when the response was edited by admin, with the prior values revealed on hover/tap.
- No standalone audit log page.

---

## 27. Templates Library

### 27.1 Purpose
Save the entire registration shell (title pattern, description pattern, questions, default audience, default deadlines as relative offsets) for reuse.

### 27.2 Data
`templates.template_payload` shape:
```jsonc
{
  "title": "שבת פרשת {parsha}",
  "description": "...",
  "questions_schema": [ ... ],
  "default_audience": { ... } | null,
  "deadline_offsets": {
    "opens_at_hours": null,
    "closes_at_hours": 72,
    "edit_until_hours": 72
  }
}
```
On instantiation, the offsets are added to "now" to compute concrete dates; the admin can edit before publishing.

### 27.3 Library page
A dedicated "תבניות" area with cards. Each card: name, description, last used at, "צור רישום חדש מתוך תבנית" button, edit, delete.

---

## 28. Questions Library

### 28.1 Items
Two kinds:
- **`single_question`** — one question definition.
- **`block`** — an ordered array of question definitions (e.g., the "טיול" block: meal, parent phone, notes).

### 28.2 UX
- Library page: searchable, filterable by kind, grid of cards.
- In builder: "ספרייה" button opens a drawer; click an item to insert at the current position.
- "שמור לספרייה" available from any question's context menu in the builder.

---

## 29. Groups Library

### 29.1 Static groups
`groups` + `group_members`. Editing a group affects future audience selections but does not retroactively change `registration_targets` for already-published registrations.

### 29.2 Group page UX
- List of groups: name, member count, last used at.
- Edit a group: search students, multi-select; bulk add by paste-IDs.
- Inactive students in the group are shown with an `(לא פעיל)` tag; on audience expansion they are skipped (and the count reflects active members only).

---

## 30. Reports & Exports

This is a large surface area. Build it generously.

### 30.1 Per-registration reports (available on the monitor page)

**A. Summary view**
- **Status** three-state breakdown (counts + percentages): `responded` / `seen, no response` / `not yet seen`.
- **Primary-answer distribution** (bar/pie). For the default `presence` primary, this has **three slices**: `נוכח` / `לא נוכח` / `מתלבט`. These are independent of the status breakdown: every student counted here is `responded`. Do not merge `undecided` into "not yet answered."
- Per-question distribution for each follow-up (bar/pie).
- Per-class breakdown (stacked bar) — by primary answer value.
- Per-group breakdown (if any group is part of the audience).
- "Last 24h" mini-timeline of incoming responses.

**B. Lists** (all sortable, filterable; each can be copied to WhatsApp and exported)
- Responded list — filterable **by primary answer value** (e.g., only `נוכח`, only `מתלבט`).
- "Saw, did not respond" list (status `seen`, no answer at all — distinct from `מתלבט`).
- "Not yet seen" list.
- Removed-from-audience list.

### 30.2 Exports

#### Excel (.xlsx) — primary, multi-sheet
Generated server-side via `export-build` Edge Function. RTL workbook, Hebrew font.

Sheets:
1. **`סיכום`** — counts, percentages, per-question summary tables.
2. **`תשובות מלאות`** — one row per audience member. Columns: שם, שיעור, כיתה, סטטוס (טרם נצפה/ראה ולא ענה/ענה), תאריך צפייה, תאריך מענה, תשובה ראשית, ועמודה לכל שאלת המשך. Hidden-by-condition cells show `לא רלוונטי`.
3. **`לפי כיתה`** — pivot: class × answer value.
4. **`לפי שיעור`** — pivot: grade × answer value.
5. **`טרם ענו`** — list with breakdown of "ראה ולא ענה" vs "טרם נצפה".
6. **`שאלות המשך`** — one sheet per follow-up question's distribution.
7. **`מטא`** — registration title, dates, audience size, export timestamp, who/what generated it.

**Export options** (modal before generating):
- Include ID numbers? (default off).
- Include phone numbers? (default off; not currently sourced — placeholder for future).
- Filter to subset (class, grade, group, response value).
- Include archived/removed rows? (default off).

#### CSV — single-sheet
Equivalent to the `תשובות מלאות` sheet, UTF-8 BOM.

#### PDF — single-page summary + lists
- Summary block (counts, three-state donut, per-class bar).
- Responded list.
- Not-yet-responded list.
- Generated with `pdfmake`; embed a Hebrew font for proper RTL rendering.
- Useful for printouts and "post on the wall."

#### JSON — raw data export
Full snapshot of the registration + audience + responses for the registration. For developer reuse, integration, debugging.

### 30.3 Cross-registration historical export
A separate report page: pick a date range and an audience subset, export per-student attendance-style matrix across all registrations in range. **[FUTURE]** Stretch goal; include UI affordance and a `Coming soon` state in v1, or hide entirely. **Decision:** hide in v1.

### 30.4 WhatsApp copy formats
Buttons available in many places (responded list, "not yet answered" list, monitor sidebar).

**Format A — clean name list (filterable by primary answer value):**
The admin picks which answer to list (`נוכח` / `לא נוכח` / `מתלבט`, or any custom value). The heading reflects the chosen filter.
```
נוכחים ל"שבת פרשת בא":

שיעור א:
1. ישראל ישראלי
2. דוד דוידוב
...

שיעור ב:
1. אברהם אברהמי
...
```
A separate copy can list the `מתלבט` students (useful for follow-up), e.g. heading `מתלבטים ל"שבת פרשת בא":`.

**Format B — ready-made reminder message:**
```
שלום,
טרם נרשמת ל"שבת פרשת בא".
אפשר להירשם עד יום חמישי 19:00.

[link to the app]
```

**Format C — concise count summary:**
```
"שבת פרשת בא" — 71 נוכחים, 12 לא נוכחים, 18 מתלבטים | 14 ראו ולא ענו, 27 טרם נצפו (מתוך 142).
```
Note the two groups separated by `|`: the first three are **answer values** (all "responded"); the last two are **status** (no answer at all).

Each copy button gives visual feedback "הועתק ✓" and respects the privacy default (no IDs, no phones).

---

## 31. Push Notifications

### 31.1 Transport
Web Push (VAPID, RFC 8291), same model as attendance. Implementation in `supabase/functions/send-student-push` and `send-admin-push`.

### 31.2 Student push events
| Event | Trigger | Payload |
|---|---|---|
| `new_registration` | publish | title, short body, deep link to the registration. |
| `reminder` | admin click "send reminder" | title, "תזכורת — עוד לא נרשמת". |
| `deadline_changed` | admin edits dates | title, "מועד עודכן". |
| `reopened` | admin reopens | title, "נפתח שוב". |
| `closing_soon` | configurable threshold (default 6h) | title, "נסגר בקרוב". |

### 31.3 Admin push events
Sent to **all** admin device subscriptions.
| Event | Trigger |
|---|---|
| `closing_soon` | hourly check (lazy on admin app open + on writes touching a registration) — if any `open` registration has `closes_at` within the threshold and response rate < threshold. |
| `low_response_rate` | when `responded / audience_total < threshold` and `closes_at` is approaching. |
| `many_unanswered` | when more than N students still in "טרם נצפה" with deadline near. |
| `sync_problem` | CSV import failed or partially failed. |
| `export_ready` | a large export finished. |
| `push_failure_summary` | when >X% of student pushes failed in a publish. |

### 31.4 Service worker
- Single SW for the whole app; route by URL on click.
- On `push` event: show notification with title, body, icon, badge, and `data.url`.
- On `notificationclick`: focus an existing tab if one is open, else open the deep link.

### 31.5 Subscription lifecycle
- Save the subscription JSON in the matching table on grant.
- Refresh on every login.
- If a send returns `410 Gone`, delete the subscription row.
- If a send returns 4xx (other), increment `failure_count`; on 5, mark stale (still keep the row for diagnostics).

### 31.6 Fallback (no push permission)
- The internal notification center is the safety net.
- On app open after a missed event, the student sees the notification badge + entries.

---

## 32. Internal Notification Center

### 32.1 Student center
- Bell icon in header with a red dot when unread > 0.
- Page or popover: list of `notifications` rows, latest first, with kind icons. Click to deep-link to the registration.
- "סמן הכל כנקרא" action.

### 32.2 Admin center
- Same shape, separate page or popover.
- Filterable by severity.
- "סמן הכל כנקרא" action.

### 32.3 Lifecycle
- Rows are inserted alongside push sending. If push fails, the row still exists.
- No automatic deletion in v1. Older-than-90-day rows are excluded from the default view but accessible via filter.

---

## 33. Archive & History

### 33.1 Student archive
- Page `/archive` (student).
- Lists all `registration_targets` where the registration is `closed` or `archived` and the student has a response or was at least sent the registration.
- Read-only. Shows the student's response if any.

### 33.2 Admin archive
- Page `/admin/archive`.
- Lists `archived` registrations.
- Allows: view full details, export, "unarchive" back to `closed`.
- Counts of audience and three-state retained from `registration_targets` (which is not deleted).

---

## 34. Active/Inactive Students

### 34.1 Flips
- CSV-absent at import → `is_active=false`, `inactivated_reason='csv_missing'`.
- Admin manual toggle → `is_active=false`, `inactivated_reason='admin_disabled'`.
- Reappearing in CSV → reactivated (`is_active=true`, clear reason).

### 34.2 Effects of inactive
- Not selectable in audience by default; appears under a "כולל לא פעילים" toggle.
- Cannot log in (login RPC rejects with `inactive`).
- Existing responses and targets remain visible to admin in archives.

### 34.3 Admin controls
- Students page lists active by default; toggle "כולל לא פעילים" to see all.
- Inactive students show a tag and a "הפעל מחדש" button.

---

# Part IV — UI/UX

## 35. Design Language (Detail)

### 35.1 Visual tone
Modern-quiet SaaS. Generous whitespace, large radii (`md=14px`, `lg=20px`), soft shadows. Bold Hebrew typography with strong hierarchy. One accent color used sparingly for primary actions and "needs attention." Semantic colors otherwise muted.

### 35.2 Typography scale (Hebrew-first)
- `text-display`: 48/52, weight 700 — landing/empty states only.
- `text-h1`: 32/38, weight 700.
- `text-h2`: 24/30, weight 700.
- `text-h3`: 20/28, weight 600.
- `text-body`: 16/24, weight 400.
- `text-body-strong`: 16/24, weight 600.
- `text-small`: 14/20, weight 400.
- `text-caption`: 12/16, weight 500, uppercase off (Hebrew has no case).

### 35.3 Motion
- All animations spring-based via Framer Motion.
- Duration budget: card mount ≤ 250ms, micro-interaction ≤ 150ms.
- Avoid animating layout-affecting properties on lists with > 50 rows.
- Reduced motion: respect `prefers-reduced-motion` everywhere.

### 35.4 Dark mode
- All tokens have dark counterparts.
- Components must not hard-code colors.
- Test every screen in both modes in the live preview.

---

## 36. Student App Information Architecture

```
/login                           — ID entry, name confirm, "המשך"
/                                — Home (open registrations + edit-allowed + closed)
/registration/:id                — Detail / answer / edit
/archive                         — Past registrations (read-only)
/notifications                   — Internal center
```

### 36.1 Home page details
Sections, top to bottom:
1. **רישומים שממתינים לי** — cards in `sent` or `seen` state with no response. Sorted by closes_at ascending.
2. **רישומים שעניתי עליהם** (if any with edit still allowed) — `responded` cards with an "ערוך" affordance.
3. **רישומים שנסגרו לאחרונה** (last 14 days, max 5) — read-only previews. Tap to read.
4. **גישה לארכיון** — link.

Empty state: a calm illustration plus "אין רישומים פתוחים כרגע 🙂". Show the bell icon if there are unread notifications.

### 36.2 Registration detail
- Sticky header: title + countdown to `edit_until` or `closes_at`.
- Body: questions, primary first; conditionals appear with a slide-in.
- Footer: "שמור" (primary), "בטל" (secondary), or "ערוך" if already submitted and still editable.

### 36.3 States table

| State | Conditions | UI |
|---|---|---|
| `not yet visited` | seen_at null, no response | accent dot on card; full detail page on open. |
| `seen, no response` | seen_at set, no response | no dot but "ראית ולא ענית" pill on card. |
| `responded, editable` | response exists, `edit_until > now` | "ענית: X" + edit button. |
| `responded, locked` | response exists, `edit_until <= now`, `archived_at null` | "ענית: X", read-only. |
| `closed, not responded` | `closes_at <= now`, no response | dimmed card, "החלון נסגר". |
| `archived` | `archived_at set` | visible only in `/archive`. |

---

## 37. Admin App Information Architecture

Goal: **a very organized, calm desktop app**. Many features, but the layout makes it easy to find anything. Logical groupings, never a wall of buttons.

### 37.1 Top-level nav (left rail)
1. **דשבורד** — overview.
2. **רישומים** — list, build, monitor.
3. **תלמידים** — list, sync, active/inactive.
4. **קבוצות** — groups library.
5. **שאלות** — questions library.
6. **תבניות** — templates library.
7. **ארכיון** — archived registrations.
8. **דוחות** — cross-registration reports (placeholder in v1).
9. **התראות** — admin notifications center.
10. **הגדרות** — PIN change, thresholds, app settings.

### 37.2 Dashboard layout (Bento)
Tiles:
- **Top row (3-col each):** total open registrations · closing in 24h · audience reached today.
- **Center row (large):** "active registrations" table with progress bars per registration (responded %).
- **Right column (4-col):** "needs attention" stack — low response rate, sync problems, push failures.
- **Bottom row:** trend mini-charts (responses over time, 7d).

### 37.3 Registrations list
- Filters: status (open/scheduled/closed/archived), audience size, deadline range, search.
- Columns: title, status, audience size, responded %, closes_at, last activity, actions.
- Bulk actions: close, archive, export (per-row export menu).

### 37.4 Registration builder page
Three-pane layout (desktop):
| Area | Purpose |
|---|---|
| Left | step navigator (Details → Questions → Audience → Review) |
| Center | active step editor |
| Right | **Student Preview** (see §22) |

Steps:
1. **Details:** title, description, dates.
2. **Questions:** primary + follow-ups + conditionals; pull from library.
3. **Audience:** picker; resolved count.
4. **Review:** read-only summary + final preview; "פרסם" button.

### 37.5 Registration monitor page
Top: three-state donut + per-class stacked bar + responded-percent over time line. Middle: table of audience with row state, deep link, on-behalf edit. Bottom: actions (send reminder, copy lists, export).

### 37.6 Students page
- Filters: grade, class, active/inactive, search.
- Columns: name, ID (toggled visibility), grade, class, active state, last imported.
- Bulk: deactivate/reactivate.
- "סנכרון תלמידים" CTA at the top, opens the CSV import flow.

### 37.7 Settings page
- Change admin PIN (requires entering current PIN).
- Threshold knobs (`closing_soon_hours`, `low_response_threshold`).
- Theme.
- About / version.

---

## 38. Component Inventory

| Component | Purpose |
|---|---|
| `<RegistrationCard>` | Student-facing card, supports all three states. |
| `<RegistrationStatusPill>` | Compact state pill. |
| `<ThreeStateDonut>` | The admin's signature chart. |
| `<ClassStackBar>` | Per-class stacked bar. |
| `<RespondedTimeline>` | Sparkline of responses over time. |
| `<QuestionEditor>` | Builder's center editor; one variant per question type. |
| `<ConditionalRuleEditor>` | Builder's rule UI. |
| `<StudentPreviewFrame>` | The device-shaped preview surface. |
| `<AudiencePicker>` | The composable audience picker. |
| `<CsvImportWizard>` | Multi-step import flow. |
| `<DataTable>` | Sortable, filterable, virtualized. |
| `<DashboardTile>` | Bento tile primitive. |
| `<EmptyState>` | Illustrated empties. |
| `<ErrorState>` | Error illustrations + retry. |
| `<CopyToWhatsAppButton>` | Format-aware copy button. |
| `<ExportMenu>` | Excel/CSV/PDF/JSON options. |

---

## 39. State Patterns

### 39.1 Loading
- Lists: skeleton rows that mirror the shape (3–8 placeholder rows).
- Cards: skeleton card variants.
- Charts: shimmer rectangle.
- Inline data: a small shimmer pill.
- Never block the entire page on a single network call once shell is rendered.

### 39.2 Empty
- Illustrated and warmly worded. No "0 results" alone.
- Provide the next action where possible ("צור רישום ראשון").

### 39.3 Error
- Friendly Hebrew message + a "נסה שוב" button.
- Capture details for Sentry (if configured) but don't leak internals to the user.

### 39.4 Success
- Toasts for transient feedback (autodismiss 3s).
- Inline confirmation for terminal flows (submit, publish): a checkmark + summary.

### 39.5 Offline
- A persistent bottom bar "אין חיבור — נסה שוב" appears when offline.
- Student response submission while offline: **block** in v1 (do not queue). Show a clear message. Offline queueing is **[FUTURE]**.

---

## 40. Accessibility

- WCAG AA contrast for body text and primary actions.
- Tap targets ≥ 44px on mobile.
- Keyboard navigation throughout admin app: focus rings visible, tab order logical.
- Screen reader labels on all icon-only buttons.
- Honor `prefers-reduced-motion`.
- Color is not the sole signal of state (always pair with icon or label).

---

## 41. Responsive Rules

### Student
- Designed for portrait phones; works on landscape and tablet.
- Desktop: center column max-width ~480px to keep mobile-grade design tight.

### Admin
- Primary breakpoint: desktop ≥ 1280px (three-pane builder, full Bento).
- ≥ 768px: two-pane builder (preview as collapsible drawer).
- < 768px: tabs.
- Tables: collapse into stacked cards on narrow screens; key columns first.

---

# Part V — Engineering Practices

## 42. Error Handling

### 42.1 Server (RPC)
- Always return either `{ data: ... }` or `{ error: { code, message } }`.
- Codes are stable strings: `not_found`, `unauthorized`, `forbidden`, `invalid_input`, `conflict`, `rate_limited`, `server_error`.
- Never leak SQL errors.

### 42.2 Client
- The API wrapper layer turns errors into typed exceptions per code.
- React Query `onError` handlers route to the central toast + Sentry.
- Critical flows (publish, submit) show a modal error with retry options.

### 42.3 Edge Function errors
- Always return JSON with `status` and `error` fields. Logs include the request id.

---

## 43. Edge Cases Catalog

A living checklist; build with these in mind from day one.

1. CSV import: 0 rows. 1 row. 5,000 rows. Duplicate IDs. Bad encoding. Missing required column. Hebrew apostrophe variants in grade.
2. Login: 9-digit ID with leading zeros. Inactive student attempts login. Active student whose CSV was just re-imported with a name change (token still has old name in claims — wrapper should refresh).
3. Multiple admin devices: two admins editing the same registration concurrently — last write wins; no locking. **[ASSUMPTION]** acceptable.
4. Student opens a registration that was removed from their audience after opening: show "הוסר ממך — פנה למשרד"; do not 404.
5. Conditional question whose source question was deleted in the builder: see §20.4.
6. Student finishes typing ID, server returns name, student keeps typing → ignore the stale response (latest-request-wins in the wrapper).
7. Push subscription rotates (browser-driven) — handle via SW resubscription on activate.
8. Service worker version skew — show "עדכון זמין, רענן" banner.
9. Time skew between admin device and server > 1 minute — deadlines visible to user always come from server `now()` in API responses; never trust device clock for deadline checks.
10. Long Hebrew titles — ensure no overflow in any card/list/preview.
11. Soft-removed audience target: stays in admin reports as "הוסר" with timestamp.
12. Admin attempts to publish without a primary question → block in builder + RPC.
13. Same student appears in multiple audience selections (groups + grade) → dedupe in `publish_registration`.
14. Reactivation: a student returns via CSV; their existing `registration_targets` from when they were active still apply.
15. PDF/Excel export for a 1,000-target registration — must stream and finish in < 10s. If not, queue & notify on completion.

---

## 44. Testing Strategy

### 44.1 Layers
- **Unit:** pure logic — Hebrew normalization, Israeli ID validator, conditional evaluator, audience resolver, deadline math, question schema validators.
- **Integration:** RPC behavior with a test Supabase project; CSV import preview/commit end-to-end against a seeded DB.
- **Component:** key UI components in Storybook (`RegistrationCard`, `QuestionEditor`, `StudentPreviewFrame`, `AudiencePicker`).
- **E2E:** Playwright. Critical flows below.

### 44.2 E2E critical flows
1. Student logs in, sees pending registration, opens it (seen recorded), submits, sees confirmation.
2. Student edits before edit_until.
3. Admin builds a default three-option (present/absent/undecided) registration with one conditional follow-up, previews it, publishes to a class, sees responses on monitor (verify `undecided` counts as responded and appears as its own answer slice).
4. Admin edits a student's response on behalf; the student sees the badge.
5. CSV import with mixed creates/updates/inactivations, with errors, with confirmation.
6. Export `xlsx` and verify Hebrew renders, sheets present, hidden-by-condition cells say "לא רלוונטי".
7. Reopen a closed registration; verify pushes go to targets.
8. PWA install on Chrome/Edge/Safari; push permission grant; receive a push.

### 44.3 Data fixtures
A `seed.sql` for local dev with realistic Hebrew names, classes, and a few seeded registrations.

### 44.4 Performance budgets
- Student home: TTI ≤ 1.5s on mid-tier Android, 3G fast.
- Admin dashboard: TTI ≤ 2.5s on desktop, broadband.
- Excel export build: ≤ 5s for typical registration (≤ 200 targets), ≤ 15s for 1,000.

---

## 45. Observability

- Sentry (or equivalent) for both client and Edge Functions.
- Supabase logs reviewed regularly.
- `csv_import_runs` provides operator-level audit on imports.
- An admin "diagnostics" mini-page (under Settings) shows: recent push failures, recent import runs, current open subscription counts.

---

# Part VI — Phased Implementation Plan

Phases are gates. Each phase has a Definition of Done; no phase begins until the prior is signed off. Phases 1–11 are the v1 release.

Conventions per phase:
- **Goal** — the one-line outcome.
- **Scope** — what's in.
- **Out of phase** — what's deferred.
- **Backend** — schema/RPC/Edge Function work.
- **Frontend** — pages/components.
- **Edge cases to cover.**
- **Testing checklist.**
- **Definition of Done (DoD).**

---

### Phase 1 — Project Setup & Architecture
**Goal:** a working PWA skeleton, two routes (student + admin), Supabase project provisioned, CI/CD live.

**Scope:**
- Repo bootstrap per §4.
- Vite + React + TS + Tailwind + RTL plugin + shadcn primitives.
- PWA scaffold (manifest, basic SW).
- Supabase project in `eu-central-1`, naming `rishumei-hevron` (and `-staging`).
- Vercel project, environments wired.
- Sentry initialized (optional).
- Hebrew font self-hosted; design tokens in CSS variables.
- `<html dir="rtl" lang="he">`.

**Out of phase:** any business logic.

**DoD:** deploying `main` to staging produces a Hebrew RTL hello-world with dark mode toggle, lighthouse PWA ≥ 90.

---

### Phase 2 — Supabase Schema, Security, and Migrations
**Goal:** the database is correct, RLS is on, RPCs exist as stubs.

**Scope:**
- All tables per §12 created via timestamped migrations.
- Indexes & constraints per spec.
- RLS enabled on all tables; policies per §16.
- RPC function stubs (signatures + permissions + claim checks) for §14.
- `app_settings` seeded with default thresholds + bootstrap admin PIN.
- TS types generated from the schema and committed.

**Backend:** all of the above. Edge Function shells with signed-handler boilerplate.

**Frontend:** typed Supabase client + API wrappers in `src/lib/api/`.

**Edge cases:** RLS smoke test — anonymous token can call nothing except `*_login`.

**Testing checklist:**
- [ ] Each table is in the DB with the right columns.
- [ ] RLS blocks anonymous reads.
- [ ] RPC stubs reject invalid JWTs.

**DoD:** running a typed `students` count query returns 0 with proper auth; RLS denies without auth.

---

### Phase 3 — Student CSV Import & Safe Sync
**Goal:** an admin can import the institution's CSV with a preview and commit, and student rows appear correctly.

**Scope:**
- `<CsvImportWizard>` (upload → preview → confirm → result).
- `csv-import-validate` Edge Function: parse, normalize, diff vs DB.
- `csv-import-commit` Edge Function: apply changes transactionally; never deletes.
- Students list page (`/admin/students`) with filters and bulk activate/deactivate.

**Backend:** Edge Functions, supporting SQL (upserts, soft-inactivation).

**Frontend:** wizard, students table, empty/error states.

**Edge cases:** all of §17.5.

**Testing checklist:** all of §44.2 #5.

**DoD:** import three test CSVs (clean, with errors, with subset for inactivation); preview accurate; commit correct; subsequent re-import is idempotent.

---

### Phase 4 — Auth Flows
**Goal:** students and admins can log in.

**Scope:**
- Student login page + RPC + token storage.
- Admin login page + RPC + token storage.
- Logout, session restore, sliding refresh.
- Rate limiting via Edge Function gate for `student_login`.
- PIN change in Settings (admin).

**Edge cases:** §43.2.

**DoD:** a real student row can log in and reach `/`; an admin can log in and reach `/admin`; inactive students are rejected; wrong PIN locks after the configured threshold.

---

### Phase 5 — Core Registration Model
**Goal:** the data model for registrations works end-to-end, even without a builder UI yet.

**Scope:**
- All registration-related tables verified in use.
- RPC: `publish_registration`, `close_registration`, `reopen_registration`, `archive_registration`, `update_audience`, `submit_response`, `mark_registration_seen`, `admin_submit_response_on_behalf`.
- Seed a sample default three-option (present/absent/undecided) registration via SQL and exercise the RPCs from a script/test.

**DoD:** the integration test suite can create, publish, get responses, edit, close, reopen, archive a registration.

---

### Phase 6 — Admin Registration Builder
**Goal:** the admin can create and edit registrations through a polished UI.

**Scope:**
- `RegistrationBuilderPage` with three-pane layout.
- `<QuestionEditor>` for `presence` (default), `yes_no`, `single_choice`, `multi_choice`, `text`.
- `<ConditionalRuleEditor>`.
- "Pull from library" and "save to library" hooks.
- `<AudiencePicker>` (basic version — full polish in later phase if needed).
- Validations per §20.4.

**Out of phase:** Templates library (phase 12-ish), groups library page (phase 12-ish; the picker can still consume `groups`).

**Edge cases:** §43 #5, #12.

**DoD:** admin can build, save as draft, publish, edit a published registration.

---

### Phase 7 — Student Preview Mode
**Goal:** the student preview is live and accurate.

**Scope:**
- `<StudentPreviewFrame>` and the shared student detail component.
- Preview state controls.
- Wiring into the builder.
- Validation pills for broken conditionals etc.

**DoD:** the preview is byte-for-byte identical (visually) to the student page given the same data; all preview state controls work; no network calls fire from preview mode.

---

### Phase 8 — Student Dashboard & Response Flow
**Goal:** students can see and respond to their registrations.

**Scope:**
- `HomePage`, `RegistrationDetailPage`, `ArchivePage`, `NotificationsPage`.
- Seen tracking on detail mount.
- Submit + edit flow.
- All UI states per §36.3.

**DoD:** student E2E from login through archive works.

---

### Phase 9 — Admin Monitoring Dashboard
**Goal:** the admin can monitor a live registration's state and act on it.

**Scope:**
- `DashboardPage` (Bento overview).
- `RegistrationsListPage` (filters + bulk actions).
- `RegistrationMonitorPage` with realtime subscription (§15).
- Three-state donut, per-class bar, responded-over-time.
- On-behalf edit modal.
- "Send reminder" action.

**DoD:** admin can monitor an active registration with live updates; bulk and per-row actions work; on-behalf edits are recorded.

---

### Phase 10 — Reports, Exports & WhatsApp
**Goal:** full reporting and export surface.

**Scope:**
- Per-registration summary, lists, breakdowns.
- Excel multi-sheet via `export-build` Edge Function.
- CSV, PDF, JSON exports.
- WhatsApp copy formats A/B/C with privacy defaults.
- "Export ready" admin notification on long-running builds.

**Edge cases:** large registrations, hidden-by-condition cells, dark/Hebrew font rendering in PDF.

**DoD:** open a registration, export each format, verify content; copy each WhatsApp format, paste into a sandbox, verify formatting.

---

### Phase 11 — Push & Admin Notifications
**Goal:** real push works end-to-end + admin notifications light up appropriately.

**Scope:**
- Service worker with `push` and `notificationclick` handlers.
- Subscription registration on grant.
- `send-student-push` and `send-admin-push` Edge Functions.
- Triggers per §31.2 / §31.3.
- Internal centers (§32).
- Diagnostics mini-page.

**DoD:** publish a registration → matching students with permission receive push; closing-soon admin push fires within an hour of threshold; failure handling cleans up dead subscriptions.

---

### Phase 12 — Archives, Libraries Polish, and Settings
**Goal:** finalize the supporting areas.

**Scope:**
- Archive pages (student and admin).
- Questions library, groups library, templates library pages and integrations.
- Settings page in full (PIN change, thresholds, theme).

**DoD:** all top-nav items lead to functional pages.

---

### Phase 13 — Design System & RTL UI Polish
**Goal:** the app feels finished.

**Scope:**
- Visual QA pass across all pages: tokens, typography, spacing, motion.
- Dark mode pass.
- Accessibility pass (focus rings, contrast, screen reader labels).
- Empty/error/loading state pass.
- Performance pass against §44.4 budgets.

**DoD:** Lighthouse mobile ≥ 90 across PWA/A11y/Perf for student app; design lead sign-off.

---

### Phase 14 — Testing, QA, Production Readiness, Launch
**Goal:** ship.

**Scope:**
- E2E suite green per §44.2.
- Manual QA pass per a written checklist.
- Production Supabase configured (separate from staging), seeded with the real admin PIN (rotated), real CSV imported.
- DNS, SSL.
- Monitoring/alerts.
- Rollback plan documented.
- A 1-page Hebrew runbook for the admin (how to import, how to publish, what to do if push fails).

**DoD:** the production URL serves the app; a real student logs in and registers; metrics flow; admin can use the system unaided.

---

# Part VII — Appendices

## Appendix A — CSV Format Specification

A single CSV file. UTF-8 (with or without BOM). Headers row required.

**Headers (Hebrew, in any order):**
| Header | Required | Notes |
|---|---|---|
| `שם מלא` | Yes | |
| `תעודת זהות` | Yes | Will be zero-padded to 9 digits. |
| `שכבה` | Yes | Synonym `שיעור` accepted. |
| `כיתה` | Yes | Will be prefixed `כיתה ` if not already. |

**Sample row:**
```
שם מלא,תעודת זהות,שכבה,כיתה
ישראל ישראלי,012345678,שיעור א,כיתה הרב משה
```

**Reference:** match the source structure already used by the attendance project; reuse the same parsing patterns conceptually (Hebrew normalization, zero-padding).

---

## Appendix B — RPC Signatures (typed contracts)

```ts
// 14.1
student_login(p_id_number: string): { token: string, student_id: string, full_name: string, grade: string, class_id: string } | { error: 'not_found' | 'inactive' | 'rate_limited' };

// 14.2
admin_login(p_pin: string): { token: string } | { error: 'wrong_pin' | 'rate_limited' };

// 14.3
mark_registration_seen(p_registration_id: string): { already_seen: boolean, seen_at: string };

// 14.4
submit_response(p_registration_id: string, p_values: Record<string, unknown>): { status: 'ok', edit_until: string | null } | { error: 'closed' | 'invalid_input' | 'not_targeted' };

// 14.5
admin_submit_response_on_behalf(p_registration_id: string, p_student_id: string, p_values: Record<string, unknown>): { status: 'ok' } | { error };

// 14.6
publish_registration(p_registration_id: string, p_audience: AudienceInput): { audience_count: number, push_attempted: number, push_failed_count: number };

// 14.7
update_audience(p_registration_id: string, p_add: AudienceInput, p_remove: { student_ids: string[] }): { added: number, removed: number };

// 14.8 / 14.9
close_registration(p_registration_id: string): { status: 'closed' };
reopen_registration(p_registration_id: string): { status: 'open' };
archive_registration(p_registration_id: string): { status: 'archived' };

// 14.10
mark_notification_read(p_notification_id: string): { ok: true };
```

```ts
type AudienceInput = {
  groups?: string[];                  // group ids
  grades?: string[];                  // e.g., "שיעור א"
  classes?: string[];                 // class ids
  individuals?: string[];             // student ids
  everyone?: boolean;
  paste_ids?: string[];               // raw 9-digit IDs, server matches to students
  include_inactive?: boolean;         // default false
};
```

---

## Appendix C — SQL Migration Sketches

The migrations are not pasted in full here, but each is a single file `supabase/migrations/YYYYMMDDHHMM_<name>.sql` and is atomic. Suggested order:

1. `..._initial_schema.sql` — tables 12.1–12.13.
2. `..._indexes.sql` — all indexes per spec.
3. `..._rls.sql` — enable RLS, baseline policies.
4. `..._rpc_auth.sql` — `student_login`, `admin_login`.
5. `..._rpc_registrations.sql` — registration RPCs.
6. `..._rpc_seen_and_response.sql` — seen and response RPCs.
7. `..._seed_settings.sql` — `app_settings` defaults.

Each migration is reversible via a matching `down.sql` where feasible.

---

## Appendix D — Push Payload Formats

**Student push** (JSON sent to `send-student-push`):
```json
{
  "student_id": "uuid",
  "kind": "new_registration",
  "title": "רישום חדש: שבת פרשת בא",
  "body": "ענה עד יום חמישי 19:00",
  "url": "/registration/<id>"
}
```

**Admin push**:
```json
{
  "kind": "low_response_rate",
  "title": "אחוז מענה נמוך",
  "body": "\"שבת פרשת בא\" — 32% נרשמו, נסגר בעוד 4 שעות",
  "url": "/admin/registration/<id>/monitor",
  "severity": "warn"
}
```

---

## Appendix E — Excel Export Column Dictionary

`תשובות מלאות` sheet columns (left to right in a Hebrew RTL workbook means visually right to left):

| # | Header | Source |
|---|---|---|
| 1 | שם | `student_snapshot.full_name` |
| 2 | שיעור | `student_snapshot.grade` |
| 3 | כיתה | `student_snapshot.class_id` |
| 4 | סטטוס | derived: טרם נצפה / ראה ולא ענה / ענה |
| 5 | תאריך צפייה | `seen_at` |
| 6 | תאריך מענה | `responded_at` |
| 7 | תשובה ראשית | `values[primary_question_id]` (rendered to label; for the default primary one of `נוכח` / `לא נוכח` / `מתלבט`) |
| 8..N | <לכל שאלת המשך> | `values[q.id]`; hidden-by-condition → `לא רלוונטי` |
| N+1 | נערך ע"י המנהל | tick if `submitted_via='admin_on_behalf'` or `last_edited_by_admin_at` not null |

Header row is bold, freeze panes on row 1. Number format for IDs is text (preserve leading zeros). Column widths auto-fit.

**Note:** the `סטטוס` column (#4) is the per-student *status* (`ענה` includes anyone who answered, **even `מתלבט`**). The `תשובה ראשית` column (#7) is the *answer value*. A row with status `ענה` and primary answer `מתלבט` is correct and expected — keep the two columns conceptually separate in pivots.

---

## Appendix F — Glossary

- **Primary question** — the first question of a registration; cannot be conditional. Default type is `presence`.
- **`presence`** — the default primary question type. Three fixed answer values: `present` / `absent` / `undecided` (Hebrew `נוכח` / `לא נוכח` / `מתלבט`). All three are real answers (status `responded`).
- **Undecided** — an **answer value** meaning "the student responded but has not decided." NOT a status. A student who answered `undecided` is `responded`, distinct from the `seen` status (opened but gave no answer).
- **Audience snapshot** — the list of students captured at publish time (or later via `update_audience`). Stored in `registration_targets`.
- **Three-state status** — per `(registration, student)`: `sent` (no `seen_at`), `seen` (has `seen_at`, no response), `responded` (has any answer, including `undecided`). *Distinct from the three answer values of the default primary question.*
- **Edit window** — `[created_at .. edit_until]` for students; `[created_at .. archived_at]` for admin on-behalf edits.
- **Library** — a reusable store: `questions`, `groups`, or `templates`.
- **Best-effort push** — push delivery is attempted but not guaranteed; the internal notification center is the safety net.

---

## Closing Notes for the Engineering Team

1. **Hebrew/RTL is non-negotiable from day one.** Don't postpone RTL to "polish." Build every component in RTL from its first render.
2. **The CSV is the only door for student data.** No UI for adding/editing students beyond active/inactive toggles. Resist scope creep here.
3. **The student preview shares its code with the real student page.** If you find yourself writing a second implementation, stop and reuse.
4. **Data efficiency is a feature.** Default to no realtime, no over-fetching, server-side aggregation. The principles in §9 are enforceable.
5. **Treat "admin" as one logical actor.** Multiple humans share the admin role but the system doesn't model them individually. Don't add per-admin fields, audit, or auth.
6. **Capacity, waitlists, and aggregate-results-for-students are explicitly out.** Do not stub them; do not add UI affordances. They were declined by management.
7. **The attendance project is a teacher, not a parent.** Borrow patterns (Hebrew normalization, zero-padding, VAPID push transport, PIN model). Do not borrow business logic, schema, or UI.

*End of specification — v1.0.*
