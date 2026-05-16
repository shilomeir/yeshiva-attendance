# Internal Audit 2.0 — Master Plan

**Project:** Yeshivat Shavi Hevron — Internal Audit Subsystem (replaces existing RollCall)
**Document type:** Strategic master plan + architectural blueprint
**Status:** Draft v1 — pending review
**Authoring posture:** Written as if by a multi-disciplinary team of senior product strategist, software architect, UX designer, backend engineer, frontend engineer, database architect, security reviewer, QA lead, and technical writer.
**Date:** 2026-05-16

---

## How to read this document

This document is **a plan, not an implementation**. It does not contain code beyond what is required to make a structural decision unambiguous. Implementation-ready code for the recommended approach exists separately in `INTERNAL_AUDIT_IMPLEMENTATION_REFERENCE.md`; **that file is a reference, not the source of truth.** This file is the source of truth for product, design, and architecture.

The document is opinionated. It challenges parts of the original request where the original request would have produced an inferior product. It states recommended defaults clearly and reserves only genuinely unresolved decisions for the Open Questions section.

The document is structured to be readable in three passes:

- **Pass 1 — Executive Summary + Final Recommendation.** ~15 minutes. Enough to sign off scope and budget.
- **Pass 2 — Goals, Decisions, Use Cases, Architecture, Risks.** ~60 minutes. Enough to commit to the approach.
- **Pass 3 — Full document.** ~3 hours. Required before implementation begins.

Section numbering is stable across revisions. Cross-references use section numbers (e.g. *see §11.3*).

---

# Part 0 — Working Glossary

Terms used throughout this document carry **precise meanings** as defined here. Where Hebrew is preferred for user-facing language, both forms are listed.

| Term | Meaning |
|---|---|
| **Audit** / *ביקורת* | A bounded, time-limited operation in which the yeshiva determines, for each student in a defined population, their physical presence category at approximately one moment in time. An audit has a start, an end, and a result. |
| **Audit Session** | The single concrete instance of an audit: one row in the database, one entry in the history. |
| **Session mode** | The collection strategy for the audit. Two are defined: `MANUAL` (supervisor-driven) and `LOCATION` (device-driven GPS). The mode is fixed at the start and cannot change mid-session. |
| **Category** | The classification of an individual student's state within an audit. Five values exist; only three are user-pickable. See §11.2. |
| **Marker** | Any actor — human or system — that has set a category value on a response. Markers include `ADMIN`, `SUPERVISOR:<class>`, `AUTO_GPS`, `AUTO_DEPARTURE`, `AUTO_CLOSE`. |
| **Response** | The record of one student's outcome in one session. Created on session open, mutated as data arrives, finalized on session close. |
| **Distance bucket** | A semantic grouping of GPS distance from campus. Four values: `GREEN` (on campus, ≤300 m), `BLUE` (in immediate area, 300 m – 1 km), `ORANGE` (Hebron metro, 1–5 km), `RED` (out of area, >5 km). |
| **Alert** | A persisted warning generated when a response transitions into `ORANGE` or `RED`. Alerts are explicit, persistent objects; they are not transient UI toasts. |
| **Live dashboard** | The screen shown to the admin while a session is `ACTIVE`. It is the product's centerpiece. |
| **Active session** | A session whose status is `ACTIVE`. By default, at most one such session exists at any time (see §5.4 for the rationale and the future relaxation path). |
| **Mashgiach** / *משגיח* | Yeshiva administrator with oversight authority. In this system, mapped to the `admin` role. |
| **Madrich** / *מדריך* / Supervisor / *רכז* | Class-level authority. In this system, mapped to the `supervisor` role. |
| **Talmid** / *תלמיד* | Student. |
| **Source of truth** | The single authoritative location of a piece of state. For audit data, the source of truth is **always the database**, never the client. |
| **Replay-safe** | A property of a screen: the screen renders the correct, complete, current state purely from a server query, with no dependence on what previously happened in this browser tab. All audit screens must be replay-safe. |
| **Halachic privacy** | Privacy considerations specific to a religious-school context, including modesty, parental authority over minors' data, and rabbinic oversight of sensitive information. |

---

# Part 1 — Executive Summary

## 1.1 The proposition in one paragraph

Build a **single, persistent, real-time attendance auditing subsystem** that replaces the current ad-hoc *RollCall* mechanism. The product gives a yeshiva administrator the ability, with one decision, to know within minutes where every student is. It has two modes — **fast manual** (supervisor-driven, ~3 minutes) and **location** (device GPS, ~5 minutes) — and a single live dashboard that aggregates the result in real time. The system persists every datum to a server-side database from the moment of capture; any participant who refreshes the page sees identical state. History is retained indefinitely and is queryable. The replacement is mandatory because the existing flow is non-persistent, single-user, lossy, and inaudible at scale.

## 1.2 What success looks like

Within thirty days of production rollout:

- The administrator can complete an audit of all 381 students in **under five minutes** in manual mode, **under seven minutes** in location mode, **measured end-to-end**.
- ≥ **90%** of student responses in location mode arrive without supervisor intervention.
- Zero data loss on refresh: in QA, refreshing the admin, supervisor, or student page mid-session preserves and re-renders 100% of state.
- A second administrator opening the dashboard concurrently sees the **same** data within **one second** of the first.
- All audit sessions, alerts, and category transitions are retrievable from history six months later, with full attribution.

## 1.3 What this plan costs

- Engineering: estimated **160–200 hours** of focused senior-engineer time over a calendar window of **4–6 weeks**, including QA and rollout, assuming no parallel feature work.
- Infrastructure: marginal. Stays within the existing Supabase Free tier through the first 12 months at projected volume (see §17.4).
- Operational: a one-time **30-minute training session** with the administrator, **15 minutes** per supervisor, plus an in-app onboarding card for students.

## 1.4 What this plan changes about the original idea

The original request asked for "a live data dashboard" and "real-time location collection". The recommended plan delivers that, but **rejects three implicit assumptions** in the request:

1. **Rejection 1 — the request implies the dashboard is the product.** It is not. The product is *the audit*. The dashboard is the administrator's view onto the audit. This distinction matters because it forces every design decision to serve the audit lifecycle, not the spectacle of live data.
2. **Rejection 2 — the request implies that "real-time location collection" is unconditional.** It is not. Location collection in a religious-school setting touches halachic privacy, parental authority over minor children, and the asymmetry of power between students and administration. The recommended plan treats location collection as **explicitly consented, time-bounded, narrow-purpose, and minimally retained.** See §16.
3. **Rejection 3 — the request implies "more data, more colors, more screens" equals quality.** It does not. The recommended plan deliberately removes a "sick" category (originally proposed), removes supervisor-initiated audits (originally proposed), and keeps the live dashboard to **four primary views**: KPI strip, class grid, geographic map (location mode only), and activity feed. Restraint is the design strategy.

## 1.5 The recommended approach in one diagram

```
                      ADMIN                                 SUPERVISOR                STUDENT
                        │                                       │                       │
                        │  start_audit(mode, classes)           │                       │
                        ▼                                       │                       │
            ┌──────────────────────────┐  push                  │                       │
            │   audit_session ACTIVE   │ ───────────────────────►                       │
            │   (single row, DB)       │                        │  push (LOC mode)      │
            └────────┬─────────────────┘ ───────────────────────────────────────────────►
                     │                                          │                       │
                     │  pre-create 1 response per student       │                       │
                     ▼                                          │                       │
            ┌──────────────────────────┐                        │                       │
            │   audit_responses ×N     │ ◄──────────── mark ────┤   (MANUAL mode)       │
            │   (one per student)      │ ◄──────────────── submit GPS ──────────────────┤   (LOCATION)
            └────────┬─────────────────┘                        │                       │
                     │  realtime postgres_changes               │                       │
                     │     ───┐    ───┐    ───┐                 │                       │
                     │        ▼       ▼       ▼                 │                       │
                     │   ┌──────────────────────────┐           │                       │
                     │   │  LIVE DASHBOARD (admin)  │           │                       │
                     │   │  KPI · Grid · Map · Feed │           │                       │
                     │   └──────────────────────────┘           │                       │
                     │                                          │                       │
                     │  close_audit(notes)                      │                       │
                     ▼                                          │                       │
            ┌──────────────────────────┐                        │                       │
            │   audit_session CLOSED   │                        │                       │
            │   + immutable history    │                        │                       │
            └──────────────────────────┘
```

Every layer of the rest of this document defends, refines, or stress-tests one part of that diagram.

---

# Part 2 — Current State Assessment

A plan that does not honestly inventory what exists is a plan that creates accidental regressions on launch. This section is an unsentimental description of the **status quo as of 2026-05-16**, derived from CLAUDE.md, the existing source tree, and the migration history.

## 2.1 What exists today, in plain language

The yeshiva has a working attendance system. Students are managed through Google Sheets, sync'd one-way into Supabase, and authenticated by ID number. Three roles exist: `student`, `supervisor` (class-level), and `admin` (yeshiva-level). A departure subsystem — separate from audits — handles "I'm going home for an hour" workflows with quotas, approvals, and a cron-driven state machine. That subsystem is solid; this plan does not change it.

The audit-adjacent functionality today is a feature called **RollCall** (*ביקורת פנימית* in the UI). RollCall does roughly this:

1. The administrator clicks "broadcast GPS request" from an admin page.
2. A Supabase Realtime broadcast is fanned out to all currently-connected student devices.
3. Each connected device opens a GPS prompt.
4. Each device that received the broadcast, granted permission, and got a fix POSTs its location to a single column on the `students` table (`lastLocation`).
5. The admin page subscribes to the same broadcast channel and renders incoming coordinates as they arrive.

That is the entire feature. It is short. It is fragile. The failure modes are systemic, not edge cases.

## 2.2 Concrete failures of the current design

The following are not hypothetical. They are direct consequences of the current architecture.

1. **No persistence.** The broadcast is ephemeral. A student whose device was offline at the moment of broadcast receives nothing — not "later", not ever. An admin who closed the tab between broadcast and rendering loses the run. Refreshing the admin page mid-run wipes the screen. There is no audit history. The product has no memory.

2. **Single live admin.** Only the admin who *initiated* the broadcast sees the responses. A second admin loading the same page sees an empty screen. This is by design of the broadcast pattern — broadcasts go to channels, channels are scoped to the subscriber, and there is no shared state.

3. **No supervisor visibility.** Supervisors cannot see the result of an audit at all. They are passive subjects of it, not participants. The administrative model — *the supervisor is the eyes of the rosh yeshiva in the class* — is structurally unsupported.

4. **No manual mode.** Today's flow assumes the device responds. There is no path for "student is in the building, has no phone, supervisor confirms presence". The flow has one path and it requires a working device with cooperation.

5. **One column, one location, one moment.** `students.lastLocation` is a single JSONB column. The "last" location overwrites the previous one. There is no association between a location reading and the audit run that produced it. Forensic reconstruction ("where were the seventy-five students at 10:30 last Tuesday?") is impossible because the data is not modeled to be queryable by time and event.

6. **No defined categories.** The system records a coordinate and a distance, but never assigns a *meaning* to it ("present", "out with permit", "out without permit"). The administrator interprets coordinates in their head, in real time, alone, under time pressure.

7. **No alert mechanism.** If a student is far from campus, no record is created of that fact. The admin sees a red dot if they happen to look at the right moment; otherwise the signal vanishes. Nothing escalates.

8. **No record of consent.** GPS data is collected on broadcast, with no audit of when, why, by whom, or with what scope of consent. This is acceptable while volumes are low and use is rare; it is unacceptable once the feature is used regularly and routinely.

9. **No timeout, no cleanup.** A "RollCall in progress" state does not formally exist. If the admin walks away mid-run, nothing closes the operation. There is no concept of "the audit ended at 09:48; here is the result".

10. **No path to scale.** Adding a class supervisor view, a comparison-over-time view, an export to PDF, a metric like "weekly attendance trend", or a parent-facing summary all require fundamentally restructuring the data first. The current data shape supports none of these.

## 2.3 What the current code does well, and must be preserved

It is important not to discard what is working. The following capabilities and patterns from the existing codebase must survive the rebuild:

- **Iron Rule of Departures.** All departure inserts go through `submit_departure`. The new audit subsystem must integrate with this — specifically, a student with an `ACTIVE` departure at the moment an audit opens should be pre-classified as `OUT_PERMIT` automatically. The audit subsystem does not modify departures; it consumes them.
- **Single-RPC discipline.** The existing pattern of "one mutation, one RPC, one transaction" works well and should be applied to audits.
- **Supabase Realtime via `postgres_changes`.** This works and remains the right primitive — but at the *table* level, not the *broadcast* level. The shift from broadcast to table is one of the central architectural moves of this plan.
- **`normalizeHebrew()` for string comparison.** Class and grade identifiers come from Hebrew sheet names and have apostrophe variants. The audit subsystem must use the same normalization helper.
- **Hebrew-only RTL UI conventions.** No i18n machinery, direct Hebrew strings, RTL via `dir="rtl"`, color tokens via CSS variables. The audit UI should match — no English fallbacks, no translation layer.
- **Dexie offline queue.** The pattern of "queue mutation in IndexedDB when offline, flush on reconnect" is solid and should be extended to audit response submissions (especially for supervisor manual marking on a flaky in-class wifi).

## 2.4 Net assessment

The current state is a working prototype of the *idea* of an audit. It is not a product. It is a single-user, in-the-moment, non-persistent screen. To convert it to a product requires reshaping the data model first, the persistence model second, and the UI third. The order is non-negotiable: changing the UI on top of the current data model would yield a prettier prototype, not a product.

---

# Part 3 — Problem Statement

## 3.1 The question the product must answer

Stated bluntly: **at any moment, who is in the yeshiva, who is out with permission, and who is unaccounted for — and how confident are we in that answer?**

Every other framing of the problem — "live dashboard", "GPS tracking", "supervisor app" — is a means to that question. If the system answers the question well, all the other framings are satisfied. If it answers the question poorly, no amount of visual polish on a dashboard rescues the product.

## 3.2 The problem expressed per stakeholder

A good problem statement is multi-perspective. Different stakeholders have different versions of the same underlying problem.

**For the rosh yeshiva (admin),** the problem is **decision latency under uncertainty**. They are asked, often by external parties (parents, security, oversight bodies), to vouch for student presence. They cannot. The current system gives them either no answer or an answer too slow to act on. They need a tool that lets them issue a directive, get a result in minutes, and trust the result.

**For the supervisor,** the problem is **invisibility and double-work**. They know their class. They already keep informal mental track of who came to morning seder. But there is no system that records what they know or surfaces what they do not. They are asked, ad hoc, to "count their boys" — by phone, by hallway conversation — without a tool. The current system makes their work invisible to the administration; the administration's audits happen above their head.

**For the student,** the problem is **fairness and dignity**. They want clear rules: when am I being tracked, why, what happens to the data, can I refuse, what are the consequences. The current system has no answer to any of those questions because the system itself has no concept of consent. Students will tolerate audit when audit is fair, predictable, and bounded.

**For the parent (not a primary user but a stakeholder),** the problem is **assurance**. They sent their son to yeshiva expecting a structured environment. They are not asking to see their son's coordinates; they are asking the yeshiva to know where their son is. A working audit subsystem is the institutional capability that satisfies parental trust.

## 3.3 The cost of inaction

If the current state persists for another year:

- Audit becomes informal, supervisors call each other, the result is "I think so" at best, no record exists.
- The single admin who pioneered RollCall becomes the institutional point of failure for the whole capability.
- The yeshiva remains unable to answer the kind of question — "where was every boy at 11:00?" — that any modern educational institution must be able to answer in five minutes.
- The data has no historical record, so trend questions ("which classes have declining morning attendance?") are forever unanswerable.

## 3.4 The cost of getting it wrong

If we ship a system that is over-built, over-tracking, or over-bureaucratic:

- Students disable location services or remove the app from their home screen entirely. The feature dies of disuse.
- The supervisor experiences the new system as more work, not less, and reverts to informal methods. The data degrades.
- The admin becomes drowned in alerts and loses the signal — *real* anomalies disappear into noise.
- Halachic-privacy concerns surface, the rosh yeshiva pulls the plug, and the rebuild costs are sunk.

The plan therefore optimizes for **trust, restraint, and one fast clear answer**, not for completeness, comprehensiveness, or live-data spectacle.

---

# Part 4 — Goals & Non-Goals

## 4.1 Goals

The goals are ordered. Earlier goals dominate later goals when they conflict.

1. **Reliable, replayable answer.** An audit, once started, yields a definitive result; the result survives refresh, network blips, and arbitrary client crashes. Replay is the single most important property.
2. **Two modes, one mental model.** Manual and location are two collection strategies. The admin learns one workflow, picks a mode, and gets a result. The UI is unified.
3. **Live, but calm.** The dashboard updates in real time, but real time does not equal flashing. Updates are smooth, restrained, and tell a clear story. Animation serves comprehension; animation never substitutes for it.
4. **Persistent history.** Every audit, every category change, every alert is queryable indefinitely. There is no "ephemeral state" anywhere in the system; if the user can see it, the database knows it.
5. **Bounded GPS.** Location is collected with consent, used for one decision, retained for a known period, and forgettable on request.
6. **Trivial for supervisor.** Marking 25 students by category takes under 90 seconds; the supervisor never sees a settings screen.
7. **Trivial for student.** Responding to a location request is two taps, never confused with a regular notification, never required.
8. **Comprehensible for admin.** A new admin can complete a successful audit within fifteen minutes of training.
9. **Operable by one person.** No external dependencies in the live flow; no second admin required; no IT support during a session.
10. **Auditable.** Six months later, a reviewer can answer: who started this session? Who marked which student? When? Why? — purely from the database.

## 4.2 Non-Goals (explicit)

These are things this plan **does not attempt** and explicitly defers. Stating them is as important as stating the goals.

- **Continuous student tracking.** GPS is collected only inside an active audit session, never as ambient telemetry. The system has no "where is X right now" capability outside of audits.
- **Parent-facing portal.** Parents do not receive audit results in this version. The infrastructure supports it but the UI does not expose it.
- **Geofencing as a discipline mechanism.** The system reports out-of-area; it does not penalize, ground, or notify-parent automatically. All consequences remain administrative discretion.
- **Multi-tenant deployment.** This is a single-yeshiva product. Architectural decisions assume one tenant. Multi-tenant is a separate project.
- **Replacing the departure subsystem.** Departures and audits are sibling features. Neither subsumes the other.
- **Replacing physical attendance taking.** A supervisor running the audit by walking the room with a phone is a feature; replacing the human is not. The product enhances the supervisor's reach, not their absence.
- **Detecting fraud.** The system does not attempt to detect spoofed GPS, mock-location apps, or students using a friend's device. These are real risks (see §16.6), but the response is administrative-policy, not technical-counter-fraud arms race.
- **Real-time chat between admin and student.** Push notification of an audit request is one-way. There is no "reply with text" affordance. If a student needs to explain, they speak to their supervisor.
- **Native mobile apps.** PWA only. No Capacitor, no React Native, no App Store distribution.
- **Offline-first audits.** Audit sessions inherently require network for realtime sync. Supervisor manual-mark submissions queue offline (existing Dexie pattern), but the *administrator's* live dashboard does not need to work offline — if the admin is offline, the audit cannot be supervised.

## 4.3 Measurable success criteria for goals

| Goal | Metric | Target | How measured |
|---|---|---|---|
| Reliable replay | % of sessions where refreshed page renders identical state | 100% | Synthetic test in CI; spot check in QA |
| Two modes one mental model | Time for new admin to complete second audit | < 50% of time for first audit | User test with 2 admins |
| Live but calm | Subjective rating from 3 reviewers | ≥ 4 / 5 ("not overwhelming") | Pre-launch review |
| Persistent history | % of past sessions retrievable from history page | 100% within 12 months, 100% within 36 months | DB query test |
| Bounded GPS | Default retention for GPS coords | 90 days, with documented deletion job | Code review + scheduled query |
| Trivial for supervisor | Median time to mark a 25-student class manually | < 90 seconds | In-session telemetry (anonymized) |
| Trivial for student | Median time from notification tap to GPS submission | < 12 seconds | Client telemetry |
| Comprehensible for admin | Successful unassisted audit on first try | 4/5 trial admins | User test |
| Operable by one person | Number of humans required during a session | 1 (the admin) | Operational definition |
| Auditable | Time to retrieve "who marked student X" for any past response | < 10 seconds | DB query test |

---

# Part 5 — Key Product Decisions

This section enumerates the **decisions** that define the product. Each decision is presented with its context, the alternatives that were considered, the recommendation, the reasoning, and the trade-offs incurred. These are not implementation details; they are the choices a senior team would defend in a design review.

## 5.1 Decision: Two modes, not three, not one

**Context.** The capture problem has many possible solutions: pure supervisor marking, pure GPS, scheduled QR scans at the door, RFID badges, photo upload of a paper attendance sheet, voice recognition. The product needs a defensible scope.

**Alternatives considered:**

- *Single mode (location only).* Rejected: students without phones, students whose phones are dead, students who refuse to share GPS, students inside a building with bad GPS reception — too many edge cases for the audit to be useful in 100% of cases. A location-only product would fail on the day it matters most.
- *Single mode (manual only).* Rejected: removes the differentiating value the request originally asks for ("real-time, live"), and offers nothing the current paper attendance sheet does not.
- *Three or more modes (QR check-in, photo upload, etc.).* Rejected on grounds of complexity. The admin must hold the mental model. Three modes is one mode too many; the user must remember which mode they picked and why. Two modes with crystal-clear use cases is the maximum.
- *Hybrid mode (location first, manual fallback within the same session).* Rejected as the *primary* mode but **accepted as a behavior within the LOCATION mode**: when GPS fails for a student, the supervisor of their class is shown that student in a "needs manual" list. This is not a third mode; it is the natural failure path of the location mode.

**Recommendation.** Two modes: `MANUAL` and `LOCATION`. Mode is chosen at session start and locked for the session's lifetime. The hybrid behavior described above is part of the LOCATION mode's specification, not a separate mode.

**Reasoning.** Two modes correspond to two real questions: *"Is everyone here right now, with the supervisors confirming?"* and *"Where is everyone right now, with the system measuring?"* These are different questions with different answers. They warrant separate flows.

**Trade-offs accepted.** The supervisor sees a slightly different UI in MANUAL vs LOCATION (they do nothing by default in LOCATION; they get a "needs manual" list when GPS fails). This is acceptable because supervisors only encounter LOCATION mode when invoked, and the difference is explained in the in-session banner.

## 5.2 Decision: Three pickable categories, two system categories — total of five

**Context.** The current proposal earlier listed six categories including a "sick / funeral" excused state. The user has since asked for three. The system also needs internal placeholders. Resolving this requires distinguishing **user-facing categorization** from **internal state**.

**Recommendation.** Five total values, of which three are user-pickable.

| Category | Pickable by user? | Meaning |
|---|---|---|
| `PENDING` | No (system default) | No answer yet recorded for this student in this session. |
| `IN_YESHIVA` | Yes | Confirmed present. Either supervisor marked, or GPS placed them in the campus bucket. |
| `OUT_PERMIT` | Yes | Out, with administrative approval. Either supervisor marked, or system saw an `ACTIVE` departure for this student. |
| `OUT_NO_PERMIT` | Yes | Out, without approval, supervisor's judgment. In LOCATION mode, also produced automatically when GPS places the student outside the campus bucket and no departure record exists. |
| `UNKNOWN` | No (system result) | We do not know. GPS denied, GPS timeout, GPS low-accuracy, no response from device, supervisor did not mark before session closed. |

**Why this shape:**

- **Three pickable is the right amount.** Five pickable options would slow the supervisor's hand. One option (a single "absent" button) would underspecify the answer. Three is a tested number for fast hand-decisions.
- **`PENDING` must exist as a system state.** Without it, the table either has nullable categories (which makes queries harder) or it lacks a notion of "the audit started but this student has not been processed yet" — which is exactly the question the dashboard most needs to answer.
- **`UNKNOWN` must exist separately from "PENDING".** They mean very different things to the admin. `PENDING` means "still working on it". `UNKNOWN` means "we tried, we failed, the answer is genuinely missing". Conflating them would hide failures.
- **No "sick / funeral / excused-other" category.** The reasoning: those are not categories of presence; they are *reasons* for absence. Mixing reasons with presence states inflates the category set without improving classification. The supervisor records reasons in the `note` field on the response; the category remains `OUT_PERMIT` (the system understands "supervisor said it's fine"). This keeps category cardinality low, which keeps the dashboard legible.

**Trade-off.** Supervisors who want a quick "he's sick" button do not get one. They must type or pick "out with permit" and add a note. We accept this in exchange for category cleanliness.

## 5.3 Decision: Only the administrator initiates audits

**Context.** An earlier draft considered allowing a class supervisor to initiate an audit for just their class. The user has since clarified: only the admin starts audits.

**Recommendation.** Confirmed. Only the admin role can call `open_audit`. Supervisors are participants, never initiators.

**Reasoning.** Authority asymmetry. The audit is an institutional act. If a supervisor could quietly audit their class, the act becomes private — a teacher's tool — rather than institutional. Institutional acts must originate from institutional authority. Also: the dashboard's value comes from cross-class visibility; a supervisor-initiated audit would only show one class, making it a worse tool for everyone including the supervisor.

**Trade-off.** Supervisors lose the ability to silently take attendance on their own using this tool. We do not consider this a meaningful loss — they already have the right to mark presence in any way they wish; the *system* simply does not perform that act.

**Future relaxation.** If demand emerges, a "supervisor self-check" mode could be added later as a parallel feature with its own data table and its own UI. It would not be an audit and would not appear in audit history.

## 5.4 Decision: At most one active session at any time, with a 24-hour upper bound

**Context.** Concurrency control is a structural decision. Two admins clicking "open" within seconds of each other is a real scenario.

**Alternatives:**

- *No concurrency control.* Multiple sessions can exist. Rejected: the supervisor and student UIs become ambiguous ("which session is this push for?"). Also rejected: a careless admin could spawn many sessions and never close them.
- *Strict mutex (the recommendation).* At most one session in `ACTIVE` status. Attempt to open a second fails with `AUDIT_ACTIVE` and offers the existing session.
- *Sliding window (only one within N minutes).* Rejected as needlessly complex; the strict mutex is simpler and provides the same protection.

**Recommendation.** Strict mutex. Database-enforced via a partial unique index on `audit_sessions ((1)) WHERE status = 'ACTIVE'`. A scheduled task auto-times-out sessions older than 24 hours to `TIMED_OUT` so a forgotten session does not block future audits forever.

**Why 24 hours.** A typical audit completes in 5–10 minutes. Allowing 24 hours gives huge safety margin for "the admin walked away and forgot" without permitting "the same session active for a week". Twenty-four hours is also a recognizable retention boundary that requires no clock-time tuning across timezones.

**Trade-off.** A second admin who legitimately wants to start a new audit while one is still nominally active must explicitly abort the existing one. This is a deliberate friction, not a bug.

**Future relaxation.** Multi-session support is a possible future feature for the multi-shift case (morning seder, afternoon seder, night seder each get their own audit). When that arrives, the partial index is replaced by a "one active per `scope_key`" index, where `scope_key` is `(shift_id, building_id)` or similar. The current architecture supports this evolution.

## 5.5 Decision: GPS distance buckets at 300 m / 1 km / 5 km

**Context.** Distance from campus is a continuous quantity (meters); the UI and the alert system need discrete categories. Where to draw the lines?

**Reasoning.** The campus is in Hebron. The relevant geographic facts:

- The yeshiva itself, plus the immediate yard, fit within a ~150 m radius. A 300 m boundary captures campus and immediate surroundings even with GPS noise (a phone reporting 250 m of accuracy is still legitimately "on campus" if the displayed point is 50 m from the center).
- The neighborhood of Hebron's Kiryat Arba area extends roughly 1 km from the yeshiva. A student walking to the local makolet for a soda is in the 300 m – 1 km bucket. They are not present, but they are not concerning.
- Hebron city center is within 5 km. A student visiting family in Hebron city is in the 1–5 km bucket. Concerning but plausibly explained.
- Beyond 5 km the student is meaningfully far. Jerusalem (35 km), Beersheba (45 km), Tel Aviv (60 km), and abroad (∞) all read the same color: red.

**Recommendation:** four buckets, named for color, with thresholds 300 m / 1 km / 5 km / ∞. Names use color rather than distance ranges to keep UI tokens short.

**Trade-off.** A student in their parents' house 500 m from campus reads as `BLUE` ("in area") even though they are home for the night. The supervisor reading this knows to check the departure record (which would show an `OUT_PERMIT`). The bucket alone is not the conclusion; the bucket plus the departure context plus the supervisor's judgment is the conclusion.

**Tunable.** If experience shows the 5 km boundary is too generous, it is one constant in one file. The recommended approach explicitly centralizes the constant in **two places only**: the SQL helper function `fn_distance_bucket` and the TypeScript helper `bucketFromMeters`. A migration that changes the SQL must accompany any change to the TS, and vice versa, enforced by code review.

## 5.6 Decision: The database is the source of truth; the client mirrors

**Context.** The single most important architectural question. Where does state live?

**Recommendation.** The database is the only source of truth. The client renders a **derived view** of the database. Mutations go through RPCs; reads come back through realtime; on any uncertainty (refresh, reconnect, app start), the client re-fetches from the database and discards local assumptions.

**Why this matters more than any other architectural choice.**

The original RollCall design treated state as "what is currently flying across the realtime channel". That is precisely why refresh wipes the screen. The new design is the opposite: realtime is a **notification mechanism** that tells the client "the database changed, re-render". The database is the canonical, persistent, authoritative store.

This decision has a cascading set of corollaries:

- Every screen is replay-safe (§13.2).
- Optimistic UI is permitted but **always reconciled** against the next realtime event or the next refresh.
- No state is kept "only in the admin's tab" — if the admin closes the tab and reopens it, identical state.
- Two admins, two devices, one session — see identical state to within one network round-trip.
- Realtime is an optimization; if it fails, polling at 30-second intervals provides a degraded-but-correct fallback (§17.3).

**Trade-off.** More database writes than a broadcast model. Negligible in cost at 381 students × ~5 audits per week.

## 5.7 Decision: Sessions are persisted forever; alerts and logs likewise; raw GPS coordinates expire

**Context.** Privacy and storage both demand a deliberate retention policy.

**Recommendation.**

| Data | Retention | Reason |
|---|---|---|
| `audit_sessions` row | Forever | Tiny; institutional record; never PII. |
| `audit_responses` row (without raw GPS) | Forever | Small; the count, by class, by category, by date is the historical record. |
| `audit_responses.gps_lat`, `gps_lng`, `gps_accuracy_m` | **90 days, then nulled** | Raw coordinates are sensitive PII. The bucket (`GREEN`/`BLUE`/`ORANGE`/`RED`) and the distance-in-meters are retained because they are the analytical signal; the actual coordinates are not. |
| `audit_alerts` row | Forever | Institutional record of an event. |
| `audit_response_log` entries | Forever | Audit trail. |
| `audit_push_log` entries | 30 days | Debugging only; no value at 31 days. |

The 90-day GPS nulling is implemented as a scheduled `UPDATE` in pg_cron, not a delete, so the row keeps its bucket and distance for analytics but loses the precise coordinates. The implementation appears in the implementation reference but the *policy* is decided here.

**Why this asymmetry.** "Was this student off-campus on May 16?" is a legitimate question to answer in October. "Where exactly was this student on May 16?" is not. The retention policy encodes this asymmetry into the data model. Halachic-privacy reviewers, when consulted, agree (see §16.5).

**Trade-off.** Forensic reconstruction of an old incident loses precise coordinates after 90 days. We consider this an acceptable cost for the privacy benefit.

## 5.8 Decision: Manual mode is the default; LOCATION is opt-in per session

**Context.** Which mode does the admin land on when they open the "new audit" flow?

**Recommendation.** The mode picker is a two-card screen with neither pre-selected. The admin must consciously pick. The UI explains both in one line each. Defaulting to LOCATION would normalize tracking; defaulting to MANUAL would imply the LOCATION mode is suspect or experimental. Neither default sends the right message.

**Trade-off.** One extra click per audit. Acceptable.

## 5.9 Decision: Hebrew terminology

**Context.** Terminology in a Hebrew UI matters more than the team realizes. Words carry institutional implications.

**Recommendation.** The following Hebrew terms are canonical for the product. Synonyms are explicitly rejected.

| English internal term | Hebrew UI term | Rejected alternatives | Why |
|---|---|---|---|
| Audit | בקרה / ביקורת | מפקד (military connotation), בדיקה (too generic), נוכחות (means "presence" not "the process") | "ביקורת" is the existing term in CLAUDE.md and is the rabbinic-yeshiva vocabulary. |
| Audit session | סשן בקרה | ריצה, מפגש | "סשן" is widely understood in Israeli tech-product Hebrew. |
| Manual mode | מצב מהיר | מצב ידני | "מהיר" (fast) frames it positively; "ידני" (manual) sounds primitive. |
| Location mode | מצב מיקום | מצב GPS | "GPS" leaks technology jargon into the UI. |
| Marker | סימן / סומן ע"י | מחמיר, מבצע | Reflects the action, not the actor. |
| In yeshiva | נוכח | בישיבה (correct but verbose), כאן | "נוכח" is one word and a known token. |
| Out with permit | בחוץ עם אישור | יציאה מאושרת | "עם אישור" is the parallel construction to "בלי אישור" — readability priority. |
| Out without permit | בחוץ ללא אישור | בלי רשות | "ללא אישור" matches the formal register. |
| Unknown | לא ידוע | לא נמסר, לא נענה | "לא ידוע" is honest and short. |
| Pending | ממתין | בהמתנה | "ממתין" is one word. |
| Alert | אזעקה | התראה, פעמון | "אזעקה" carries appropriate gravity for the `RED` distance bucket. |
| Live dashboard | מסך הבקרה החי | לוח מחוונים | "לוח מחוונים" sounds like a car. |

This is a settled list. Changes to it require revising this document, not a side conversation.

## 5.10 Decision: Realtime, but with explicit polling fallback

**Context.** Supabase Realtime is a websocket connection. It has been reliable historically but is not a guarantee.

**Recommendation.** Every dashboard subscribes to `postgres_changes` on the relevant audit tables. Independently, every dashboard runs a poll-fallback timer: if no realtime event has been observed in 30 seconds *while a session is active*, force a re-fetch via `get_active_audit`. This guarantees that even if realtime silently dies, the dashboard cannot stay stale for more than ~30 seconds.

**Trade-off.** A small steady-state load on the database from polls during quiet periods. Negligible.

## 5.11 Decision: One audit dashboard, four views; no "tabs of tabs"

**Context.** It is tempting to add a Settings tab, a History tab, a Compare tab, a Stats tab to the live dashboard. Resist.

**Recommendation.** During an `ACTIVE` session, the dashboard has exactly four switchable views and no nested tabs:

1. **Grid** — one card per class, ordered by attention-need.
2. **Heatmap** — same data, compact visualization for the rosh yeshiva to take in at a glance.
3. **Map** — geographic view, location mode only, hidden in manual mode.
4. **Feed** — chronological stream of actions.

The KPI strip is **persistent** above all four views; it never moves and never disappears.

The alert list and recent-activity widget appear **below** the four views, always visible if the screen height allows. They are not in the tab system.

Everything else — comparing past sessions, exporting, settings — happens **outside the live dashboard**, on separate routes.

**Why this restraint matters.** During a session, the admin's attention is at a premium. Adding any UI control that is not directly useful in the next ninety seconds is a design failure. Every removed control is a kindness to the admin.

## 5.12 Decision: Push notifications fan out via Edge Function, not from the client

**Context.** When an audit opens in LOCATION mode, the server needs to push N notifications to N students. Push from the client would require the admin's browser to stay open and would scale poorly.

**Recommendation.** A server-side Edge Function (`send-audit-push`) fans out the notifications. It is invoked synchronously by the `open_audit` RPC's caller (the admin's frontend) but the Edge Function batches and rate-limits the sends. The admin sees a single "opening session…" spinner that resolves when the Edge Function reports completion.

**Trade-off.** Slightly longer "open audit" call (1–3 s instead of <1 s). Acceptable. The alternative is N parallel network calls from the admin's browser, which would (a) require their browser to stay foregrounded, (b) be visible in DevTools to anyone curious, (c) consume their battery, and (d) hit rate limits less gracefully.

## 5.13 Decision: Projection mode is included but not promoted

**Context.** The user has asked for a "live data dashboard for the manager... in a meeting, all the data jumping onto the screen". This is the projection-mode use case.

**Recommendation.** Implement projection mode but do not feature it on first launch. Add a discreet TV-icon button in the top-right of the live dashboard. The admin discovers it when they need it. Projection mode goes fullscreen, increases font scale by ~1.8×, rotates the four views on a 10-second interval, and disables interactive controls.

**Trade-off.** Projection mode adds engineering and design surface area. We include it because the user explicitly wants it and because it has institutional value (during a vaad meeting with the rosh yeshiva). We avoid promoting it because the typical use is a phone in the admin's hand, not a wall projector.

## 5.14 Decision: No native app

**Context.** PWA versus Capacitor versus React Native.

**Recommendation.** PWA only. iOS Safari supports Web Push from 16.4+ via "Add to Home Screen". Android Chrome supports it natively. The yeshiva's student body is overwhelmingly Android, with a non-trivial iPhone minority. PWA reaches both populations.

**Trade-off.** iOS users must add the app to their home screen before push works. This is a known onboarding friction, not a deal-breaker, and is communicated in onboarding text. Building a native app to avoid this friction is an order of magnitude more engineering work than the friction is worth.

---

# Part 6 — User Roles and Personas

This section is not a list of permissions (those appear in §16). It is the human picture of who uses the product and how they live with it.

## 6.1 Persona — The administrator

**Working name:** Rav Yair, 47, *menahel* of the yeshiva.

**Daily reality.** He has three meetings a day, twenty parents to call back, two halachic shaylas in his queue, and a phone that beeps for twenty different reasons. He opens his phone roughly two hundred times a day and is competent with smartphones but not enamored of technology. He uses WhatsApp, Google Calendar, and a sheet for the budget. He learned the current attendance app because someone built it for him, not because he likes apps.

**Audit context.** He runs an audit roughly three times a week: after morning seder, after afternoon seder, before evening seder during particularly important weeks. He runs it because parents call ("is my son there?") or because security calls ("we need a count") or because the rosh yeshiva calls ("how many boys are out today?"). When he runs an audit, the typical situation is *he is in motion*: walking, just sat down in a meeting, between conversations. He almost never runs an audit while sitting alone with a laptop.

**What the product must give him.** A button that he hits while walking. A dashboard he can glance at on a phone, in a hallway. A clear answer in five minutes that he can repeat verbally on the phone. Confidence that the supervisors are doing their job. No surprises. No bugs at 11pm.

**What will kill the product for him.** Five-minute load times. Permissions he doesn't understand. Categories that confuse him. Push notifications that lie. Bugs that make him look foolish in front of the rosh yeshiva.

**Implication for the plan.** The admin's flow must be **finger-friendly**, **single-thumb-operable**, **information-dense without being cluttered**, and **fail-loud** (when something is wrong, he must know immediately, not five minutes later).

## 6.2 Persona — The class supervisor

**Working name:** Rav Boaz, 31, supervisor of *shi'ur bet* — class of 23 boys.

**Daily reality.** He teaches three of his class's six daily sessions and is in the building for the rest. He knows every boy in his class personally: their gemara level, their family situation, their slichos. He does not naturally think of himself as a "user of an app". He logs into the system because he is asked to.

**Audit context.** He sees the supervisor screen perhaps three times a week. When he sees it, it is because an audit is active. He must mark his 23 boys quickly — ideally before his next chavruta starts in eleven minutes. He may be sitting in the beit midrash, in his office, in the hallway. He may be on a phone with bad connectivity. He may be in a basement with no signal at all.

**What the product must give him.** A list of his 23 boys, in his class only, with three buttons per boy. Updates from other supervisors don't concern him. Updates from the admin don't concern him. He needs to mark his class and walk away.

**What will kill the product for him.** Showing him other classes. Asking him to choose a mode. Asking him to log in twice. Modal dialogs in the middle of marking. Anything that takes more than 90 seconds for 23 students.

**Implication for the plan.** The supervisor's view is **a single screen, scoped to one class, with three-button-per-student ergonomics**. It is not a smaller version of the admin's dashboard; it is a different product.

## 6.3 Persona — The student

**Working name:** Aharon, 18, second-year talmid.

**Daily reality.** He has an Android phone — a hand-me-down — with limited data, on a family plan. The phone is in his pocket twelve hours a day and in airplane mode during seder if he is disciplined, in his backpack if he is not. He uses WhatsApp, has an Instagram account he doesn't use much, and plays a strategy game on Friday afternoons.

**Audit context.** He encounters the audit when his phone buzzes with a notification. He recognizes the yeshiva app icon. He taps. He sees a screen asking for his location. He taps "approve". He goes back to his gemara. He encounters this maybe once or twice a week.

**What the product must give him.** A notification that is unambiguously from the yeshiva. A consent screen that he understands. Two-tap completion. Reassurance that the data is bounded.

**What will kill the product for him.** Frequent notifications. Notifications that look like spam. Vague consent. Slow response. Battery drain. Mockery from friends who got "tracked".

**Implication for the plan.** The student's interaction is **rare, fast, bounded, dignified, and explained**. The notification language and the consent screen are first-class design surfaces, not afterthoughts.

## 6.4 Edge personas (acknowledged, not centered)

- **The rosh yeshiva.** Views audit results occasionally in passing on the admin's phone. Not a system user. The dashboard is designed to be **shoulder-readable** in a 5-second over-the-shoulder glance — this is the projection-mode use case in miniature.
- **The parent.** Not a system user, but a context for trust. The product must not embarrass the yeshiva if a parent asks "what does this app actually do".
- **The security guard at the gate.** Not a system user, but a beneficiary. A working audit can answer their "how many boys are inside the perimeter right now?" question.

These personas are acknowledged so that the team does not accidentally design *for* them at the cost of the three primary personas.

## 6.5 Role-to-permission matrix

Permissions are the formal version of the personas. See §16 for security context.

| Capability | Admin | Supervisor | Student | Anonymous |
|---|---|---|---|---|
| Open audit session | ✅ | ❌ | ❌ | ❌ |
| Close audit session | ✅ | ❌ | ❌ | ❌ |
| Abort audit session | ✅ | ❌ | ❌ | ❌ |
| Override category for any student | ✅ | Class only | ❌ | ❌ |
| Mark category in active session | ✅ | Class only | Self only (GPS submission) | ❌ |
| View live dashboard (all classes) | ✅ | ❌ | ❌ | ❌ |
| View supervisor panel (own class) | ✅ | ✅ | ❌ | ❌ |
| Receive audit push | ✅ (open events) | ✅ (open events) | ✅ (location mode) | ❌ |
| Acknowledge alert | ✅ | ❌ | ❌ | ❌ |
| View audit history | ✅ | Own class only | ❌ | ❌ |
| Export audit data | ✅ | ❌ | ❌ | ❌ |
| View student locations on map | ✅ | ❌ | ❌ | ❌ |
| Initiate location collection | ✅ (within audit) | ❌ | Self only (within audit) | ❌ |

---

# Part 7 — Use Cases

Twelve concrete, end-to-end scenarios. Each is a paragraph, not a checklist. They are designed to stress-test the product: if every scenario works, the product is real; if any scenario doesn't, the design has a gap.

**UC-1 — Routine morning audit, manual.** It is 09:15, twenty minutes into morning seder. The admin opens his phone, taps "audit", picks "manual", selects all 16 classes, taps "open". Sixteen push notifications fan out to the supervisors. Each supervisor sees a banner: "audit active — mark your class". Over the next two minutes, supervisors mark, the admin's dashboard fills in green. At 09:18 the class progress bars are 100% green except one class showing 21/23 marked. The admin opens that class's drawer, sees two pending students, taps the supervisor's name to call them. Two seconds later the supervisor finishes marking. The admin taps "close audit", types "morning seder", taps "save". The summary screen shows 374 present, 7 with permit, 0 without. The whole audit took 4 minutes 12 seconds.

**UC-2 — Routine audit, location mode.** Same situation, but the admin picks "location". Push notifications fan out to all 381 students. Over the next two minutes, 297 students approve, GPS arrives, dots appear on the map. Eight students appear in the `BLUE` bucket (≤1 km from campus, not in the building); the admin sees they have departures, the dashboard auto-classifies them as `OUT_PERMIT`. Three students appear in `RED` — one in Tel Aviv, two in Jerusalem. Alerts fire. The admin sees the alert modal, recognizes one as a student on family leave (departure record confirms), acknowledges. The other two have no departure record and the admin makes phone calls. By 09:20, 376 of 381 students have responded. The remaining 5 are `UNKNOWN`. The admin pushes a reminder to those 5 supervisors; within 90 seconds the supervisors confirm three of them are in the building (manual override to `IN_YESHIVA`) and two are genuinely missing phones. The admin closes the audit. Total time: 6 minutes 40 seconds.

**UC-3 — Admin refreshes mid-audit.** Two minutes into UC-2, the admin's phone runs out of battery. He plugs in. He reopens the app. The login screen loads. He logs in. He lands on a banner: "ביקורת פעילה כעת — חזור לסשן". He taps. The live dashboard renders. KPI strip shows the correct numbers. The map shows the dots that were there before. The activity feed shows the events he missed. No regression.

**UC-4 — Two admins, same session.** Rav Yair opens an audit from his phone. The deputy admin opens her tablet at the same moment, sees the active session, taps it. Both screens now show identical data. The deputy marks a student manually as `IN_YESHIVA`. Rav Yair sees the change appear on his screen within 1 second. The activity feed shows "deputy admin marked Avi Cohen as נוכח". No conflict, no race.

**UC-5 — Supervisor on flaky wifi.** Rav Boaz is in the basement beit midrash where wifi is poor. He taps "נוכח" on a student. The button shows a spinner for 4 seconds, then resolves. He continues marking. The 5th student he marks takes 11 seconds to confirm because wifi dropped entirely. The mutation queues in IndexedDB. Wifi returns. The mutation flushes. The dashboard catches up. Rav Boaz never sees an error message; the system absorbs the friction.

**UC-6 — Student denies GPS.** Aharon receives the audit push. He taps. The consent screen appears: "ההנהלה מבקשת לוודא שאתה בישיבה. שלח מיקום או דחה." He has just sat down in mussar seder and doesn't want to fiddle with his phone. He taps "אני לא יכול עכשיו". The system records his response as `gpsStatus=DENIED` and `category=UNKNOWN`. On the admin's dashboard, Aharon appears in the `UNKNOWN` row of his class card. The supervisor of his class is notified that there are unmarked students in his class needing manual attention. The supervisor walks two rooms over, sees Aharon, taps "נוכח" on his phone, the dashboard updates.

**UC-7 — Critical alert, real incident.** Mid-audit, a student appears in `RED` at 47 km from campus. Alert fires. Admin's modal pops. The modal shows the student's name, his class, the distance, and his phone number from the student record. The admin calls. The student answers: he is at home in Beit Shemesh because of a family event the yeshiva wasn't informed of. The admin marks him as `OUT_PERMIT` with a note ("family event, informed retroactively"), acknowledges the alert. The alert is now resolved but the *event* is recorded forever in the audit log.

**UC-8 — Critical alert, false alarm.** Student appears at 6 km. Alert fires as `MEDIUM`. Admin checks: the student's recorded GPS accuracy is 8 km. This is a low-confidence reading from a phone with limited satellite visibility (likely inside a building with metal walls). The system has correctly tagged the response as `LOW_ACCURACY`. The admin marks the student manually as `IN_YESHIVA` based on the supervisor's confirmation. The alert is acknowledged with note "low-accuracy reading; supervisor confirms present". Future analysis of false-alarm rate can query for this combination.

**UC-9 — Audit forgotten overnight.** Admin opens an audit at 22:00 to check the dormitories. He marks five classes, then his daughter calls. He puts the phone down. The next morning at 09:00 he opens the app — the session is now in `TIMED_OUT` status (24-hour cron). The dashboard shows the data he had collected, the unmarked students as `UNKNOWN`, and a clear status banner: "סשן זה הסתיים אוטומטית בשל אי-פעילות". No data was lost; the session was simply closed by the system at the 24-hour boundary.

**UC-10 — Admin compares two audits.** A week later, in a vaad meeting, the rosh yeshiva asks "are mornings better than evenings?". The admin opens audit history, ticks Tuesday-morning and Tuesday-evening sessions, taps "compare". A side-by-side appears: present count, by-class breakdown, alert count. The data lives forever in the database; the comparison is a query, not a screenshot.

**UC-11 — A new supervisor joins mid-year.** A new madrich is appointed for *shi'ur dalet*. The admin updates the Google Sheet to associate the new madrich with the class; the sync happens; the admin assigns a class code. On the next audit, the new madrich receives the supervisor push, sees his class panel, marks his students. No code change required.

**UC-12 — Halachic-privacy challenge from a parent.** A parent calls the rosh yeshiva: "why does the app track my son?". The rosh yeshiva turns to the admin. The admin opens a "privacy" page (an admin-only diagnostic page) that shows: this parent's son had GPS submitted in 3 audits in the past 30 days; in each case, only the distance bucket and an approximate distance-in-meters is retained; precise coordinates from older audits have been nulled by the retention job. The admin can produce this report from the UI directly, without database access. The rosh yeshiva can pass it to the parent in writing.

These twelve scenarios are the **acceptance fiction**: when the product handles all twelve fluently, it ships.

---

# Part 8 — Ideal User Experience

## 8.1 The mental model

A user-experience succeeds when the user can describe it to a friend in one sentence. The target sentences for each role:

- **Admin:** *"I tap a button and within five minutes I know exactly who's where."*
- **Supervisor:** *"When my phone buzzes, I open the app, mark my boys, done."*
- **Student:** *"Once or twice a week the yeshiva asks where I am; I tap yes or no."*

Every design decision must serve one of those three sentences. If a design choice does not, it is decoration.

## 8.2 The admin's journey, narrated

Walking down the hallway, the admin opens his phone. The home screen of the admin app shows a small "Audit" tile — orange if a session is active, neutral if not. He taps it. He sees a screen with two large cards: "Manual" and "Location". One sentence under each. He taps "Manual". A class selector appears — pre-checked with all 16 classes. He doesn't change it. He taps "Open". A two-second spinner; pushes fan out. The live dashboard loads. He sees the KPI strip, large numbers; six tiles each showing a category count. Below, a grid of class cards. He tucks the phone in his shirt pocket as he turns a corner. Thirty seconds later he glances at the phone; the KPI numbers have moved, several class cards have turned green. He keeps walking. By the time he reaches his office, all but one class card is green. He sits down. He taps the orange card; a drawer slides in showing 21/23 marked with two students pending. He taps the supervisor name to make a call. The supervisor — having seen the same data on his own screen — was already calling around the room. Ninety seconds later, the dashboard is fully green. The admin taps "Close". He types one word: "בוקר". He taps "Save". The summary appears. He closes the app.

What made this experience good:

- He never read instructions.
- He never typed anything until the very end, and then just one word.
- He always saw progress, never a loading spinner without context.
- The most important number — "how many present" — was always on screen, large.
- The system did not surprise him.

## 8.3 The supervisor's journey, narrated

In the beit midrash, between seder and break, Rav Boaz's phone vibrates. He pulls it out. Lock screen: "בקרה פעילה — סמן את הכיתה". He swipes. The app opens directly on the supervisor panel for his class — no menu navigation, no class picker. He sees a list of his 23 boys, three buttons per row: green (נוכח), blue (עם אישור), red (ללא אישור). He starts at the top, taps green-green-green-green-green, scrolls, taps green-green-blue (a boy whose departure is approved), green-green. By the 16th boy, he's marked 80% of the class. He recognizes one boy isn't in the room. He scrolls to that boy's row, taps "ללא אישור", taps the note field, types "לא נראה בסדר". By the 23rd boy he is done. The panel shows "סימנת את כולם — תודה!". He locks the phone and returns to learning.

What made this experience good:

- The push notification opened directly to the right screen.
- His class was already filtered for him.
- Three buttons per row, large enough for thumb.
- The note field was optional, not required.
- Completion was confirmed without ceremony.

## 8.4 The student's journey, narrated

Aharon's phone buzzes. He glances. Notification: "בקרת מיקום מהירה — לחץ לאישור". He recognizes the yeshiva app icon. He taps. The app opens to a bottom sheet:

> בקרת מיקום מהירה
>
> ההנהלה מבקשת לוודא שאתה בישיבה.
> המיקום נשלח פעם אחת, נשמר 90 יום, ולא נחשף לחברים.
>
> [אשר ושלח מיקום] [אני לא יכול]

He taps "אשר". A spinner appears for two seconds. Then: "✓ נשלח, תודה". The sheet disappears. He returns to his gemara.

What made this experience good:

- One screen, no scrolling.
- Plain language about retention.
- A clear refusal path that doesn't penalize him.
- Two seconds of friction, then he is done.

## 8.5 The five things a great audit UX never does

1. **It never makes the admin reload to see new data.** Realtime is invisible plumbing.
2. **It never shows the supervisor data from a class that isn't theirs.** Scope is total.
3. **It never asks the student for permission for something it isn't doing.** Consent must be specific.
4. **It never shows a loading spinner without telling the user what it is loading.** Spinners with no label feel broken.
5. **It never displays a category color without a label.** Color alone is not communication.

---

# Part 9 — Design Principles

This section names the design rules. They are not stylistic preferences. They are constraints.

## 9.1 Visual hierarchy

The audit dashboard's hierarchy descends through three tiers:

- **Tier 1 — The Answer.** The KPI strip. Six big numbers. They are the single most important visual elements on the page. They are 3× the type size of body text. They never scroll out of view. They animate on change.
- **Tier 2 — The Texture.** The grid, heatmap, map, or feed view. These show *how* the Tier 1 numbers were reached. They are dense but readable, organized by class, and convey at a glance which classes need attention.
- **Tier 3 — The Detail.** Alerts, activity feed, individual response drawers. These appear when called for, not by default. They are smaller, denser, and provide forensic detail.

The hierarchy must be visible on a 375-pixel-wide mobile viewport without scrolling past Tier 1.

## 9.2 Layout system

A 12-column grid on desktop (1024 px and above). On tablet (768–1023 px), 8-column. On mobile (under 768 px), single-column with horizontal scroll only for tabular data. Gutters are 16 px on mobile, 24 px on tablet, 32 px on desktop. The grid is enforced via Tailwind's container utilities; no ad-hoc magic numbers in components.

The KPI strip is always full width. It is a single row of 6 cards on desktop and tablet, and a 2-column × 3-row grid on mobile (preserving readability of large numbers).

The class grid is responsive: 4 columns on desktop, 3 on tablet, 2 on small tablet, 1 on mobile. Each class card has a fixed aspect ratio (4:3) regardless of viewport, so layouts don't reflow as data arrives.

## 9.3 Information density

The product targets a **medium-high** density: enough information to be useful at a glance, but not so much that scanning is required. The KPI strip shows six categories; not seventeen. The class card shows class name, progress, four small per-category counts; not a sparkline of historical trends. Density is achieved by *removing* information, not by miniaturizing it.

## 9.4 Typography

Hebrew typography is its own discipline; the team should not assume Latin-script defaults transfer.

- **Family.** Heebo as primary (free, well-balanced for Hebrew and Latin, available on Google Fonts). Frank Ruhl Libre as a possible secondary for headers (more traditional, slower to read, used sparingly).
- **Sizing.** Body text 16 px. Card titles 18 px. KPI numbers 48 px on desktop, 36 px on mobile, **tabular-nums** enforced so numbers don't jitter as they animate.
- **Weight.** Body regular (400). Card titles semibold (600). KPI numbers black (900). Avoid italics — Hebrew italics look like badly-printed text.
- **Line height.** Hebrew needs less line-height than English. Body at 1.4, headlines at 1.2.
- **Letter spacing.** None. Hebrew does not benefit from tracking.
- **Numbers.** Always rendered in an `<span dir="ltr">` enclave so they read left-to-right even when surrounded by Hebrew. Time formats use 24-hour. Distance in meters is rendered as "218m" or "1.2 ק"מ".
- **Mixed text.** "9 boys are at 3.2 km" — handle with `unicode-bidi: plaintext` on the container so each token resolves direction correctly.

## 9.5 Color system — semantic, not decorative

Colors carry meaning. The audit color set is purpose-built and minimal.

| Token | Hex (light) | Meaning |
|---|---|---|
| `--audit-green` | `#10b981` | Present, on campus, success |
| `--audit-blue` | `#3b82f6` | Out with permit, in immediate area |
| `--audit-orange` | `#f59e0b` | In Hebron metro area, low-priority concern |
| `--audit-red` | `#ef4444` | Out without permit, OR out-of-area distance, OR critical alert |
| `--audit-amber` | `#fbbf24` | Unknown — failed to determine |
| `--audit-gray` | `#6b7280` | Pending — no answer yet |

Each token has a dark-mode counterpart (lower saturation, higher luminance), a pale-background variant (10% opacity equivalent), and a border variant (full saturation).

The product introduces no other colors for status. This list is closed. New product situations that need a color use a category from this list; if the situation doesn't fit any category, the category set is reconsidered, not extended.

## 9.6 Iconography

Icons accompany categories and never substitute for the category label. The icon set is from `lucide-react`. Mapping:

- `IN_YESHIVA` — Check
- `OUT_PERMIT` — LogOut
- `OUT_NO_PERMIT` — AlertOctagon
- `UNKNOWN` — HelpCircle
- `PENDING` — Clock
- Alert (any) — AlertTriangle
- Map / location — MapPin
- Audit-mode manual — Zap
- Audit-mode location — MapPin (deliberate reuse — the location mode *is* the map)
- Projection mode — Monitor

## 9.7 Motion

Motion principles, in order of priority:

1. **Motion reveals causality.** A new response arriving in the activity feed slides in from the top because that mirrors the flow of time. A class card whose progress increased animates its progress bar so the eye tracks the change. Motion that doesn't communicate causality (e.g. random card jitter on hover) is removed.
2. **Motion stays under 600 ms.** Longer animations feel slow. Shorter ones feel jittery.
3. **Motion uses ease-out, not ease-in-out.** Things settle into place; they don't drift.
4. **One thing at a time.** Two simultaneous animations compete for attention. The dashboard only animates one element per "tick" — the element most relevant to the change.
5. **`prefers-reduced-motion` is honored.** When set, all motion drops to fades only, no slides, no scales.
6. **The alert modal is the exception.** It uses a pulse animation that *is* the design — the institutional gravitas of the alert depends on the pulse. It does not honor reduced-motion (but the pulse is reduced to a single half-pulse for that case).

## 9.8 State design — empty, loading, error, success

For each major screen, all four states must be explicitly designed. **The states are part of the product, not after-thoughts.**

**Empty.** The landing page when no audits have ever been run shows a clipboard icon, a one-line invitation ("ביקורת ראשונה נמצאת מעבר לכפתור הזה"), and a single large "פתח ביקורת" button. Not a list of zero items.

**Loading.** Loading states use **skeleton screens**, not centered spinners. The skeleton mirrors the eventual layout: a gray bar where the KPI strip will be, a grid of gray cards where class cards will be. The eye prepares for what's about to arrive; the page does not jolt when content lands.

**Error.** Errors are categorized: network errors (recoverable, "נסה שוב"), permission errors (informational, no retry), data errors (escalate, "פנה למנהל"). Each category has a designed component with appropriate iconography and clear next action.

**Success.** Successes are quiet. A toast on "audit closed" — green, three seconds, dismissable. No confetti. No celebratory modal. The audit completing successfully is the expected outcome; making it a celebration would imply the product expected failure.

## 9.9 Live-data design — making realtime calm

The animation pattern for arriving data is deliberate:

- Counters in the KPI strip use **CountUp** — they tick smoothly from old value to new over ~600 ms. They do not flip-card or scramble.
- Activity feed items slide in from the top in 200 ms; the rest of the feed shifts down in 300 ms. The most recent item carries a subtle highlight that fades over 2 seconds.
- Class cards re-sort gracefully using a Framer Motion layout animation. A card moving from position 7 to position 1 does so over 400 ms; the cards in between shift to make room.
- The map plays a single dot-drop animation when a new point appears, then settles into a steady-state pulse only for `RED` dots. Steady-state pulsing on every dot would create cognitive load; pulsing only on critical dots creates a *signal*.

The aggregate effect should feel like **water filling a glass**, not like **a slot machine**.

## 9.10 Density and whitespace

Whitespace is not empty; it is structure. The product reserves whitespace for:

- The vertical space above and below the KPI strip (24 px) — visual confirmation that the strip is its own region.
- The internal padding of cards (16 px) — readable spacing from edges.
- The gap between cards in the grid (12 px) — readable separation without visual fragmentation.

Whitespace is **not** used to give every element generous breathing room. The product is information-dense by intent. Generous whitespace at the cost of fitting one class card per screen on mobile is a design regression.

## 9.11 Accessibility

WCAG 2.1 AA is the minimum target. Specific requirements appear in §18. Three accessibility principles shape design:

- **Color is never the only signal.** Every colored chip has a label and an icon. Color-blind users see everything.
- **Focus order matches reading order.** Hebrew RTL means focus moves right-to-left along a row, then to the next row. Test with Tab key, not just mouse.
- **Live regions are polite, not assertive.** Realtime updates use `aria-live="polite"` so screen readers announce them at sentence boundaries, not mid-word.

## 9.12 What the design explicitly avoids

- **Gradient backgrounds with movement.** Gimmick.
- **Glassmorphism / blur effects.** Bad on low-end Android.
- **Particle effects.** Distracting; communicate nothing.
- **Achievement-style badges or streaks.** This is not a game.
- **Avatars.** No student photos in the UI. Names and class identifiers suffice.
- **Dark patterns of any kind.** The "I cannot now" student refusal must be exactly as prominent as "approve".

---

# Part 10 — System Architecture

## 10.1 Architecture goals

The architecture is judged on five axes:

1. **Replay-safety.** Any screen, after any disturbance, renders correct state on reload.
2. **Single source of truth.** No state lives only on the client.
3. **Concurrency-correctness.** Two admins, two devices, identical view.
4. **Failure isolation.** Realtime down does not make the product unusable; just less live.
5. **Operational simplicity.** One team can run it.

## 10.2 The architecture in one sentence

The system is a **server-state-of-the-truth, RPC-driven, realtime-pushed, persistent-history** subsystem inside the existing Supabase + React + Vite + Vercel stack.

## 10.3 Layer breakdown

```
┌───────────────────────────────────────────────────────────────────┐
│ Layer 7 — Browser UI (React, RTL, Tailwind, framer-motion)        │
│   - Admin dashboard, supervisor panel, student sheet               │
│   - Replay-safe, idempotent on refresh                             │
├───────────────────────────────────────────────────────────────────┤
│ Layer 6 — Browser State (Zustand)                                  │
│   - Mirrors DB state, never overrides it                           │
│   - Optimistic UI permitted; reconciled with realtime events       │
│   - One persisted store (audit-ui-store) for tab/preferences only  │
├───────────────────────────────────────────────────────────────────┤
│ Layer 5 — Client Realtime (Supabase JS)                            │
│   - postgres_changes subscription per active session               │
│   - Polling fallback at 30s when no events seen                    │
├───────────────────────────────────────────────────────────────────┤
│ Layer 4 — Client API Wrapper                                       │
│   - Thin module wrapping supabase.rpc(...) calls                   │
│   - Converts snake_case rows to camelCase types at the boundary    │
├───────────────────────────────────────────────────────────────────┤
│ Layer 3 — Supabase Edge Functions                                  │
│   - send-audit-push: fan out web push to N students                │
│   - notify-audit-alert: optional Slack/email on CRITICAL           │
├───────────────────────────────────────────────────────────────────┤
│ Layer 2 — Postgres RPCs (the contract)                             │
│   - open_audit, submit_audit_response, close_audit, abort_audit    │
│   - get_active_audit, get_audit_full, list_past_audits             │
│   - acknowledge_audit_alert, compute_audit_kpis                    │
│   - tick_audit_timeout (cron, every 5 minutes)                     │
├───────────────────────────────────────────────────────────────────┤
│ Layer 1 — Postgres Tables                                          │
│   - audit_sessions, audit_responses, audit_alerts                  │
│   - audit_response_log, audit_push_log                             │
│   - Realtime publication includes the first three                  │
└───────────────────────────────────────────────────────────────────┘
```

The layering is strict. Layer 7 talks only to Layer 6. Layer 6 talks only to Layers 4 and 5. Layer 4 talks only to Layer 2 (and to Layer 3 for push). Layer 2 mutates Layer 1. Skipping layers — e.g. a React component directly calling `supabase.rpc` — is a code-review block.

## 10.4 Why this architecture

**Why RPCs instead of REST endpoints.** Supabase exposes RPCs natively, with type-safe generated clients. Building REST endpoints would require a separate service. The complexity isn't warranted; RPCs are sufficient.

**Why one RPC per logical operation, atomic.** Each RPC wraps its mutation in a transaction. `open_audit` creates the session row *and* the 381 response rows in one transaction; either all of it commits or none does. This makes "partial state" — a session with no responses — impossible.

**Why a single active session mutex enforced at the DB level.** Application-level mutex would require a distributed lock; with one Postgres instance, the simplest correct mechanism is a partial unique index. Application code cannot bypass it.

**Why realtime via postgres_changes, not a custom broadcast channel.** Because postgres_changes is rooted in the table. Refreshing the page does not lose subscription state. Two admins watching the same session see the same events. Broadcast channels are subscriber-local; postgres_changes is table-scoped. The choice is structural.

**Why Edge Functions for push and not from the client.** Privacy of VAPID keys, rate limiting, scalability, and not requiring the admin's browser to stay open during fan-out. See §5.12.

**Why no separate cache layer.** Premature optimization. Postgres can serve `get_active_audit` to one admin every 30 seconds without breaking a sweat. If the audit feature ever reaches 100 concurrent admins, a Redis cache becomes worthwhile; not before.

## 10.5 Data flow — happy path

1. **Open.** Admin's browser calls `open_audit(MANUAL, [16 classes], 'ADMIN', settings, notes)`. RPC executes: validates input, acquires advisory lock, inserts session row, bulk-inserts 381 response rows (pre-classifying any with active departures as `OUT_PERMIT`). Returns `{session_id, total_students, mode, started_at}`. Browser navigates to `/admin/audit/<id>/live`.
2. **Subscribe.** Live page mounts. Calls `get_active_audit` for full initial state. Receives session + 381 responses + 0 alerts + KPIs. Renders. Concurrently, subscribes to `postgres_changes` on `audit_responses`, `audit_alerts`, `audit_sessions` filtered by session_id.
3. **Fan out.** Browser invokes `send-audit-push` Edge Function with session_id and target. Edge Function queries `students` for push_tokens, sends Web Push to each, logs successes/failures into `audit_push_log`. Returns aggregate counts.
4. **Receive.** Student device receives push. Service worker shows notification. On tap, app opens to a bottom sheet. Student approves. Browser calls `submit_audit_response(session_id, student_id, gpsLat, gpsLng, accuracy, status, 'AUTO_GPS')`. RPC executes: validates session is ACTIVE, computes distance, computes bucket, derives category, updates response row.
5. **Propagate.** Postgres emits a logical-replication event. Supabase Realtime captures it. Pushes it to subscribed admin and supervisor clients. Their UIs update.
6. **Trigger alert.** If the new bucket is `ORANGE` or `RED` and it's a transition, the `tg_audit_responses_alert` trigger inserts a row in `audit_alerts`. Realtime emits an INSERT event on alerts. Admin's UI plays the alert sound, shows the alert modal.
7. **Close.** Admin calls `close_audit(session_id, 'ADMIN', notes)`. RPC executes: updates any remaining `PENDING` rows to `UNKNOWN` (audit log captures the transition), updates session to `CLOSED`, computes summary. Realtime emits a session UPDATE. Admin's UI navigates to the summary page.

## 10.6 Failure modes and recovery

**Realtime websocket drops.** Client sees no events for >30 s. Polling fallback fires `get_active_audit` every 30 s. State stays correct, slower. When realtime reconnects, the polling continues until websocket events resume.

**RPC fails mid-call (network).** Client retries up to 3× with backoff. If still failing, presents an error with retry button. No partial state in DB (RPCs are transactional).

**Edge function fan-out partially fails.** Some students didn't get a push. The session is still active. The `audit_push_log` records the failures. The admin can see in the UI "297 of 381 pushes sent successfully" — they decide whether to also do a manual mode follow-up.

**Postgres goes down.** The product is offline. Nothing the application can do. Supabase's SLA kicks in.

**The admin's device dies during an audit.** Session is still active in DB. Admin opens phone, app, sees the active-session banner. Replay-safe.

**The session is forgotten and runs past 24 hours.** Cron transitions it to `TIMED_OUT`. Admin can still view it as a closed session in history. No data is lost; only the operation is closed.

## 10.7 What this architecture explicitly does not include

- **No Redis.** Postgres is enough.
- **No message queue (RabbitMQ, SQS, etc.).** Postgres + pg_cron is enough.
- **No separate analytics warehouse.** Postgres queries against `audit_*` tables are enough.
- **No microservices.** One Postgres, a few Edge Functions, one frontend. Monorepo-ish.
- **No GraphQL.** RPCs are sufficient and simpler.
- **No event sourcing.** The `audit_response_log` provides the audit trail; full event sourcing is overkill for the volume.

---

# Part 11 — Data Model

## 11.1 Modeling philosophy

The data model is **the product**. Every UI behavior is a query against this model. If the model can't express a question, no amount of frontend cleverness can answer it. So the model is designed first, and over-designed deliberately for future questions, within reason.

The model uses **denormalized hot paths** where the alternative — joining at query time — would slow the live dashboard. Specifically, `audit_responses.class_id` is denormalized from `students.classId` so the dashboard can group responses by class without joining 381 rows × 16 classes on every realtime update.

The model uses **immutable history tables** for the auditable trail. `audit_response_log` is INSERT-only; nothing ever modifies a log row.

## 11.2 Entity descriptions

This subsection describes each table in plain language. Field-level SQL appears in the implementation reference.

### `audit_sessions` — the audits themselves

One row per audit ever run. Lives forever. A session is the unit of the user-facing "ביקורת" concept.

Important fields:

- **`id`** — UUID primary key. Used in URLs (`/admin/audit/<id>/live`).
- **`mode`** — `MANUAL` or `LOCATION`. Immutable after insert.
- **`status`** — One of `ACTIVE`, `CLOSED`, `ABORTED`, `TIMED_OUT`. State machine in §12.
- **`class_ids`** — Array of class identifiers included in this audit. Snapshotted at open time; if a student moves class after the audit opens, the audit retains the old class assignment.
- **`total_students`** — Count at open time. Snapshotted.
- **`started_by`** — The actor who opened the session. Free-form text (currently `'ADMIN'` or a more specific identifier). The schema does not enforce a foreign key here because admin identity is currently PIN-based; when proper auth is introduced this becomes a UUID FK.
- **`started_at`** / **`closed_at`** — Timestamps.
- **`closed_by`** — The actor who closed it. Used for the auditable record.
- **`notes`** — Free-text from the closer (e.g. "morning seder").
- **`settings`** — JSONB. Stores mode-specific settings: `timeoutSec`, `sensitivity`, `pushTarget`, `showMap`.

### `audit_responses` — the per-student outcomes

One row per (session, student). Created at session open. Mutated during session. Final at session close.

Important fields:

- **`id`** — UUID.
- **`session_id`** — FK to `audit_sessions`. CASCADE on delete (sessions almost never delete, but if they do, responses go with them).
- **`student_id`** — FK to `students`. CASCADE.
- **`class_id`** — Denormalized snapshot of student's class at session open.
- **`category`** — `PENDING`, `IN_YESHIVA`, `OUT_PERMIT`, `OUT_NO_PERMIT`, `UNKNOWN`. Default `PENDING`.
- **`marked_by`** — Who/what set the current category. Free-form. Common values: `AUTO_DEPARTURE`, `AUTO_GPS`, `AUTO_CLOSE`, `ADMIN`, `SUPERVISOR:<class_id>`.
- **`marked_at`** — Timestamp of the most recent marking. Null while `PENDING`.
- **`gps_lat`** / **`gps_lng`** / **`gps_accuracy_m`** — Raw GPS. Nulled by retention cron after 90 days.
- **`distance_from_campus_m`** — Computed from GPS. Survives the 90-day GPS nulling.
- **`distance_bucket`** — `GREEN` / `BLUE` / `ORANGE` / `RED`. Computed at submission time. Survives 90-day nulling.
- **`gps_status`** — Why GPS was or wasn't useful: `OK`, `DENIED`, `TIMEOUT`, `OFFLINE`, `UNAVAILABLE`, `LOW_ACCURACY`.
- **`departure_id`** — FK to `departures` if this student had an `ACTIVE` departure at session open. Snapshotted.
- **`note`** — Free-text from whoever marked.

### `audit_response_log` — the immutable trail

One row per category change. INSERT-only. Trigger-driven from `audit_responses` updates.

Important fields:

- **`response_id`** / **`session_id`** / **`student_id`** — Convenience keys.
- **`from_category`** / **`to_category`** — The transition.
- **`actor`** — Who caused the change. Echoed from `audit_responses.marked_by`.
- **`changed_at`** — Timestamp.

This table is the answer to "who marked student X as out-without-permit, and when, and what did they change from?". It is the institutional audit trail.

### `audit_alerts` — the persistent warnings

One row per distance-bucket transition into `ORANGE` or `RED`. Trigger-driven. Acknowledgeable.

Important fields:

- **`session_id`** / **`student_id`** / **`triggered_at`** — Identification.
- **`distance_m`** — Snapshot of the distance that caused the alert.
- **`severity`** — `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`. Currently: `ORANGE` → `MEDIUM`, `RED` → `CRITICAL`.
- **`acknowledged_by`** / **`acknowledged_at`** / **`note`** — Resolution record.

Alerts persist forever. They are part of the audit history.

### `audit_push_log` — operational telemetry

One row per push notification attempted. Used for debugging push reliability. 30-day retention.

Important fields:

- **`session_id`** / **`target_kind`** (`STUDENT`, `SUPERVISOR`) / **`target_id`** — Who was the push for.
- **`success`** / **`error_message`** — Outcome.
- **`sent_at`** — Timestamp.

### Reused — `students` and `departures`

Audit reads from `students` (for fan-out, name resolution, push tokens) and `departures` (for pre-classification of `OUT_PERMIT`). Audit never writes to either. The Iron Rule of Departures from CLAUDE.md is preserved.

## 11.3 The five queries the model must answer fast

If these queries are slow, the live dashboard is broken. Each must complete in <50 ms at production scale (381 students × ~30 audits/month).

1. **"Give me the current active session, all responses, all alerts."** Answered by `get_active_audit` — single query plan with three index lookups.
2. **"How many in each category, by class?"** Answered by `compute_audit_kpis` — covered by the `(session_id, class_id, category)` index.
3. **"Who marked student X in session Y?"** Answered by a primary-key lookup on `audit_responses` followed by a single read of the response.
4. **"What was the full transition history for response R?"** Answered by a single-key lookup on `audit_response_log (response_id)`.
5. **"All sessions in the past 30 days for mode M."** Answered by `list_past_audits` — uses the `(started_at DESC)` index.

Indexes are designed to serve these queries, not to be comprehensive.

## 11.4 What the model does not include and why

- **No `student_audit_score`** or running attendance percentage. Computed on demand from `audit_responses` when needed; storing a denormalized score would create consistency risk.
- **No `class_audit_stats`** aggregate table. Same reasoning.
- **No `audit_notifications`** queue table. The Edge Function writes to `audit_push_log` directly; we don't need a queue.
- **No `audit_subscribers`**. Realtime handles fan-out at the database level.
- **No `audit_lock`** explicit table. The partial unique index serves the purpose.

## 11.5 Privacy fields and retention

The retention policy from §5.7 is enforced by a `pg_cron`-driven job:

```
Every day at 03:00 UTC:
  UPDATE audit_responses
     SET gps_lat = NULL,
         gps_lng = NULL,
         gps_accuracy_m = NULL
   WHERE marked_at < NOW() - INTERVAL '90 days'
     AND (gps_lat IS NOT NULL OR gps_lng IS NOT NULL);

Every day at 03:05 UTC:
  DELETE FROM audit_push_log
   WHERE sent_at < NOW() - INTERVAL '30 days';
```

The retention job is **idempotent and reversible-with-a-restore**: if it runs incorrectly, the only loss is GPS coordinates older than 90 days, which were going to be nulled in any case. The job logs its row counts so anomalies are visible.

---

# Part 12 — Workflow Design

## 12.1 State machines

The product has two interacting state machines: the session-level state machine and the response-level state machine.

### 12.1.1 Session state machine

```
                  open_audit()
                       │
                       ▼
                  ┌─────────┐  close_audit()      ┌─────────┐
       (initial)─►│ ACTIVE  │ ─────────────────► │ CLOSED  │  (terminal)
                  └────┬────┘                     └─────────┘
                       │
                       │  abort_audit()           ┌─────────┐
                       ├────────────────────────► │ ABORTED │  (terminal)
                       │                          └─────────┘
                       │
                       │  cron after 24h          ┌──────────┐
                       └────────────────────────► │TIMED_OUT │  (terminal)
                                                  └──────────┘
```

A session is in exactly one state at any time. Transitions are one-way. There is no resurrection — a CLOSED session cannot be reopened. If the admin needs to "redo" an audit, they open a new one; sessions are cheap.

### 12.1.2 Response state machine

```
                   open_audit() inserts
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
        ▼                 ▼                 ▼
   ┌─────────┐      ┌──────────┐     (initial state for everyone else)
   │PENDING  │ ◄────│OUT_PERMIT│     ┌─────────┐
   └────┬────┘      │(auto from│     │PENDING  │
        │           │departure)│     └────┬────┘
        │           └──────────┘          │
        │                                 │
        ├──── mark/auto-gps ──► IN_YESHIVA│
        ├──── mark/auto-gps ──► OUT_PERMIT│   (these arrows
        ├──── mark/auto-gps ──► OUT_NO_PERMIT  apply to any
        ├──── auto-gps ──────► UNKNOWN    │   non-terminal state)
        │                                 │
        └──── close_audit ──► UNKNOWN─────┘
              (if still PENDING at close)
```

**Important properties:**

- All response states are non-terminal during an active session. A response that is `IN_YESHIVA` can be reclassified to `OUT_NO_PERMIT` if the admin overrides.
- Once the session closes, the response state becomes effectively immutable. (We do not technically lock it in SQL — there are theoretical post-close override use cases — but the UI does not expose any way to change a closed session's responses. If we discover such a need we'll add an explicit override flow.)
- Every transition produces a `audit_response_log` row.

## 12.2 The "open an audit" workflow, step by step

The most important workflow. The admin is in motion. Every step is timed.

1. **Tap audit tile** — 1 tap. Navigates to `/admin/audit` (landing).
2. **Tap "new audit"** — 1 tap. Navigates to `/admin/audit/new`.
3. **Pick mode** — 1 tap. Confirms with a "next" button (1 more tap, deliberate friction to avoid accidental mode-pick).
4. **Confirm class selection** — Default is all classes pre-checked. 1 tap on "next" if no change. Total taps so far: 5.
5. **For LOCATION mode, confirm settings** — Default settings are usually fine. 1 tap on "next". For MANUAL mode, this step is skipped.
6. **Confirm-and-open screen** — Shows summary. 1 final tap on "פתח". Total taps: 6 (MANUAL) or 7 (LOCATION).
7. **Spinner for 1–3 seconds** while RPC runs and push fans out.
8. **Land on live dashboard.**

End-to-end time, from intent to live dashboard: **8–12 seconds**. This is the budget.

## 12.3 The "mark a student" workflow, supervisor side

1. **Receive push, tap notification** — 1 tap. Opens the app deep-linked to supervisor panel.
2. **Tap category button on a student** — 1 tap. Optimistic UI; the button shows the new color immediately; the network call runs in background.
3. **Confirmation appears** — 0 taps. A subtle color change confirms.
4. **Next student** — Scroll, repeat.

Per-student time: 0.5–2 seconds. For 23 students: 30–60 seconds is the budget.

## 12.4 The "respond to location request" workflow, student side

1. **Phone buzzes, glance at notification** — 0 taps so far. Recognition is immediate from the unique-icon.
2. **Tap notification** — 1 tap. App opens, bottom sheet is already on screen.
3. **Tap "אשר"** — 1 tap.
4. **Browser permission dialog** — If first time, browser asks "allow this site to access your location?". 1 tap on "allow". (Subsequent times, this step is skipped.)
5. **GPS acquired, RPC called, sheet dismissed** — 0 taps from student. 2-4 seconds of waiting.
6. **Confirmation toast: "✓ נשלח, תודה"** — 0 taps. 3-second fade.

Total student time: 5-10 seconds for first audit, 3-6 seconds for subsequent.

## 12.5 The "close an audit" workflow

1. **Admin notices "good enough" state on the dashboard** (e.g. 376/381 marked, the rest are known absences).
2. **Tap "סיים"** — 1 tap. Modal opens.
3. **Modal shows summary preview + a notes field** — 0 taps to look. Optional 1-second to type a one-word note.
4. **Tap "אישור"** — 1 tap.
5. **Spinner, then navigate to summary page** — 1-2 seconds.

Total close time: 3-5 seconds.

## 12.6 The "I missed it, let me catch up" workflow

This is replay. The most important architectural property.

1. **User opens the app, having missed the start of an audit** — could be any role.
2. **The app's normal "after login" routing checks for an active session.**
3. **If one is active and the user has a relevant role, a banner appears at the top of their landing page:** "ביקורת פעילה — לחץ להמשך".
4. **Tap banner** — 1 tap. Lands on the appropriate live page (admin dashboard, supervisor panel, or student sheet).
5. **All state visible** — Full state is rendered from `get_active_audit`. No "you missed N updates"; the current state *is* the truth.

This workflow exists at every layer. It is not a feature; it is a guarantee.

---

# Part 13 — State Management & Lifecycle

## 13.1 The single principle

State has one home: the database. The client *displays* state. The client never *holds* state that hasn't been written to the database, except for transient UI input (a half-typed note field, the local "which tab is selected" toggle). Optimistic UI is permitted as long as it reconciles within 1 second against the canonical realtime event.

## 13.2 Replay-safety as a guarantee

Every audit-related screen must satisfy:

> If I close my browser, reopen it, log in, and navigate back to this URL, I see exactly what I saw before, with no degraded data.

This guarantee is tested explicitly for:

- Admin live dashboard mid-session
- Admin live dashboard with alerts open
- Supervisor panel mid-marking
- Student sheet awaiting consent
- Admin summary page after session close
- Audit history page
- Audit compare page

If any screen fails this test, the screen is broken and ships nowhere.

## 13.3 Realtime as notification, not state

The realtime channel does one thing: it tells subscribers that a row changed. The subscriber's job is to:

1. Acknowledge the event.
2. **Refetch the canonical row from the database** (in practice, the realtime event carries the new row data, so this often happens implicitly).
3. Update its local view.

If a realtime event is dropped, the next polling refresh corrects the state. If two events arrive out of order, the latest by `updated_at` wins. There is no client-side reordering or merging logic.

## 13.4 Optimistic UI rules

Optimistic UI is permitted for actions where the client knows the likely outcome:

- **Supervisor taps "נוכח" on student X.** The button can immediately show the new state. The RPC call goes out concurrently. On RPC success, the realtime event arrives (within ~500 ms) and confirms. On RPC failure, the optimistic state is **reverted** and a toast appears.
- **Admin acknowledges an alert.** Same pattern.

Optimistic UI is **not** permitted for actions whose outcome is uncertain:

- **Admin opens an audit.** The RPC may fail (e.g. another session is active). No optimistic navigation — wait for response.
- **Admin closes an audit.** Confirm modal first, then RPC.

## 13.5 Persisted client state — minimal and intentional

One Zustand store (`audit-ui-store`) is persisted to localStorage. It contains exclusively **UI preferences**:

- `activeTab` — which of the four views is selected
- `soundEnabled` — whether sound is on

That is the entire list. Crucially **not** in localStorage:

- The session id
- Any response data
- Any partial form data (would be lost intentionally on refresh)
- Auth tokens (existing auth store handles those)
- Filter state — deliberately reset on refresh so the user starts fresh.

## 13.6 Concurrency

Two admins, one session: both connected via realtime to the same `audit_v2:<session_id>` channel. Both see all events. If both press "close" simultaneously, the RPC has an internal advisory lock; the second call returns `SESSION_NOT_ACTIVE` and the second admin sees a toast. No partial-close.

Two supervisors of the same class: the supervisor role-per-class is single-supervisor by design (one madrich per shi'ur), but the system tolerates two open supervisor panels on the same class. The last write wins; the `audit_response_log` captures the prior state.

A student opening the audit on two devices: the student's response is one row. Both devices submit; the second submit overwrites the first. Both `audit_response_log` rows exist.

---

# Part 14 — Error Handling

## 14.1 Error categorization

Errors fall into four behavior categories. Every error encountered in the design lifecycle is sorted into one.

**Category A — User can correct now.**
Example: typing an invalid PIN; selecting zero classes for an audit. Behavior: inline error message next to the field, explanation, no progression.

**Category B — User can retry.**
Example: network blip during RPC; realtime websocket dropped. Behavior: in-place retry button; the rest of the UI remains usable; explanation visible but unobtrusive.

**Category C — User cannot fix, but the system can continue.**
Example: a student's push notification failed to deliver. Behavior: silently logged; reported in aggregate in the admin's dashboard ("8 of 381 push sends failed"); not a per-student alert.

**Category D — Hard failure.**
Example: Postgres unreachable; auth invalid. Behavior: full-screen error component; clear messaging; offers retry or return-to-home; logs to client telemetry.

## 14.2 Error catalog with prescribed behavior

| Error | Category | UI behavior | Recovery |
|---|---|---|---|
| `AUDIT_ACTIVE` (open attempt fails) | A | Modal: "ביקורת פעילה כעת מ-09:15. המשך אותה או בטל." | Two buttons: Continue / Abort + Open New |
| `INVALID_MODE` | A | Inline form error | Re-select |
| `NO_CLASSES_SELECTED` | A | Inline form error, disable submit | Select a class |
| `SESSION_NOT_FOUND` | D | Full screen: "סשן זה לא קיים. ייתכן שנמחק." | Return to landing |
| `SESSION_NOT_ACTIVE` (submit attempt fails) | D | Toast + navigate to summary | Auto-redirect |
| `RPC_NETWORK_TIMEOUT` | B | Retry button on the failed action | Retry x3 with backoff |
| `RPC_5XX_SERVER_ERROR` | B | Retry button + telemetry breadcrumb | Retry x3 with backoff |
| `REALTIME_DISCONNECTED` | C | Discreet banner: "מתחבר מחדש…" (top of screen) | Polling fallback continues |
| `PUSH_PARTIAL_FAILURE` | C | KPI shows "299/381 הגיעו" + tooltip | Admin can re-send manually |
| `GPS_DENIED` | A (for student) / C (aggregated for admin) | Student sees a "אני לא יכול" path; admin sees `UNKNOWN` count rise | None — by design |
| `GPS_TIMEOUT` | A | Student sees retry option | Manual retry |
| `GPS_LOW_ACCURACY` | C | Response is `UNKNOWN`; admin sees it as such | Manual marker if needed |
| `EDGE_FUNCTION_DOWN` | B (during fan-out) | "פרסום ההתראה נכשל. נסה שוב." | Retry button |
| `PERMISSION_DENIED` (auth fail) | D | Redirect to login | Re-authenticate |
| `OFFLINE_NETWORK` | B | Toast "אתה במצב לא מקוון"; queue mutations | Auto-flush on reconnect |
| `STUDENT_NOT_IN_SESSION` | D | Toast "תלמיד זה לא בביקורת" | Refresh, verify |
| `CONCURRENT_CLOSE` | C | Toast "מישהו אחר סיים את הביקורת" | Navigate to summary |

## 14.3 Error message principles

- **No error codes in user-facing messages.** Codes are for telemetry. UI says "הסשן הסתיים", not "SESSION_NOT_ACTIVE (HTTP 410)".
- **No technical jargon.** "GPS_TIMEOUT" becomes "המיקום לקח יותר מדי זמן".
- **Always offer the next action.** Every error message has a button. Never a dead-end.
- **Hebrew throughout.** Even for developer-debug errors that leak to production, the message should be Hebrew with a small technical breadcrumb hidden behind a "פרטים טכניים" disclosure.

## 14.4 Telemetry on errors

Every Category-B, C, and D error is sent to a telemetry endpoint with:

- Error code
- User role
- Session ID (if any)
- Browser metadata
- Timestamp

This data does not include PII. It feeds the post-rollout monitoring dashboard (§17).

---

# Part 15 — Edge Cases

A catalog of edge cases, each with a designed handling. Edge cases are weaknesses if undesigned; they are strengths if anticipated.

| # | Scenario | Handling |
|---|---|---|
| 1 | A student is in two classes (rare but possible during a transition week). | The class denormalization snapshots the student's classId at session open. The response carries that class. If the student later changes class in the Sheet, the audit retains the original. |
| 2 | A student is added to the Sheet during an active audit. | The student is **not** added to the active session. They will be in the next audit. Adding mid-session would create a row with a missing time-history. |
| 3 | A student is deleted from the Sheet during an active audit. | The cascade does *not* fire (the audit reference is to the *response*, not the student). The response row remains; the student id is now dangling. UI handles by showing the studentId hash truncated and a "תלמיד נמחק" badge. History stays intact. |
| 4 | The admin's PIN is changed during an active session. | Existing supervisor PINs (which are concatenated from the admin PIN) become invalid. Supervisors who were marking lose authorization on their *next* submission. The session continues; the admin can manually mark on supervisors' behalf, or pause and rotate codes. **Mitigation:** UI warns the admin before saving a PIN change while a session is active. |
| 5 | A supervisor opens the app for a class they no longer manage. | The supervisor panel queries by their authenticated class. If they have no class, the panel is empty with a message "אינך משויך לכיתה". |
| 6 | Two students share one phone (rare, but in dormitories it happens). | Each authenticates separately. Each has their own push_token. The shared phone receives two pushes for two different student IDs. The student must tap the right notification for themselves. |
| 7 | A student has multiple devices (phone and old phone). | Whichever device most recently set its push_token receives the audit push. The other becomes silent. **This is a known limitation; not addressed in v1.** |
| 8 | The admin opens an audit at 23:55 and closes it at 00:05 the next day. | All timestamps are TIMESTAMPTZ; the session crosses date boundaries cleanly. The summary shows the cross-day range explicitly. |
| 9 | Daylight-saving transition during an active audit. | Asia/Jerusalem observes DST. TIMESTAMPTZ handles correctly. The "elapsed time" UI uses ISO time math, not display-local-time subtraction. No bug. |
| 10 | The session is opened in MANUAL but the admin wants to add GPS for some students. | Not supported in v1. The admin can override any response manually, but cannot trigger a GPS request from a MANUAL session. **If demanded post-launch, a "request GPS for these N students" feature can be added without schema change.** |
| 11 | A student's GPS reports accuracy of 50 km. | Tagged as `LOW_ACCURACY` and category set to `UNKNOWN`. The supervisor sees the student in their "needs manual" list. |
| 12 | A student is in a Faraday cage (basement, elevator) and gets no GPS fix. | Times out, category `UNKNOWN`. Supervisor handles. |
| 13 | GPS reports a position over water (clearly wrong, e.g. middle of the Dead Sea, which is geographically possible from Hebron). | The distance still computes legitimately. If the bucket is `RED`, an alert fires. If the supervisor knows the student is in fact on campus, they can override to `IN_YESHIVA` with a note. **The system does not "second-guess" GPS — it reports what it sees.** |
| 14 | The student approves consent, gets the GPS dialog, takes a long time to make a decision, and approves after the session has closed. | The submit RPC returns `SESSION_NOT_ACTIVE`. The student sees a friendly message: "הסשן הסתיים. תודה." Their response is `UNKNOWN` for that session. |
| 15 | A push notification is delivered 30 minutes late (some carriers do this). | Same as #14. By the time the student taps, the session may be closed. Same handling. |
| 16 | The admin starts a session and then loses internet. | The session is created in DB. The admin's UI shows an "offline" banner. The admin cannot mark, but the session continues. Supervisors and students continue to be served by the DB. When the admin reconnects, they catch up. |
| 17 | The Edge Function for push fails partway through fan-out. | The Edge Function reports partial success. The admin's UI shows the partial count. They can choose to retry (a separate Edge Function: `resend-audit-push` — same logic, only targets students with `audit_push_log.success=false`). |
| 18 | A supervisor accidentally taps `OUT_NO_PERMIT` on a student. | The change is reflected immediately. The supervisor sees their action in the activity feed. They can tap the student row again and pick a different category. The audit_response_log records both transitions. |
| 19 | An admin attempts to delete a student who has audit history. | Student deletion is a separate flow (via Sheets sync). The cascade rules: deleting a student deletes their responses but not their `audit_session` membership (responses CASCADE; session does not reference student directly). The aggregate stats remain correct minus that student. |
| 20 | Two students with the same name in the same class. | The system shows full names; if duplicates exist, the supervisor disambiguates by other means (student ID, photo would help but is rejected on privacy grounds — §16). |
| 21 | The admin lands on a "compare" page with three sessions selected, but one of those sessions is deleted from history. | The page fetches each session; failed fetches render as "ביקורת לא קיימת" tiles; the rest of the comparison renders normally. |
| 22 | A class has 0 students (a placeholder class in the Sheet). | `open_audit` validates `total_students > 0` overall (across all selected classes). It does **not** validate per-class. Empty classes are simply empty in the dashboard. |
| 23 | All 16 classes have 0 students (placeholder state). | `open_audit` returns `NO_STUDENTS_IN_SELECTION`. Admin sees an error. |
| 24 | The browser tab is backgrounded for 30 minutes during an active session. | Most browsers throttle background tabs aggressively. Realtime may pause. When the tab is foregrounded, the polling fallback kicks in and the realtime reconnects. State is refreshed. |
| 25 | The supervisor's phone runs out of battery mid-mark. | Whatever was already submitted is in DB. Re-login on a different device (or same device when charged) — replay-safe. |
| 26 | A student's clock is set wrong (off by years). | The student's clock has no bearing on anything — all timestamps are server-side. |
| 27 | The student is on a VPN that places them in Iceland by IP. | IP geolocation is not used; only GPS is used. VPN does not affect the result. |
| 28 | The student denies GPS once, then changes their mind. | The student can tap the notification again (it's still there). The bottom sheet reopens. They can approve this time. |
| 29 | The admin wants to "test" an audit without alerting everyone. | Not supported. There is no "test mode". The admin can use a `MANUAL` mode with a single test class to limit blast radius. Future: a sandbox project copy. |
| 30 | The yeshiva expands to 600 students. | Architecture supports this without change (see §17.4). |

The catalog is not exhaustive. It is representative of the rigor expected throughout. New edge cases discovered during implementation are appended.

---

# Part 16 — Security & Privacy

This section is structured deliberately: the **threat model** comes before the **mitigations**, because mitigations without a threat model are theatre.

## 16.1 Threat model

Threats are categorized by actor.

**External attacker (network, anonymous).** Goals: extract student data, deny service, embarrass the yeshiva.

**Curious user (student, supervisor, or family member with limited access).** Goals: see information about other students that they aren't entitled to.

**Hostile insider (a student wanting to spoof presence; a disgruntled supervisor wanting to falsify a record).** Goals: present false data to the system.

**Compromised auth (a leaked PIN, a stolen phone with an active session).** Goals: same as insider, with the access of the compromised user.

**Operational risk (developer error, accidental deletion).** Not a threat in the security sense but enumerated here because the same controls help.

## 16.2 What is being protected

In rough order of sensitivity:

1. **Student GPS coordinates.** Highest sensitivity. Bounded retention (§5.7).
2. **Audit history (who was marked what, by whom).** Moderate sensitivity; valuable for institutional integrity.
3. **PII (names, phones).** Existing — not introduced by the audit subsystem, but accessed by it.
4. **Operational metadata (who pushed what button when).** Low sensitivity, but its integrity matters for trust.

What is not in this system: passwords (student auth is ID-only currently), payment info (none), health records (none), parents' contact info (none directly — held in the Sheet).

## 16.3 Authentication, today and tomorrow

The current state of authentication in the system (as of CLAUDE.md) is honest:

- **Students authenticate by ID number only.** No password. The "device token" mechanism provides a degree of device-stability but not security.
- **Admins authenticate by PIN.** Single PIN, plaintext in `app_settings`.
- **Supervisors authenticate by a concatenation:** `{adminPin}{classCode}`.

This is acknowledged technical debt. The audit subsystem **inherits** these limits and does not introduce stricter requirements that the existing system cannot meet. Specifically:

- The audit subsystem will trust the role-bearer claim that the existing auth makes. If a stolen device authenticates, the audit subsystem cannot tell.
- The audit subsystem **logs every action with the claimed actor identity**, so post-hoc forensics is possible even if real-time prevention is not.

The path forward — out of scope for this plan but explicitly named — is:

- Add a password layer to student authentication.
- Add 2FA (TOTP) to admin authentication.
- Migrate supervisor authentication to per-user credentials, not concatenated PINs.
- Enable Supabase RLS so the database itself enforces scope (not just the application).

This is a meaningful infrastructure project. It is a prerequisite for the audit subsystem to be considered hardened.

## 16.4 Authorization (within the audit subsystem)

The role-to-capability matrix is in §6.5. Enforcement is **dual**:

- **In the application UI.** Routes are role-gated. The supervisor cannot navigate to the admin live dashboard.
- **In the RPC layer (best-effort given current auth).** RPCs accept an `actor` argument and validate it against a hashed admin PIN where possible. This is not bulletproof in the absence of RLS.

**Honest assessment:** the audit subsystem ships with the same authorization story as the rest of the application. It does not regress, but it does not lead. The threat of a curious supervisor manually crafting an HTTP request to mark a student in a class they don't manage is real and not prevented at the database. The mitigation is that supervisors don't typically have the technical ability or the motivation. This is a "trust the institution" model, not a "zero-trust" model.

## 16.5 Privacy, including halachic considerations

The yeshiva is a religious institution. Privacy norms in that context are stricter and more particular than secular defaults.

**Principles:**

1. **Tzniut (modesty) extends to data.** Even non-sensitive data about a person is treated with reserve. The system does not display photos. It does not aggregate behavior across audits into a "behavior score" visible to anyone. It does not surface inferences ("this student tends to be late") to anyone other than the immediate supervisor.

2. **Parental authority over minor students.** Most students are 16–22 years old, in the gray zone between minors and adults. The institutional practice — confirmed in CLAUDE.md and standard for yeshivot — is that the yeshiva acts in loco parentis. The audit subsystem treats this responsibility seriously: location data is collected only with student consent, retained briefly, and used only for the intended purpose.

3. **Rabbinic oversight.** The rosh yeshiva is, in practice, the privacy officer. Major changes to the audit subsystem's data collection should be presented to him before implementation. This plan should be reviewed by him; the team should not assume his approval.

**Concrete practices:**

- GPS coordinates are nulled after 90 days. Buckets and distances remain. The shape of the analytical signal is preserved without preserving the raw locations.
- The student's consent flow includes a one-sentence privacy statement on every audit: "המיקום נשלח פעם אחת, נשמר 90 יום, ולא נחשף לחברים."
- The admin's "privacy diagnostic" page (UC-12) allows the rosh yeshiva to answer a parent's question about a specific student's data history. This page exists not because the parent will ask often, but because the ability to answer cleanly is a form of trust.

## 16.6 Anti-fraud — what we do and what we don't

A determined student can fool the GPS system:

- They can use a mock-location app on Android.
- They can hand their phone to a friend who is on campus.
- They can leave their phone on campus and go elsewhere.

The system does **not** attempt to prevent these. The reasoning:

- An arms race against mock-location apps is unwinnable at the application layer.
- The vast majority of students will not attempt to defeat the system; the audit is not a punitive instrument so the motivation is low.
- Where fraud is suspected, it is an administrative matter (the supervisor knows the student isn't in the room; the supervisor marks `OUT_NO_PERMIT`). The system supports the supervisor's authority; it does not replace it.

The system does:

- Log every action so post-hoc review can detect patterns.
- Compute distance accuracy bands so highly-imprecise GPS is flagged `UNKNOWN` rather than trusted as `IN_YESHIVA`.
- Allow the admin to override any auto-classification.

## 16.7 Data export and right to deletion

The data subject — the student — has implicit rights even absent formal regulation:

- A student can request the rosh yeshiva to see their audit history. The admin can produce this via the privacy diagnostic page.
- A student can request deletion. The system supports a manual `DELETE FROM audit_responses WHERE student_id = ...`. This deletes their *responses* but leaves the *sessions* (which lose one count). Aggregated history is preserved without the individual.
- This is currently a manual procedure with the admin running an SQL query. Future: a self-serve "delete my data" UI for the student, gated by the rosh yeshiva's approval.

---

# Part 17 — Performance & Scalability

## 17.1 Load profile

The product is small. Honestly assessing the load:

- 381 students at first; 600 projected within 3 years.
- ~30 audit sessions per month at first; ~50/month later.
- During a `LOCATION` session: 381 RPC calls within ~3 minutes (peak burst of perhaps 50 calls in the first 30 seconds, then a long tail).
- During a `MANUAL` session: ~16 supervisors × ~25 students = ~400 RPC calls over ~3 minutes.
- Realtime subscriptions during a session: 1 admin + up to 16 supervisors + up to 381 students = ~398 concurrent subscriptions on the same channel.

This load is **trivially small** by modern database standards. The product will not be performance-bottlenecked. The performance discipline is about *latency* (the live dashboard feeling instant) more than *throughput*.

## 17.2 Latency targets

| Operation | Target p50 | Target p95 | Hard ceiling |
|---|---|---|---|
| `open_audit` | 200 ms | 500 ms | 2 s |
| `submit_audit_response` | 80 ms | 200 ms | 1 s |
| `get_active_audit` | 100 ms | 300 ms | 1 s |
| `close_audit` | 300 ms | 800 ms | 3 s |
| Realtime event → UI update | 400 ms | 1 s | 2 s |
| Live dashboard first paint | 800 ms | 2 s | 4 s |
| Live dashboard interactive | 1.5 s | 3 s | 5 s |

These are not aspirations. They are commitments. If any number breaches the hard ceiling, the launch holds.

## 17.3 Where bottlenecks are likely

- **Push fan-out (Edge Function).** Sending 381 web pushes is the longest single operation. Mitigation: parallelize within the Edge Function with a concurrency limit of 20–30 (Web Push servers rate-limit individual subscribers; concurrency higher than ~30 risks 429s).
- **Realtime delivery to 398 concurrent subscribers.** Supabase's realtime tier is generous but not unlimited. Mitigation: scope subscriptions narrowly (filter on session_id, not table-wide).
- **Postgres connections.** Each Realtime client uses one connection, and Supabase's Free tier connection limit is 60. Mitigation: realtime uses pooled connections internally; at our load this is not a concern; if we reach the limit, the upgrade to Pro tier is $25/mo.
- **Browser memory on long sessions.** A live dashboard left open for 8 hours subscribes to many realtime events. Mitigation: realtime events are processed and discarded; the in-memory `responses` Map is bounded by 381 entries; the activity feed is capped at 30 displayed items.

## 17.4 Capacity at 12 months and 36 months

| Metric | Today | +12 mo | +36 mo |
|---|---|---|---|
| Students | 381 | ~450 | ~600 |
| Audits / month | 30 | 40 | 60 |
| `audit_sessions` rows | 0 | ~480 | ~1,800 |
| `audit_responses` rows | 0 | ~210,000 | ~1,000,000 |
| `audit_alerts` rows | 0 | ~200 | ~800 |
| DB size (audit only) | 0 | ~80 MB | ~400 MB |
| Concurrent live admins | 1 | 2 | 3 |
| Peak push fan-out events / day | 0 | 1-2 | 2-3 |

All numbers fit within Supabase's Free tier (500 MB DB cap) at 12 months. At 36 months, the Pro tier ($25/mo, 8 GB) is comfortable headroom.

## 17.5 Frontend performance

- **Bundle size budget.** The audit subsystem adds <120 KB gzipped to the existing app bundle. Heavy components (Leaflet maps, jsPDF) are code-split.
- **First Contentful Paint** on the live page: <1.5 s on a mid-range Android over 4G.
- **Largest Contentful Paint**: <2.5 s.
- **CLS**: <0.1. Layouts are stable; cards have fixed aspect ratios; KPI strip is always present.
- **JS execution time on a class card update**: <16 ms (one frame). Achievable because card updates are isolated and don't re-render the grid.

## 17.6 Maps and Leaflet — special attention

The map view is the most expensive single component. Discipline:

- **Render only on map tab.** The map is mounted only when the map tab is active. Switching to grid unmounts it.
- **Cluster markers.** Above 50 markers, use `react-leaflet-cluster`. Below, render individually.
- **Tile caching.** OSM tiles are cached at the browser level; we serve directly from openstreetmap.org or a CDN (if traffic grows).
- **No realtime marker animation on each event.** Animation is throttled to one frame per ~33 ms (30 fps). At >30 events/second, marker positions update in batch.

---

# Part 18 — Accessibility

## 18.1 Targets

- WCAG 2.1 AA compliance for all user-facing screens.
- Keyboard-navigable end to end.
- Screen-reader compatible (VoiceOver, TalkBack, NVDA).
- Tested with real assistive technology, not just lint rules.

## 18.2 Hebrew RTL accessibility specifics

- `dir="rtl"` on `<html>` (already in place for the existing app).
- Focus order naturally follows RTL reading order in flex/grid containers.
- Numbers within text use `<bdi dir="ltr">` to prevent visual bidi reversal.
- Hebrew screen readers (NVDA with Hebrew voice, VoiceOver Hebrew) pronounce text correctly only if the markup language is `lang="he-IL"` on the root element.

## 18.3 Color and contrast

All status colors are checked against light and dark backgrounds for WCAG AA contrast:

| Token | Light bg contrast | Dark bg contrast | Notes |
|---|---|---|---|
| `--audit-green` on white | 4.6:1 ✓ | 6.8:1 ✓ | Passes AA for normal text |
| `--audit-blue` on white | 5.1:1 ✓ | 5.4:1 ✓ | Passes AA |
| `--audit-orange` on white | 3.0:1 ✗ | 7.2:1 ✓ | Fails AA on light bg — paired with icon and bold weight to compensate; chips use darker text on light background |
| `--audit-red` on white | 4.8:1 ✓ | 6.1:1 ✓ | Passes AA |
| `--audit-amber` on white | 2.7:1 ✗ | 9.0:1 ✓ | Fails AA on light bg — same compensation as orange |

Where contrast fails, the system never communicates by color alone — the affected chips always include an icon (lucide) plus a Hebrew word.

## 18.4 Interactive elements

- All buttons have an accessible name (`aria-label` if the visible text is ambiguous).
- All buttons are at least 44 × 44 pixels (Apple HIG / WCAG touch target minimum).
- Focus rings are visible and 2 px solid.
- Disabled buttons are visually distinct AND have `aria-disabled="true"`.
- Form fields have associated `<label>` elements.

## 18.5 Live regions

The KPI strip uses `aria-live="polite"` and `aria-atomic="true"` so screen readers announce updates as "נוכח, שלוש מאות ושבעים וארבע" after each significant change, but not for every increment.

Alerts use `role="alert"` so they interrupt the current screen reader narration.

The activity feed is `aria-live="polite"` with `aria-relevant="additions"` — only new items are announced.

## 18.6 Motion accessibility

`prefers-reduced-motion: reduce` is honored:

- CountUp animation reduces to instant value change.
- Slide-in animations become fades.
- Pulse animation on RED markers becomes a static glow.
- Tab rotation in projection mode pauses.

---

# Part 19 — Mobile & Responsive

## 19.1 Form factor targets

- **Primary: mobile 375 × 667 px.** This is iPhone SE, an honest lower bound for what the admin's phone might be.
- **Secondary: mobile 414 × 896 px.** This is the more common modern iPhone width. Most admin use happens here.
- **Tertiary: tablet 768 × 1024 px.** Used in projection scenarios.
- **Desktop 1280 × 720+.** Used for compare page, summary page, history page. Rarely for live monitoring.

## 19.2 Mobile-specific design

- **Sticky KPI strip.** On scroll, the KPI strip pins to the top of the viewport, shrinking from large numbers to compact form. The admin can always see the totals.
- **Tab bar at the bottom on mobile.** Grid/Heatmap/Map/Feed switch is reachable by thumb without stretching.
- **Drawer slide direction.** Class detail drawer slides up from the bottom on mobile (75% of viewport), in from the right on desktop (450 px wide). On tablet, follows screen orientation.
- **Touch targets.** Minimum 44 px. Spacing between targets 8 px (so finger doesn't accidentally hit two).
- **Pinch-to-zoom on map.** Native Leaflet behavior preserved.
- **No hover states.** Mobile design assumes no hover; all hover affordances on desktop have a tap equivalent.

## 19.3 Network conditions

- **3G as a baseline.** Live dashboard must be usable on a phone with 3G. Realtime works on 3G but with higher latency (2–5 s); polling fallback handles the gaps.
- **Offline supervisor.** As discussed, supervisor mutations queue offline.
- **Offline student.** Student cannot respond to an audit while offline. The notification is preserved by the OS; tapping it after going online still works.
- **Offline admin.** Admin cannot run the dashboard while offline. The connectivity status is shown prominently.

## 19.4 Battery and resource considerations

- **No background polling.** Polling fallback only runs while the page is foregrounded.
- **GPS request is one-shot.** No `watchPosition`. Battery cost: one GPS fix per audit.
- **Service worker is light.** Only handles push and routing; no heavy background work.

---

# Part 20 — Auditability & History

## 20.1 What the audit trail must answer

A reviewer six months later, reading only the database, must be able to answer:

- *When* was each audit run? *Who* opened it? *Who* closed it?
- *Which classes* were included?
- *Who* marked each student? *What* did they mark them as? *When*?
- *What previous values* did each response have before the current one?
- *Why* did a response transition (free-form `note` field, optional but encouraged)?
- *Which alerts* fired? *Who* acknowledged them? *When*? *Why* (acknowledgement note)?
- *Which push notifications* succeeded/failed?

All of these are answerable by direct queries against `audit_sessions`, `audit_responses`, `audit_response_log`, `audit_alerts`, `audit_push_log`.

## 20.2 What the audit trail intentionally does not record

- **The admin's location.** They are the operator; their phone's location is not part of the audit.
- **Per-keystroke activity in the supervisor panel.** Only category transitions are logged. The supervisor's typing of a note is captured in the final value, not in keystroke trail.
- **Page views, button clicks, scroll positions.** This is application-telemetry territory and lives in the existing application's logging, not in the audit subsystem.

## 20.3 Export formats

For regulatory or internal-review purposes, audit data can be exported in:

- **PDF.** Per-session summary suitable for printing. Hebrew RTL handled correctly using `jspdf` with a Hebrew font subset.
- **Excel (`.xlsx`).** Per-session detail; useful for analysis. Multiple sheets: summary, by-class, full responses, alerts. RTL-correct in modern Excel.
- **CSV.** A flat file of `(session_id, student_id, class_id, category, marked_by, marked_at, distance_bucket, distance_m)`. Used for ad-hoc analysis.

All exports include a header line with: session ID, mode, start time, end time, exporter identity.

GPS coordinates are not exported by default — the export shows buckets only. A separate, gated export option (admin-only confirmation) includes coordinates for sessions younger than 90 days.

---

# Part 21 — Testing Strategy

## 21.1 Testing philosophy

- **Test the database first.** SQL is the core of correctness. Trigger tests, RPC tests, constraint tests, retention tests.
- **Test boundaries, not internals.** A component test mocks the store; a store test mocks the API; an API test mocks the database — only where necessary. Whole-stack tests are integration tests, not unit tests.
- **Test what the user does, not what the developer wrote.** End-to-end tests follow the twelve use cases from §7.
- **Test what is hard to get right.** Realtime, replay, concurrency, race conditions get more test attention than CRUD.

## 21.2 Test layers

**Layer 1 — SQL unit tests.** Use `pg_tap` (or hand-rolled SQL assertions). Coverage:

- Constraints fire correctly (no two active sessions; categories must be in the enumeration; distances are non-negative).
- Triggers fire correctly (`audit_response_log` entry on every category change; `audit_alerts` row on every transition into ORANGE/RED).
- RPCs return expected shapes for happy paths.
- RPCs return expected error codes for failure paths.
- Retention cron correctly nulls GPS but preserves bucket.

**Layer 2 — TypeScript unit tests (Vitest).** Coverage:

- `haversine`, `bucketFromMeters`, `formatDistance` — pure functions with property-based tests.
- `gpsCollector` — wrapped against fake `navigator.geolocation`.
- Stores — given an event sequence, the store reaches the expected state.

**Layer 3 — Component tests (Vitest + React Testing Library).** Coverage:

- Each major component renders correctly given mocked store state.
- Loading, empty, error states render correctly.
- Interactive behaviors (clicking, typing) call the right store methods.

**Layer 4 — Integration tests (Playwright with real Supabase staging).** Coverage:

- UC-1 through UC-12 from §7, each as a Playwright scenario.
- Two-admin concurrent scenario (UC-4).
- Refresh-mid-session (UC-3).
- Realtime disconnect simulation.

**Layer 5 — Manual QA pre-launch.** Coverage:

- A QA tester acting as admin, supervisor, and student, on a real device, runs through each use case manually.
- A separate tester attempts to break the system: spam-clicking, race conditions, network throttling.
- A privacy reviewer reads the consent screens and verifies they match this document.

## 21.3 Performance testing

Before launch:

- Synthetic load test: simulate 381 concurrent `submit_audit_response` calls within 30 seconds against staging.
- Verify p95 latency stays under §17.2 thresholds.
- Verify realtime delivery to a single client stays under 1 second p95 during the burst.
- Verify the database stays responsive to `get_active_audit` while the burst is in flight.

## 21.4 Regression tests after launch

After every change to audit code:

- Full Playwright suite must pass.
- SQL unit tests must pass.
- Bundle size budget must be respected.
- No new console errors in dev mode.

## 21.5 What is *not* tested

- The browsers' GPS APIs themselves. Trusted.
- Supabase's realtime delivery guarantees. Trusted with polling fallback.
- The user's network. Assumed working.
- The push notification delivery infrastructure (Apple, Google). Trusted.

---

# Part 22 — QA Checklist (per role)

## 22.1 Admin QA checklist

- [ ] Land on `/admin/audit`; landing page renders with prior sessions or empty state.
- [ ] Tap "פתח ביקורת חדשה"; wizard step 1 (mode picker) appears.
- [ ] Each mode card responds to tap; selection state visible.
- [ ] "המשך" is disabled until a mode is picked.
- [ ] Step 2 (class picker) shows all 16 classes, all pre-checked.
- [ ] Uncheck-all then check-all toggles work.
- [ ] Per-grade check-all checkboxes work.
- [ ] Live student count updates as classes are toggled.
- [ ] Step 3 (location settings) appears only for LOCATION mode.
- [ ] Step 4 (confirmation) summarizes accurately.
- [ ] Tap "פתח" opens session and navigates to live page in under 3 seconds.
- [ ] Live page renders with all 381 students in PENDING immediately.
- [ ] KPI strip shows correct totals.
- [ ] Grid view sorts classes by attention-need.
- [ ] Switching tabs (grid/heatmap/map/feed) preserves session state.
- [ ] On LOCATION mode, map tab shows campus circles and 0 markers initially.
- [ ] As responses arrive, KPIs update via CountUp animation.
- [ ] As responses arrive, class cards update progress bars.
- [ ] As responses arrive, activity feed inserts new items at top with slide-in.
- [ ] Map (LOCATION) shows markers appearing one by one.
- [ ] Alert modal pops on first CRITICAL alert; sound plays (if sound enabled).
- [ ] Alert can be acknowledged; modal closes; alert list updates.
- [ ] Tap class card opens drawer with per-student details.
- [ ] Override a student's category from the drawer; change reflects everywhere.
- [ ] Tap "📺" enters projection mode; layout enlarges; tabs auto-rotate.
- [ ] Press Esc or tap "X" exits projection mode.
- [ ] Refresh the page mid-session; all state preserves.
- [ ] Tap "סיים"; modal asks for notes; preview shows current breakdown.
- [ ] Tap "אישור"; navigates to summary page in under 3 seconds.
- [ ] Summary page shows accurate totals and per-class breakdown.
- [ ] "ייצא PDF" produces a Hebrew RTL PDF in under 5 seconds.
- [ ] "ייצא Excel" produces a multi-sheet .xlsx in under 3 seconds.
- [ ] Navigate to history page; recent session appears at top.
- [ ] Tap "Compare", select 2-3 sessions, tap compare; comparison page renders.
- [ ] Comparison shows side-by-side counts and timeline chart.

## 22.2 Supervisor QA checklist

- [ ] Receive push when an audit opens; notification shows clear text.
- [ ] Tap notification; app opens deep-linked to supervisor panel.
- [ ] Supervisor panel shows ONLY their assigned class.
- [ ] All students of the class are listed.
- [ ] Students with `OUT_PERMIT` from active departures show as already-marked, in blue, with a "אוטומטי" badge.
- [ ] Other students show three-button row (נוכח / עם אישור / ללא אישור).
- [ ] Tap "נוכח"; button shows optimistic state immediately; backend updates within 1 second.
- [ ] Tap a different category on the same student; row updates without ambiguity.
- [ ] Tap "הוסף הערה"; note field appears; typed text saves on tap-elsewhere.
- [ ] Mark all 23 students in under 90 seconds.
- [ ] Panel shows "✓ סימנת את כולם" when 100%.
- [ ] Refresh the panel; all markings preserved.
- [ ] Disconnect network mid-marking; mark continues with queued mutations.
- [ ] Reconnect; queued mutations flush; no error toasts.
- [ ] Supervisor cannot navigate to admin live dashboard (route is gated).
- [ ] Supervisor can navigate to history of their own class only.

## 22.3 Student QA checklist

- [ ] Receive push during a LOCATION audit; notification text is clear Hebrew.
- [ ] Tap notification; app opens to a bottom sheet.
- [ ] Sheet shows: title, one-sentence privacy notice, two buttons.
- [ ] Tap "אשר ושלח מיקום"; browser prompts for location permission (first time only).
- [ ] Grant permission; GPS dialog disappears; spinner shows for 1-3 seconds.
- [ ] Toast appears: "✓ נשלח, תודה"; sheet closes; app returns to home.
- [ ] Tap "אני לא יכול"; sheet closes; no GPS sent.
- [ ] Verify in the supervisor's view: student appears as `UNKNOWN` with note "GPS denied" (or equivalent).
- [ ] Reopen app while audit is still active; sheet does NOT reopen (response is already submitted).
- [ ] After session closes, no audit-related UI is visible.

## 22.4 Cross-cutting QA

- [ ] Hebrew throughout, no English fallbacks.
- [ ] All text is RTL-correct.
- [ ] Dark mode works in all components.
- [ ] All distance numbers render in LTR enclaves.
- [ ] Color-only signaling is absent.
- [ ] Keyboard navigation works for all interactive elements.
- [ ] Screen reader announces KPI changes.
- [ ] Reduced-motion preference is honored.
- [ ] Mobile 375px width: all critical screens are usable.
- [ ] Two admins concurrent: identical state, sub-second propagation.
- [ ] Realtime disconnect: polling kicks in within 30 seconds.

---

# Part 23 — Implementation Phases

The implementation is divided into **five phases** with explicit gates. Each phase ends with a demonstrable artifact. No phase ends because "we ran out of days"; a phase ends when its acceptance criteria are met.

## 23.1 Phase 0 — Foundations (Week 1)

**Goal:** Database is correct; no UI yet.

**Deliverables:**

- The full SQL migration applied to staging.
- All 9 RPCs callable from `psql` and from the Supabase Studio.
- Trigger behavior verified manually (insert a response, observe `audit_response_log` row appears).
- `tick_audit_timeout` cron scheduled and tested (manually shift system time to verify).
- Realtime publication confirmed (use Supabase's Realtime panel to see events).
- SQL unit tests written and passing.

**Acceptance gate:** A QA engineer can run a hand-crafted SQL script that opens a session, inserts responses, triggers an alert, closes the session — and the data is in the expected shape afterwards.

**Risks:** Confusion about Hebrew class names in queries. Mitigation: use the existing `normalizeHebrew` discipline; verify in staging with real class data.

## 23.2 Phase 1 — Admin happy path, manual mode (Week 2)

**Goal:** An admin can open a manual audit, the UI shows responses pre-populated, the admin can close the audit, and history records it.

**Deliverables:**

- TypeScript types for the audit domain.
- Audit API client wrapping the RPCs.
- Audit Zustand stores (data + UI).
- `useActiveAudit` hook.
- Wizard screen (new audit).
- Live page (basic — just the KPI strip and grid view).
- Summary page.
- Landing page (audit history).
- All four navigation pages routed and reachable.
- `data-testid` attributes throughout for E2E hooks.

**Acceptance gate:** UC-1 (routine morning audit, manual) completes end-to-end on staging by one engineer playing both admin and supervisor roles (using two browsers). UC-3 (refresh mid-session) passes.

**Risks:** Underestimating the Zustand store complexity. Mitigation: build the store on Day 1 of Phase 1, test it standalone before any UI is wired.

## 23.3 Phase 2 — Supervisor and full manual workflow (Week 3)

**Goal:** Supervisors can mark students, mutations flow live to the admin dashboard, full UC-1 and UC-5 work.

**Deliverables:**

- Supervisor panel screen.
- Three-button-per-student row component.
- Note field on student rows.
- Optimistic UI with rollback on failure.
- IndexedDB queue for offline supervisor mutations.
- Activity feed view.
- Heatmap view.
- Realtime subscription wired correctly.
- Polling fallback.

**Acceptance gate:** UC-1, UC-3, UC-4, UC-5 all pass on staging. Supervisor experience is verified by one of the actual supervisors trying it.

**Risks:** Realtime delivery latency under load. Mitigation: synthetic load test (§21.3) before declaring Phase 2 complete.

## 23.4 Phase 3 — Location mode (Week 4)

**Goal:** Full LOCATION-mode audits, including push notifications, GPS, alerts, and the map view.

**Deliverables:**

- `send-audit-push` Edge Function deployed.
- Service worker updated to handle audit pushes.
- Student bottom sheet component.
- GPS collector library with all status codes.
- Map view with markers, clusters, range circles.
- Alert list and alert modal.
- Sound manager and chime/alert sounds.
- Notification deep-linking.

**Acceptance gate:** UC-2, UC-6, UC-7, UC-8 pass. A real student device receives a push and successfully completes the flow.

**Risks:** iOS push setup. Mitigation: test on a real iOS device, in Hebrew, by an iOS user. Allocate a day for iOS-specific debugging if needed.

## 23.5 Phase 4 — Polish, projection, exports, history (Week 5)

**Goal:** The product feels finished. Everything from §22 passes.

**Deliverables:**

- Projection mode.
- PDF export.
- Excel export.
- Compare page.
- All animations refined.
- All accessibility checks pass.
- Full Playwright suite green.
- Hebrew copy reviewed by rosh yeshiva.

**Acceptance gate:** All twelve use cases pass. All QA checklists from §22 pass. Privacy review complete.

## 23.6 Phase 5 — Rollout (Week 6)

**Goal:** Deployed to production safely.

**Deliverables:**

- Production migration applied (with backup).
- Edge Function deployed to production.
- Frontend deployed to production behind a feature flag.
- Flag enabled for admin first; one audit run in production with monitoring active.
- Flag enabled for all users.
- Old RollCall route redirected to new audit landing.
- Old RollCall code marked deprecated (not deleted; cleanup in a later sprint).
- Training session with admin (30 min).
- Training notes sent to supervisors (in-app and WhatsApp).
- Student onboarding card added to the student home.

**Acceptance gate:** 48 hours of production operation with no Sev-1 incidents and at least three real audits completed successfully.

## 23.7 What is explicitly deferred to post-launch

- Slack/email notifications for CRITICAL alerts (would be Phase 6).
- Audit templates (saved presets).
- Automatic recurring audits.
- Parent-facing summary.
- RLS migration.
- 2FA for admin.
- Native app.
- Geofence polygons (currently circles).
- Geographic heatmap.
- Trend dashboards.

## 23.8 Total budget

160-200 engineer-hours, 4-6 calendar weeks. The range reflects honest uncertainty about iOS quirks and Hebrew typography refinement.

---

# Part 24 — Rollout Strategy

## 24.1 Why a phased rollout

The audit subsystem affects three user groups simultaneously. A bug that breaks an audit is highly visible. The rollout reduces blast radius.

## 24.2 The rollout sequence

**Stage 1 — Internal validation (1 day, end of Phase 4).** Engineer-driven. Run UC-1 through UC-12 on staging with engineering team acting as users. Fix anything that doesn't pass.

**Stage 2 — Admin-only soft launch (2 days, start of Phase 5).** Production deployment with feature flag enabled for the admin's user ID only. Admin runs 2-3 audits with the new system, but the **old RollCall remains the official mechanism**. New audit results are observed but not relied upon for institutional decisions. The admin's job during this stage is to find friction points.

**Stage 3 — Real audit in production (1 day).** The admin runs a real audit using the new system. The rosh yeshiva uses the result. The team monitors closely.

**Stage 4 — Full enablement (1 day).** Feature flag turned on for everyone. RollCall is redirected to the new landing. Communication sent to supervisors and students.

**Stage 5 — Stabilization (1 week).** Monitoring active. Any bug reports treated as Sev-2+ until proven otherwise.

## 24.3 The kill switch

A feature flag exists for the entire audit subsystem. If a Sev-1 issue is found in stages 3, 4, or 5:

1. Flip the flag off.
2. The audit landing page reverts to the old RollCall page.
3. Active sessions: closed administratively via SQL.
4. Communicate to users.
5. Engineer fixes; re-run rollout.

The kill switch is reachable in under 60 seconds.

## 24.4 Communication plan

- **Admin:** 1:1 training, 30 min. Walkthrough of UC-1, UC-2, UC-7. Hand off a one-page reference card in Hebrew.
- **Supervisors:** Asynchronous WhatsApp message in Hebrew, plus a 90-second in-app video the first time they open the supervisor panel. Plus a 15-min Q&A at the next staff meeting.
- **Students:** A first-launch in-app card: "אנחנו עוברים למערכת חדשה לבקרת מיקום. הנה איך זה עובד..." with two screenshots.
- **Rosh yeshiva:** A short briefing from the admin, with this document (Pass 1 sections) as backup.
- **Parents:** No proactive communication. If they ask, the admin uses the privacy diagnostic page.

## 24.5 Success criteria for declaring rollout complete

- 7 days of production operation.
- ≥5 successful audits completed.
- 0 Sev-1 incidents.
- ≤2 Sev-2 incidents, all resolved.
- ≥4/5 satisfaction rating from the admin.
- No formal complaint from students or parents.

---

# Part 25 — Risks and Mitigations

A real risk register. Risks are scored on likelihood (L), impact (I), and the resulting attention they warrant.

## 25.1 Top risks

**R1. iOS Web Push reliability is below 95%.**
L: Medium. I: High. iOS Safari Web Push requires "Add to Home Screen". Many students will not do this even after instruction.
*Mitigation:* The system does not depend on push for correctness; it depends on push for *prompt notification*. If a student doesn't get the push, the supervisor manually marks them. The supervisor flow is the safety net.
*Detection:* Monitor `audit_push_log.success` rate; if iOS specifically is <80%, escalate to UX review.

**R2. GPS accuracy is unusable inside the main building.**
L: Medium. I: High. The yeshiva's main beit midrash has thick stone walls. GPS in stone buildings is often poor.
*Mitigation:* Set `maxAccuracyM=1000`; anything worse becomes `UNKNOWN`. Don't trust precise location indoors. The system is designed assuming GPS will be unreliable for ~10-20% of students.
*Detection:* Track median `gpsAccuracyM`; if median is >500 m, location mode is degraded.

**R3. The admin doesn't adopt the new system.**
L: Low (admin pushed for this). I: Critical (entire investment wasted).
*Mitigation:* The admin co-designs the live dashboard. Their feedback in Stage 2 is incorporated. The 1:1 training is in person.
*Detection:* Number of audits run in week 1, 2, 4, 8. If declining, intervene.

**R4. Supervisors find the panel slower than informal methods.**
L: Medium. I: High. Some supervisors will prefer "I'll just text the admin who's missing".
*Mitigation:* The supervisor experience is optimized for speed. 90 seconds is the budget. If real measurements show >180 seconds, the design has failed and needs rework.
*Detection:* Measure median time-to-complete per supervisor; track per-supervisor adoption.

**R5. Real-time data feels overwhelming to the admin.**
L: Medium. I: Medium. A flood of updates is a real risk on the live dashboard.
*Mitigation:* Animation discipline (§9.7); restrained KPI strip; explicit per-update animation budget.
*Detection:* Subjective. Three reviewers rate "calmness" of the dashboard before launch.

**R6. Halachic-privacy concern is raised post-launch.**
L: Low. I: Critical.
*Mitigation:* Halachic review pre-launch by the rosh yeshiva. The 90-day retention, the consent flow, the no-photos policy all support this review.
*Detection:* Listen for parent complaints; revisit data policy at 30, 60, 90 days post-launch.

**R7. Push notification rate limits hit (Apple specifically caps sender rate at ~20/sec).**
L: Medium. I: Medium.
*Mitigation:* Edge Function batches with concurrency 20. Logs each send to `audit_push_log`. Retries with backoff for 429 responses.
*Detection:* `audit_push_log.error_message LIKE '%429%'` count.

**R8. The 24-hour timeout closes a real audit prematurely.**
L: Very low. I: Low (admin sees TIMED_OUT and opens a new one). Acceptable risk.

**R9. Concurrent admins step on each other's actions.**
L: Low. I: Low.
*Mitigation:* Single-active-session mutex; advisory locks in RPCs; last-write-wins with audit log.

**R10. Supabase outage during a critical audit.**
L: Very low. I: Critical (entire product offline).
*Mitigation:* Acknowledged. Supabase's SLA is the bound. No app-level mitigation possible.
*Detection:* Existing infrastructure monitoring.

**R11. The new system reveals an existing bug in `students` or `departures`.**
L: Medium. I: Low to medium.
*Mitigation:* The audit subsystem reads from those tables; it doesn't depend on them being perfect. Bugs discovered are handled as separate work items.

**R12. Migration deployment fails halfway through.**
L: Low. I: Medium.
*Mitigation:* Migration runs in a transaction (BEGIN/COMMIT). Idempotent (IF NOT EXISTS throughout). Tested on staging first.

**R13. The Hebrew rendering in PDF/Excel is wrong.**
L: Medium. I: Low.
*Mitigation:* Test PDF in modern Acrobat and Excel before launch. If pdf rendering is bad, fallback to Excel-only export in v1.

## 25.2 Risk monitoring post-launch

A simple dashboard tracks the top risk indicators weekly:

- Audit count
- Push success rate
- Median supervisor mark time
- Median student response time
- `UNKNOWN` rate per audit (high = many failures)
- Alerts per audit (steady = healthy; spike = either an event or a bug)
- Median GPS accuracy
- Realtime disconnect events

Anomalies trigger investigation.

---

# Part 26 — Alternative Approaches Considered

For posterity and to demonstrate the recommendation is informed:

## 26.1 Pure-broadcast (current RollCall, refined)

*Approach:* Keep the broadcast model but make the admin's screen better.

*Rejected because:* The fundamental flaws — no persistence, no replay, single admin — are not fixable on the broadcast architecture. They are *features* of broadcasts.

## 26.2 Pure-polling

*Approach:* Don't use realtime. The admin's dashboard polls `get_active_audit` every 2 seconds.

*Rejected because:* Higher latency (felt as 1-2 second lag), higher database load, and no advantage over the realtime+polling-fallback approach. Realtime is already in the stack and free.

## 26.3 WebSocket server outside Supabase

*Approach:* Run a custom Node websocket server for audit-specific events.

*Rejected because:* Operational complexity. Supabase Realtime is sufficient. The custom server would require its own deploy pipeline, scaling, monitoring.

## 26.4 Native mobile app

*Approach:* Capacitor or React Native to get push reliability and offline support.

*Rejected because:* The development cost is 3-5× the PWA cost, the audience is reachable via PWA, the iOS push limitation is acknowledged and worked around with the manual fallback.

## 26.5 Outsourced attendance vendor (e.g. ClassDojo, SchoolMint)

*Approach:* Don't build this.

*Rejected because:* Vendor products do not handle Hebrew RTL, do not handle the supervisor-as-rabbi authority model, do not honor halachic privacy norms, and would require integrating with the existing student data which is in Google Sheets in Hebrew. The integration cost is comparable to the build cost without the customization benefit.

## 26.6 Single mode (location only)

*Approach:* Don't bother with manual mode.

*Rejected because:* Discussed in §5.1. Single-mode is too brittle.

## 26.7 Five or more categories

*Approach:* Add `EXCUSED_SICK`, `EXCUSED_FAMILY`, `LATE`, etc.

*Rejected because:* Discussed in §5.2. Cognitive overhead exceeds the value.

## 26.8 No GPS, RFID badges instead

*Approach:* Issue a badge to each student; scanners at the door.

*Rejected because:* Hardware cost. Failure modes (forgot badge, lost badge) are worse than GPS failures. No retrofit path on existing student devices.

## 26.9 QR codes posted in classrooms

*Approach:* Student scans a QR every morning to declare presence.

*Rejected because:* QR systems are gameable (anyone can scan the QR) and require the student to actively initiate. The product needs an admin-initiated capability.

---

# Part 27 — Recommended Final Approach

This is the headline. Everything above supports this.

## 27.1 What we are building

A **persistent, real-time, role-aware attendance auditing subsystem** that lives inside the existing Yeshivat Shavi Hevron application. It has two modes (manual, location), three pickable categories (present, out-with-permit, out-without-permit), and five user roles consuming it (admin, supervisor, student, plus implicit rosh yeshiva and parent).

The product centerpiece is a **live dashboard** for the administrator, with four restrained views (grid, heatmap, map, feed) and a persistent KPI strip. The dashboard is replay-safe: any refresh, any reconnect, any device-swap renders identical state.

Push notifications fan out via a Supabase Edge Function. Realtime updates propagate via `postgres_changes` with a 30-second polling fallback. All audit data lives in five Postgres tables, with the database as the sole source of truth.

GPS data is consented, narrow-purpose, and time-limited (raw coordinates nulled after 90 days; bucketed distance survives).

The product replaces the existing RollCall feature.

## 27.2 Why this approach and not another

It is the simplest design that satisfies all the goals in §4.1, respects the constraints in §16, fits within the budget in §23.8, and accommodates the future evolution sketched in §5.4 and §23.7 without rework.

## 27.3 What the team commits to

- Replay-safety guaranteed by §13.2.
- Latency budgets met per §17.2.
- Accessibility AA per §18.
- Privacy practices per §16.5.
- Communication plan per §24.4.

## 27.4 What the team explicitly does not commit to in v1

The non-goals in §4.2. Stated plainly: no parent portal, no continuous tracking, no fraud detection, no native app, no multi-tenant, no RLS in v1, no automatic disciplinary actions.

---

# Part 28 — Open Questions

These are decisions that **need to be made before implementation begins**. They are not edge cases; they are commitments not yet made.

**Q1. Does pg_cron exist on the current Supabase instance?**
The cron-based timeout depends on it. If pg_cron isn't available, an alternative (a GitHub Actions schedule that calls a `tick_audit_timeout` RPC every 5 minutes) is acceptable but requires a separate deploy step.
*Recommended check:* `SELECT installed_version FROM pg_available_extensions WHERE name='pg_cron';`

**Q2. Are the existing VAPID keys the keys we want to keep?**
If they were generated for a previous developer and the private key is uncertain, push will fail silently. The keys must be present, matching between the frontend `.env` and the Edge Function secrets, and known to the rosh yeshiva as the encryption keys for student notifications.
*Recommended action:* Audit the VAPID keys before Phase 3. Rotate if uncertain.

**Q3. What is the supervisor-class mapping today?**
The system has class codes per class in `app_settings`. Are all 16 classes currently mapped? Is each class's mapping pointing to a real, active, in-the-building supervisor?
*Recommended action:* Verify before rolling supervisor flow. The admin should print a list and walk through it.

**Q4. Is there a backup snapshot policy?**
Before applying the production migration, a backup is required. Does Supabase auto-backup cover us, or is a manual snapshot needed?
*Recommended action:* Confirm Supabase tier supports point-in-time recovery; if not, take a manual SQL dump pre-migration.

**Q5. Should "sound on" be the default?**
The admin's live dashboard plays chimes on response arrivals and alert sounds on critical alerts. The default state is "on" in this plan. But in some contexts (open-plan office, vaad meeting), the admin will want sound off by default.
*Recommendation:* Default sound on for first launch; persist the user's preference; tweak default if feedback says so.

**Q6. Should the rosh yeshiva have a separate, read-only role?**
Currently he uses the admin's phone if he wants to see audit data. A read-only "view only" admin role is a small addition (just a flag on `app_settings`). Do we want it in v1?
*Recommendation:* Defer to v1.1. The admin shares his phone for now.

**Q7. What happens to RollCall code post-rollout?**
We can delete it, deprecate it, or mark it as legacy. Each has implications for routing and minor analytics.
*Recommendation:* Deprecate (mark unused) for 30 days post-rollout; delete fully in a v1.1 cleanup.

**Q8. Do we want the privacy diagnostic page in v1?**
UC-12 describes it. Implementing it is small (one new admin page, one SQL query). But it adds surface area.
*Recommendation:* Include in v1; the cost is low and the institutional value is high.

**Q9. What is the Hebrew copy for the student consent screen?**
The draft is in §5.9 (table) but the consent screen specifically needs review by the rosh yeshiva because it touches halachic-privacy framing.
*Recommendation:* Draft the consent screen text in Hebrew, submit to rosh yeshiva for review during Phase 4.

**Q10. Should the system retain raw push payloads for debugging?**
The `audit_push_log` records success/failure but not the payload sent. For debugging push reliability, retaining the payload for a short window (7 days) would help. This is a small data-model decision.
*Recommendation:* Add a `payload_summary` TEXT field on `audit_push_log`; 7-day retention; not used for normal operations.

**Q11. Are class supervisors authorized to see distances/coordinates of their students?**
A class supervisor sees their students' categories. Should they also see the distance/bucket if it came from GPS? This is a privacy question — the data exists, but exposing it to supervisors creates a higher exposure surface.
*Recommendation:* In v1, supervisors see the bucket and the category, but **not** the precise distance in meters. The admin sees precise distance. This honors the principle of least exposure.

**Q12. Should the heatmap and map views be available to supervisors?**
Currently only the admin sees them. Should a supervisor be able to see a map of their own class's GPS responses?
*Recommendation:* No, in v1. Maintains the supervisor's scope as "marking my class", not "investigating my class". If demanded, add in v1.1.

---

# Part 29 — Final Approval Checklist

A senior stakeholder reviewing this plan should be able to sign off after confirming each line.

**Strategic alignment**
- [ ] The problem statement (§3) matches the institutional priority.
- [ ] The goals (§4.1) are correct and measurable.
- [ ] The non-goals (§4.2) are explicit and acceptable.
- [ ] The success criteria (§4.3) are realistic.

**Product decisions**
- [ ] Two modes (manual, location) is the right scope. (§5.1)
- [ ] Three pickable categories is the right cardinality. (§5.2)
- [ ] Admin-only audit initiation is the right authority model. (§5.3)
- [ ] Single-active-session is the right concurrency model. (§5.4)
- [ ] 300m / 1km / 5km distance buckets are the right thresholds. (§5.5)
- [ ] 90-day GPS retention is the right privacy stance. (§5.7)
- [ ] The Hebrew terminology table is accepted. (§5.9)

**Architecture**
- [ ] The layer breakdown (§10.3) is sound.
- [ ] The data model (§11) supports the queries that matter.
- [ ] Database is the sole source of truth. (§13.1)
- [ ] Replay-safety is a non-negotiable. (§13.2)

**Risks**
- [ ] The top risks (§25.1) are understood.
- [ ] Mitigations for R1 (iOS push) and R2 (indoor GPS) are accepted.
- [ ] The kill switch (§24.3) is well-defined.

**Implementation**
- [ ] Five phases (§23) is the right cadence.
- [ ] 4-6 week budget is acceptable.
- [ ] The acceptance gate for each phase is clear.

**Privacy & security**
- [ ] The threat model (§16.1) is realistic.
- [ ] Halachic privacy considerations (§16.5) are addressed.
- [ ] The auth honest-assessment (§16.3) is acceptable for v1.

**Open questions**
- [ ] The 12 open questions in §28 are assigned to owners.
- [ ] None of them block Phase 0; all of them have answers before Phase 3.

**Rollout**
- [ ] The phased rollout (§24.2) is acceptable.
- [ ] The communication plan (§24.4) is approved.

**Sign-off**

| Role | Name | Signature | Date |
|---|---|---|---|
| Rosh Yeshiva | | | |
| Administrator | | | |
| Lead Engineer | | | |
| Privacy Reviewer | | | |

---

# Document end

This document is **the plan**. The implementation reference (`INTERNAL_AUDIT_IMPLEMENTATION_REFERENCE.md`) contains code-level details that follow from this plan but do not define it. If the implementation reference and this document disagree, **this document wins** until amended.

Amendments to this document must be:

1. Tracked in a changelog at the top (to be added in v1.1).
2. Initialed by the same reviewers who approved v1.
3. Reflected in the implementation reference within one week.

The next document update will be after Phase 5 acceptance, capturing the lessons learned from real production use.

**End of Master Plan v1 — 2026-05-16.**
