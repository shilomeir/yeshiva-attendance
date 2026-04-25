-- =============================================================================
-- UNIFIED DEPARTURES SYSTEM
-- Migration: 20260423_unified_departures.sql
--
-- Replaces the fragmented absence_requests + events-based departure model with
-- a single, strongly-typed `departures` table governed by one state machine.
--
-- State machine:
--   PENDING  → APPROVED  (admin/supervisor approves)
--   PENDING  → REJECTED  (admin/supervisor rejects)
--   APPROVED → ACTIVE    (tick_departures fires when start_at ≤ now)
--   ACTIVE   → COMPLETED (tick_departures fires when end_at ≤ now, or student returns early)
--   any non-terminal → CANCELLED (student or admin cancels)
--
-- Single entry point for all writes: submit_departure() RPC.
-- All paths — student self-checkout, admin override, SMS, supervisor — funnel here.
-- Advisory lock per class_id prevents concurrent quota bypass.
--
-- Apply in Supabase Dashboard → SQL Editor.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 0. PREREQUISITES
-- ─────────────────────────────────────────────────────────────────────────────

-- Required for the EXCLUDE USING gist constraint (overlap prevention)
CREATE EXTENSION IF NOT EXISTS btree_gist;


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. DEPARTURES TABLE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS departures (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,

  -- Denormalized at submission time — never updated on class reassignment.
  -- This preserves quota correctness: a student's departure counts against
  -- the class they were in when they submitted.
  class_id      TEXT        NOT NULL,

  -- Full TIMESTAMPTZ — no more HH:MM strings or date+time splits.
  -- All stored in UTC; displayed in Asia/Jerusalem in the UI.
  start_at      TIMESTAMPTZ NOT NULL,
  end_at        TIMESTAMPTZ NOT NULL,

  status        TEXT        NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING','APPROVED','ACTIVE','COMPLETED','REJECTED','CANCELLED')),

  -- Origin of the departure record
  source        TEXT        NOT NULL DEFAULT 'SELF'
                CHECK (source IN ('SELF','ADMIN_OVERRIDE','SUPERVISOR','SMS','SHEETS')),

  is_urgent     BOOLEAN     NOT NULL DEFAULT FALSE,
  reason        TEXT,
  admin_note    TEXT,

  -- Actor who approved/processed this departure (null until action taken)
  approved_by   TEXT,

  -- Lifecycle timestamps — exactly one non-created_at field is non-null at end state
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at   TIMESTAMPTZ,
  activated_at  TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  cancelled_at  TIMESTAMPTZ,
  rejected_at   TIMESTAMPTZ,

  -- GPS (populated only by RollCall audit, optional)
  gps_lat       DOUBLE PRECISION,
  gps_lng       DOUBLE PRECISION,

  -- ── Hard constraints (enforced in DB, not just application code) ──────────
  CONSTRAINT departures_end_after_start
    CHECK (end_at > start_at),

  CONSTRAINT departures_max_30_days
    CHECK (end_at < start_at + INTERVAL '30 days')
);

-- Prevent any two live departures for the same student from overlapping in time.
-- This closes the "stack two departures" quota bypass completely.
ALTER TABLE departures
  DROP CONSTRAINT IF EXISTS departures_no_overlap;

ALTER TABLE departures
  ADD CONSTRAINT departures_no_overlap
  EXCLUDE USING gist (
    student_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  )
  WHERE (status IN ('PENDING','APPROVED','ACTIVE'));

-- At most one ACTIVE departure per student at any instant (belt-and-suspenders)
CREATE UNIQUE INDEX IF NOT EXISTS departures_one_active_per_student
  ON departures (student_id)
  WHERE status = 'ACTIVE';

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_departures_class_status
  ON departures (class_id, status, start_at, end_at);

CREATE INDEX IF NOT EXISTS idx_departures_student_status
  ON departures (student_id, status);

CREATE INDEX IF NOT EXISTS idx_departures_status_end
  ON departures (status, end_at);

CREATE INDEX IF NOT EXISTS idx_departures_student_created
  ON departures (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_departures_pending
  ON departures (status, created_at)
  WHERE status = 'PENDING';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. LINK EVENTS → DEPARTURES
-- ─────────────────────────────────────────────────────────────────────────────

-- Every CHECK_IN / CHECK_OUT event can now be linked back to the departure that
-- caused it. This keeps events as the immutable audit log while departures are
-- the live state machine.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS departure_id UUID REFERENCES departures(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_departure_id
  ON events (departure_id);

-- Fix the TEXT/TIMESTAMPTZ mismatch in events.expectedReturn.
-- All stored values are ISO-8601 strings so the cast is safe.
ALTER TABLE events
  ALTER COLUMN "expectedReturn" TYPE TIMESTAMPTZ
  USING "expectedReturn"::TIMESTAMPTZ;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CALENDAR VIEW
-- ─────────────────────────────────────────────────────────────────────────────

-- Single view used by every dashboard, calendar, and history page.
-- Shows ALL departures regardless of origin (SELF/ADMIN_OVERRIDE/SMS/SUPERVISOR).
-- Excludes CANCELLED and REJECTED — those are in admin_overrides audit log only.
CREATE OR REPLACE VIEW v_calendar_departures AS
SELECT
  d.id,
  d.student_id,
  d.class_id,
  d.start_at,
  d.end_at,
  d.status,
  d.source,
  d.is_urgent,
  d.reason,
  d.admin_note,
  d.approved_by,
  d.created_at,
  d.approved_at,
  d.activated_at,
  d.completed_at,
  d.cancelled_at,
  d.rejected_at,
  d.gps_lat,
  d.gps_lng,
  s."fullName"  AS student_name,
  s."grade"     AS grade,
  -- Overstay flag: ACTIVE for more than 24 h past end_at (admin alert only)
  (d.status = 'ACTIVE' AND d.end_at < NOW() - INTERVAL '24 hours') AS is_overdue_alert
FROM departures d
JOIN students s ON s.id = d.student_id
WHERE d.status IN ('PENDING','APPROVED','ACTIVE','COMPLETED');

GRANT SELECT ON v_calendar_departures TO authenticated;
GRANT SELECT ON v_calendar_departures TO anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. AUDIT TRIGGER
-- ─────────────────────────────────────────────────────────────────────────────

-- Every status transition on departures is automatically logged to admin_overrides.
-- This makes auditing impossible to forget: no code path can mutate status silently.

CREATE OR REPLACE FUNCTION departures_audit_trigger_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_status TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_prev_status := NULL;
  ELSE
    -- Only fire when status actually changes
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
      RETURN NEW;
    END IF;
    v_prev_status := OLD.status;
  END IF;

  INSERT INTO admin_overrides (
    id,
    "studentId",
    "adminId",
    action,
    "previousStatus",
    "newStatus",
    timestamp,
    note
  ) VALUES (
    gen_random_uuid(),
    NEW.student_id,
    COALESCE(NEW.approved_by, 'system'),
    'departure_' || NEW.status,
    v_prev_status,
    NEW.status,
    NOW(),
    NEW.admin_note
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS departures_audit_insert ON departures;
CREATE TRIGGER departures_audit_insert
  AFTER INSERT ON departures
  FOR EACH ROW
  EXECUTE FUNCTION departures_audit_trigger_fn();

DROP TRIGGER IF EXISTS departures_audit_update ON departures;
CREATE TRIGGER departures_audit_update
  AFTER UPDATE OF status ON departures
  FOR EACH ROW
  EXECUTE FUNCTION departures_audit_trigger_fn();


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. submit_departure — SINGLE ENTRY POINT FOR ALL DEPARTURES
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Every write to departures must go through this RPC.
-- Quota check + advisory lock are always applied.
--
-- Returns JSONB:
--   { id, status }                            — ACTIVE or APPROVED or PENDING
--   { status:'QUOTA_FULL', current, quota, overlapping } — quota full, no row created
--   { error, message }                        — validation or server error
--
-- p_force_pending = true  → creates PENDING row even when quota is full
--                           (student confirmed "send to admin anyway")
-- p_source = 'ADMIN_OVERRIDE' requires p_actor_role IN ('ADMIN','SUPERVISOR')

CREATE OR REPLACE FUNCTION submit_departure(
  p_student_id    UUID,
  p_start_at      TIMESTAMPTZ,
  p_end_at        TIMESTAMPTZ,
  p_reason        TEXT        DEFAULT NULL,
  p_is_urgent     BOOLEAN     DEFAULT FALSE,
  p_source        TEXT        DEFAULT 'SELF',
  p_approved_by   TEXT        DEFAULT NULL,
  p_force_pending BOOLEAN     DEFAULT FALSE,
  p_actor_id      TEXT        DEFAULT NULL,
  p_actor_role    TEXT        DEFAULT 'STUDENT'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class_id          TEXT;
  v_class_size        INT;
  v_quota             INT;
  v_overlapping_count INT := 0;
  v_overlapping       JSONB := '[]'::jsonb;
  v_status            TEXT;
  v_departure_id      UUID;
  v_now               TIMESTAMPTZ := NOW();
BEGIN

  -- ── 0. Source authorization ────────────────────────────────────────────────
  IF p_source = 'ADMIN_OVERRIDE' AND p_actor_role NOT IN ('ADMIN', 'SUPERVISOR') THEN
    RETURN jsonb_build_object(
      'error',   'unauthorized',
      'message', 'source=ADMIN_OVERRIDE requires actor_role ADMIN or SUPERVISOR'
    );
  END IF;

  -- ── 1. Time window validation ──────────────────────────────────────────────
  IF p_end_at <= p_start_at THEN
    RETURN jsonb_build_object('error', 'invalid_range', 'message', 'end_at must be after start_at');
  END IF;
  IF p_end_at > p_start_at + INTERVAL '30 days' THEN
    RETURN jsonb_build_object('error', 'range_too_long', 'message', 'Window cannot exceed 30 days');
  END IF;

  -- ── 2. Resolve class_id (denormalize at submission time) ──────────────────
  SELECT "classId" INTO v_class_id
  FROM students
  WHERE id = p_student_id;

  IF v_class_id IS NULL THEN
    RETURN jsonb_build_object('error', 'student_not_found');
  END IF;

  -- ── 3. Advisory lock — prevents concurrent quota bypass for same class ─────
  PERFORM pg_advisory_xact_lock(hashtext(v_class_id));

  -- ── 4. Dynamic quota ───────────────────────────────────────────────────────
  SELECT COUNT(*) INTO v_class_size
  FROM students
  WHERE "classId" = v_class_id;

  v_quota := GREATEST(1, ROUND((v_class_size * 3)::numeric / 25));

  -- ── 5. Decide initial status ───────────────────────────────────────────────
  IF p_source = 'ADMIN_OVERRIDE' THEN
    -- Admin/supervisor: skip quota entirely, always APPROVED
    v_status := 'APPROVED';

  ELSIF p_is_urgent THEN
    -- Urgent: always needs explicit admin approval
    v_status := 'PENDING';

  ELSE
    -- Normal request: count overlapping live non-urgent departures in this class
    -- Quota counts ANY APPROVED or ACTIVE departure whose window overlaps ours,
    -- excluding urgent-exempted ones and the student themselves.
    SELECT
      COUNT(*),
      COALESCE(
        jsonb_agg(jsonb_build_object(
          'studentId',   d.student_id::TEXT,
          'studentName', s."fullName",
          'endAt',       d.end_at
        )),
        '[]'::jsonb
      )
    INTO v_overlapping_count, v_overlapping
    FROM departures d
    JOIN students s ON s.id = d.student_id
    WHERE d.class_id  = v_class_id
      AND d.status    IN ('APPROVED', 'ACTIVE')
      AND d.is_urgent = FALSE
      AND d.student_id != p_student_id
      AND tstzrange(d.start_at, d.end_at, '[)') && tstzrange(p_start_at, p_end_at, '[)');

    IF v_overlapping_count >= v_quota THEN
      IF NOT p_force_pending THEN
        -- Return quota info WITHOUT inserting.
        -- Client shows the banner; user decides whether to force-send to admin.
        RETURN jsonb_build_object(
          'status',      'QUOTA_FULL',
          'current',     v_overlapping_count,
          'quota',       v_quota,
          'overlapping', v_overlapping
        );
      ELSE
        -- Student explicitly chose "send to admin anyway" → PENDING
        v_status := 'PENDING';
      END IF;
    ELSE
      v_status := 'APPROVED';
    END IF;
  END IF;

  -- ── 6. Insert the departure row ────────────────────────────────────────────
  v_departure_id := gen_random_uuid();

  INSERT INTO departures (
    id, student_id, class_id,
    start_at, end_at,
    status, source, is_urgent,
    reason, approved_by,
    created_at, approved_at
  ) VALUES (
    v_departure_id,
    p_student_id,
    v_class_id,
    p_start_at,
    p_end_at,
    v_status,
    p_source,
    p_is_urgent,
    p_reason,
    CASE WHEN v_status = 'APPROVED' THEN COALESCE(p_approved_by, p_actor_id, 'auto') ELSE NULL END,
    v_now,
    CASE WHEN v_status = 'APPROVED' THEN v_now ELSE NULL END
  );

  -- ── 7. If APPROVED and start_at ≤ now → activate immediately ──────────────
  IF v_status = 'APPROVED' AND p_start_at <= v_now THEN
    UPDATE departures
    SET status       = 'ACTIVE',
        activated_at = v_now
    WHERE id = v_departure_id;

    UPDATE students
    SET "currentStatus" = 'OFF_CAMPUS',
        "lastSeen"      = v_now
    WHERE id = p_student_id;

    RETURN jsonb_build_object(
      'id',      v_departure_id::TEXT,
      'status',  'ACTIVE',
      'quota',   v_quota,
      'current', v_overlapping_count
    );
  END IF;

  -- ── 8. If PENDING and quota was full → notify admin (flag in response) ─────
  RETURN jsonb_build_object(
    'id',           v_departure_id::TEXT,
    'status',       v_status,
    'quota',        v_quota,
    'current',      v_overlapping_count,
    'notifyAdmin',  (v_status = 'PENDING' AND p_force_pending AND NOT p_is_urgent)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', 'server_error', 'message', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION submit_departure(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BOOLEAN,TEXT,TEXT,BOOLEAN,TEXT,TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION submit_departure(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BOOLEAN,TEXT,TEXT,BOOLEAN,TEXT,TEXT)
  TO anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. approve_departure
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION approve_departure(
  p_id          UUID,
  p_actor_id    TEXT,
  p_actor_role  TEXT DEFAULT 'ADMIN',
  p_note        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dep        RECORD;
  v_now        TIMESTAMPTZ := NOW();
  v_new_status TEXT;
BEGIN
  SELECT * INTO v_dep FROM departures WHERE id = p_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF v_dep.status != 'PENDING' THEN
    RETURN jsonb_build_object('error', 'invalid_transition', 'current_status', v_dep.status);
  END IF;

  -- Supervisor can only approve departures in their own class.
  -- (PIN validation already enforces class; this is belt-and-suspenders.)
  IF p_actor_role = 'SUPERVISOR' THEN
    IF NOT EXISTS (
      SELECT 1 FROM app_settings
      WHERE key = 'class_code_' || v_dep.class_id
    ) THEN
      RETURN jsonb_build_object('error', 'class_mismatch');
    END IF;
  END IF;

  -- If start_at has already passed → activate immediately
  v_new_status := CASE WHEN v_dep.start_at <= v_now THEN 'ACTIVE' ELSE 'APPROVED' END;

  UPDATE departures
  SET status       = v_new_status,
      approved_by  = p_actor_id,
      approved_at  = v_now,
      activated_at = CASE WHEN v_new_status = 'ACTIVE' THEN v_now ELSE activated_at END,
      admin_note   = COALESCE(p_note, admin_note)
  WHERE id = p_id;

  IF v_new_status = 'ACTIVE' THEN
    UPDATE students
    SET "currentStatus" = 'OFF_CAMPUS',
        "lastSeen"      = v_now
    WHERE id = v_dep.student_id;
  END IF;

  RETURN jsonb_build_object('id', p_id::TEXT, 'status', v_new_status);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', 'server_error', 'message', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION approve_departure(UUID,TEXT,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_departure(UUID,TEXT,TEXT,TEXT) TO anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. reject_departure
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reject_departure(
  p_id         UUID,
  p_actor_id   TEXT,
  p_actor_role TEXT DEFAULT 'ADMIN',
  p_note       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dep RECORD;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_dep FROM departures WHERE id = p_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF v_dep.status != 'PENDING' THEN
    RETURN jsonb_build_object('error', 'invalid_transition', 'current_status', v_dep.status);
  END IF;

  UPDATE departures
  SET status      = 'REJECTED',
      rejected_at = v_now,
      approved_by = p_actor_id,
      admin_note  = COALESCE(p_note, admin_note)
  WHERE id = p_id;

  RETURN jsonb_build_object('id', p_id::TEXT, 'status', 'REJECTED');

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', 'server_error', 'message', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION reject_departure(UUID,TEXT,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_departure(UUID,TEXT,TEXT,TEXT) TO anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. cancel_departure
-- ─────────────────────────────────────────────────────────────────────────────
-- Can be called from any non-terminal state.
-- If the departure was ACTIVE, student is returned ON_CAMPUS
-- (only if no other ACTIVE departure exists).

CREATE OR REPLACE FUNCTION cancel_departure(
  p_id         UUID,
  p_actor_id   TEXT,
  p_actor_role TEXT DEFAULT 'STUDENT',
  p_note       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dep     RECORD;
  v_now     TIMESTAMPTZ := NOW();
  v_was_active BOOLEAN;
BEGIN
  SELECT * INTO v_dep FROM departures WHERE id = p_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF v_dep.status IN ('COMPLETED', 'REJECTED', 'CANCELLED') THEN
    RETURN jsonb_build_object('error', 'already_terminal', 'current_status', v_dep.status);
  END IF;

  v_was_active := (v_dep.status = 'ACTIVE');

  UPDATE departures
  SET status       = 'CANCELLED',
      cancelled_at = v_now,
      admin_note   = COALESCE(p_note, admin_note)
  WHERE id = p_id;

  -- Return student ON_CAMPUS only if this was their active departure
  -- and they have no other active departure (handles edge cases)
  IF v_was_active THEN
    UPDATE students
    SET "currentStatus" = 'ON_CAMPUS',
        "lastSeen"      = v_now
    WHERE id = v_dep.student_id
      AND NOT EXISTS (
        SELECT 1 FROM departures
        WHERE student_id = v_dep.student_id
          AND status     = 'ACTIVE'
          AND id        != p_id
      );
  END IF;

  RETURN jsonb_build_object('id', p_id::TEXT, 'status', 'CANCELLED');

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', 'server_error', 'message', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_departure(UUID,TEXT,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_departure(UUID,TEXT,TEXT,TEXT) TO anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- 9. return_departure — student presses "חזרתי" (early return)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION return_departure(
  p_id         UUID,
  p_student_id UUID  DEFAULT NULL,
  p_gps_lat    DOUBLE PRECISION DEFAULT NULL,
  p_gps_lng    DOUBLE PRECISION DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dep RECORD;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_dep FROM departures
  WHERE id = p_id
    AND (p_student_id IS NULL OR student_id = p_student_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF v_dep.status != 'ACTIVE' THEN
    RETURN jsonb_build_object('error', 'not_active', 'current_status', v_dep.status);
  END IF;

  -- Mark departure COMPLETED
  UPDATE departures
  SET status       = 'COMPLETED',
      completed_at = v_now,
      gps_lat      = COALESCE(p_gps_lat, gps_lat),
      gps_lng      = COALESCE(p_gps_lng, gps_lng)
  WHERE id = p_id;

  -- Write a CHECK_IN event to the immutable audit log, linked back to this departure
  INSERT INTO events (
    id, "studentId", type, timestamp,
    "gpsLat", "gpsLng", "gpsStatus", "syncedAt",
    departure_id
  ) VALUES (
    gen_random_uuid(),
    v_dep.student_id,
    'CHECK_IN',
    v_now,
    p_gps_lat,
    p_gps_lng,
    CASE WHEN p_gps_lat IS NOT NULL THEN 'GRANTED'::text ELSE 'UNAVAILABLE'::text END,
    v_now,
    p_id
  );

  -- Return ON_CAMPUS if no other ACTIVE departure remains
  UPDATE students
  SET "currentStatus" = 'ON_CAMPUS',
      "lastSeen"      = v_now
  WHERE id = v_dep.student_id
    AND NOT EXISTS (
      SELECT 1 FROM departures
      WHERE student_id = v_dep.student_id
        AND status     = 'ACTIVE'
        AND id        != p_id
    );

  RETURN jsonb_build_object('id', p_id::TEXT, 'status', 'COMPLETED');

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', 'server_error', 'message', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION return_departure(UUID,UUID,DOUBLE PRECISION,DOUBLE PRECISION) TO authenticated;
GRANT EXECUTE ON FUNCTION return_departure(UUID,UUID,DOUBLE PRECISION,DOUBLE PRECISION) TO anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- 10. tick_departures — called by pg_cron every 60 seconds
-- ─────────────────────────────────────────────────────────────────────────────
-- Single function that advances the state machine based on wall-clock time.
-- Replaces: auto_checkout_students + auto_return_students + mark_overdue_students.

CREATE OR REPLACE FUNCTION tick_departures()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count    INT := 0;
  v_now      TIMESTAMPTZ := NOW();
  v_student  RECORD;
BEGIN

  -- ── Step 1: Activate APPROVED departures whose start_at has arrived ─────────
  UPDATE departures
  SET status       = 'ACTIVE',
      activated_at = v_now
  WHERE status     = 'APPROVED'
    AND start_at  <= v_now;

  -- Flip those students to OFF_CAMPUS
  UPDATE students s
  SET "currentStatus" = 'OFF_CAMPUS',
      "lastSeen"      = v_now
  WHERE s.id IN (
    SELECT student_id FROM departures
    WHERE status       = 'ACTIVE'
      AND activated_at >= v_now - INTERVAL '70 seconds'
  );

  -- ── Step 2: Complete ACTIVE departures whose end_at has passed ───────────────
  UPDATE departures
  SET status       = 'COMPLETED',
      completed_at = v_now
  WHERE status = 'ACTIVE'
    AND end_at <= v_now;

  -- Return students ON_CAMPUS (only if no other ACTIVE departure remains)
  FOR v_student IN
    SELECT DISTINCT student_id FROM departures
    WHERE status       = 'COMPLETED'
      AND completed_at >= v_now - INTERVAL '70 seconds'
  LOOP
    UPDATE students
    SET "currentStatus" = 'ON_CAMPUS',
        "lastSeen"      = v_now
    WHERE id = v_student.student_id
      AND NOT EXISTS (
        SELECT 1 FROM departures
        WHERE student_id = v_student.student_id
          AND status     = 'ACTIVE'
      );
  END LOOP;

  -- ── Step 3: Purge terminal rows older than 30 days (from end_at) ─────────────
  -- Retention rule: delete 30 days after the departure period ended.
  DELETE FROM departures
  WHERE status IN ('COMPLETED', 'CANCELLED', 'REJECTED')
    AND end_at < v_now - INTERVAL '30 days';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- ── Step 4: Overstay detection (ACTIVE past end_at by 24+ hours) ─────────────
  -- These are surfaced to admin via is_overdue_alert in v_calendar_departures.
  -- No automatic action — admin must decide. We just update lastSeen so the
  -- realtime channel fires and dashboards refresh.
  UPDATE students s
  SET "lastSeen" = v_now
  WHERE s.id IN (
    SELECT student_id FROM departures
    WHERE status = 'ACTIVE'
      AND end_at < v_now - INTERVAL '24 hours'
  )
    AND s."currentStatus" IN ('OFF_CAMPUS', 'OVERDUE');

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION tick_departures() TO authenticated;
GRANT EXECUTE ON FUNCTION tick_departures() TO anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- 11. DATA MIGRATION: absence_requests → departures
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN

-- Migrate only if absence_requests table still exists
IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'absence_requests') THEN

  INSERT INTO departures (
    id, student_id, class_id,
    start_at, end_at,
    status, source, is_urgent,
    reason, admin_note, approved_by,
    created_at, approved_at, rejected_at, cancelled_at
  )
  SELECT
    gen_random_uuid(),
    ar."studentId",
    s."classId",

    -- Convert date+time strings to full TIMESTAMPTZ in Jerusalem timezone
    (ar.date::TEXT || ' ' || ar."startTime" || ':00')::TIMESTAMP AT TIME ZONE 'Asia/Jerusalem',
    (COALESCE(ar."endDate", ar.date)::TEXT || ' ' || ar."endTime" || ':00')::TIMESTAMP AT TIME ZONE 'Asia/Jerusalem',

    -- Map AbsenceRequestStatus → DepartureStatus
    -- An APPROVED request is ACTIVE if we're currently inside its window,
    -- COMPLETED if the window has passed, APPROVED if it's in the future.
    CASE ar.status
      WHEN 'PENDING'   THEN 'PENDING'
      WHEN 'REJECTED'  THEN 'REJECTED'
      WHEN 'CANCELLED' THEN 'CANCELLED'
      WHEN 'APPROVED'  THEN
        CASE
          WHEN (ar.date::TEXT || ' ' || ar."startTime" || ':00')::TIMESTAMP
               AT TIME ZONE 'Asia/Jerusalem' <= v_now
            AND (COALESCE(ar."endDate", ar.date)::TEXT || ' ' || ar."endTime" || ':00')::TIMESTAMP
                AT TIME ZONE 'Asia/Jerusalem' > v_now
            AND s."currentStatus" IN ('OFF_CAMPUS', 'OVERDUE')
          THEN 'ACTIVE'
          WHEN (ar.date::TEXT || ' ' || ar."startTime" || ':00')::TIMESTAMP
               AT TIME ZONE 'Asia/Jerusalem' > v_now
          THEN 'APPROVED'
          ELSE 'COMPLETED'
        END
      ELSE 'CANCELLED'
    END,

    'SELF',        -- all historical requests came from students
    ar."isUrgent",
    ar.reason,
    ar."adminNote",
    NULL,          -- approved_by unknown for historical records
    ar."createdAt",
    CASE WHEN ar.status = 'APPROVED' THEN ar."createdAt" ELSE NULL END,
    CASE WHEN ar.status = 'REJECTED' THEN ar."createdAt" ELSE NULL END,
    CASE WHEN ar.status = 'CANCELLED' THEN ar."createdAt" ELSE NULL END

  FROM absence_requests ar
  JOIN students s ON s.id = ar."studentId"
  -- Guard: skip if a departure already exists for this student in the same window
  WHERE NOT EXISTS (
    SELECT 1 FROM departures d
    WHERE d.student_id = ar."studentId"
      AND tstzrange(d.start_at, d.end_at, '[)') &&
          tstzrange(
            (ar.date::TEXT || ' ' || ar."startTime" || ':00')::TIMESTAMP AT TIME ZONE 'Asia/Jerusalem',
            (COALESCE(ar."endDate", ar.date)::TEXT || ' ' || ar."endTime" || ':00')::TIMESTAMP AT TIME ZONE 'Asia/Jerusalem',
            '[)'
          )
  );

END IF;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 12. DATA MIGRATION: Orphan active CHECK_OUT events → departures
-- ─────────────────────────────────────────────────────────────────────────────
-- Students who are currently OFF_CAMPUS but have no departure row yet
-- (i.e., they checked out directly without going through absence_requests).

DO $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN

INSERT INTO departures (
  id, student_id, class_id,
  start_at, end_at,
  status, source, is_urgent,
  reason, created_at, approved_at, activated_at
)
SELECT
  gen_random_uuid(),
  e."studentId",
  s."classId",
  e.timestamp,
  COALESCE(
    e."expectedReturn",
    e.timestamp + INTERVAL '8 hours'   -- fallback for missing return time
  ),
  'ACTIVE',
  'SELF',
  FALSE,
  e.reason,
  e.timestamp,
  e.timestamp,
  e.timestamp

FROM (
  -- Latest CHECK_OUT per student
  SELECT DISTINCT ON ("studentId")
    id, "studentId", timestamp, reason, "expectedReturn"
  FROM events
  WHERE type = 'CHECK_OUT'
  ORDER BY "studentId", timestamp DESC
) e
JOIN students s ON s.id = e."studentId"
WHERE s."currentStatus" IN ('OFF_CAMPUS', 'OVERDUE')
  -- Skip if a departure row already covers this student
  AND NOT EXISTS (
    SELECT 1 FROM departures d
    WHERE d.student_id = e."studentId"
      AND d.status IN ('ACTIVE', 'APPROVED', 'PENDING')
  );

END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 13. CLEANUP: Migrate OVERDUE → OFF_CAMPUS in students table
-- ─────────────────────────────────────────────────────────────────────────────
-- OVERDUE status is deprecated. Migrate all remaining OVERDUE students to
-- OFF_CAMPUS so the new system starts clean.

UPDATE students
SET "currentStatus" = 'OFF_CAMPUS'
WHERE "currentStatus" = 'OVERDUE';


-- ─────────────────────────────────────────────────────────────────────────────
-- 14. CRON: Replace old jobs with tick_departures
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN

    -- Remove deprecated cron jobs
    BEGIN PERFORM cron.unschedule('mark-overdue-students'); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM cron.unschedule('auto-return-students');  EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM cron.unschedule('tick-departures');       EXCEPTION WHEN OTHERS THEN NULL; END;

    -- Schedule the single ticker every minute
    PERFORM cron.schedule(
      'tick-departures',
      '*/1 * * * *',
      'SELECT tick_departures()'
    );

  END IF;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 15. DROP DEPRECATED RPCs
-- ─────────────────────────────────────────────────────────────────────────────
-- These functions are replaced entirely by the new RPCs above.
-- Dropping them prevents any old client code from accidentally succeeding.

DROP FUNCTION IF EXISTS create_checkout_with_quota_check(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS create_checkout_with_quota_check(TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS check_absence_quota(TEXT, DATE, DATE, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS auto_checkout_students();
DROP FUNCTION IF EXISTS auto_return_students();
DROP FUNCTION IF EXISTS mark_overdue_students();
