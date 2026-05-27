-- =============================================================================
-- INTERNAL AUDIT (ביקורת פנימית) — DB-FIRST SESSION MODEL
-- Migration: 20260527_internal_audit.sql
--
-- Implements the design from docs/superpowers/specs/2026-05-16-internal-audit-redesign-design.md
--
-- Replaces the old broadcast-only RollCall (which lost all state on refresh)
-- with a persistent session model:
--   - audit_sessions          : single source of truth for an audit run
--   - audit_session_classes   : which classes are participating
--   - audit_participants      : snapshot of each student in the session
--   - audit_location_responses: GPS responses (or failures) per student
--   - audit_manual_marks      : supervisor/admin manual marks
--   - audit_alerts            : live exceptions
--
-- Plus three views (v_audit_live_board, v_audit_class_board, v_audit_history)
-- and seven RPCs (create_audit_session, activate_audit_session,
-- record_audit_app_opened, record_audit_location_response,
-- record_manual_audit_mark, complete_audit_session, cancel_audit_session).
--
-- Idempotent. Safe to re-run.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 0. PREREQUISITES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. TABLES
-- ─────────────────────────────────────────────────────────────────────────────

-- 1.1 audit_sessions ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_sessions (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mode                        TEXT        NOT NULL CHECK (mode IN ('LOCATION','MANUAL')),
  status                      TEXT        NOT NULL DEFAULT 'DRAFT'
                              CHECK (status IN ('DRAFT','ACTIVE','CLOSING','COMPLETED','CANCELLED')),
  title                       TEXT        NOT NULL DEFAULT 'ביקורת פנימית',
  started_by                  TEXT        NOT NULL,
  started_at                  TIMESTAMPTZ,
  ended_at                    TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes                       TEXT,
  projection_enabled          BOOLEAN     NOT NULL DEFAULT TRUE,
  threshold_meters            INTEGER     NOT NULL DEFAULT 5000,
  include_approved_departures BOOLEAN     NOT NULL DEFAULT TRUE,
  summary                     JSONB
);

-- At most ONE active/closing session at any moment
CREATE UNIQUE INDEX IF NOT EXISTS audit_sessions_only_one_open
  ON audit_sessions ((1))
  WHERE status IN ('DRAFT','ACTIVE','CLOSING');

CREATE INDEX IF NOT EXISTS idx_audit_sessions_status_created
  ON audit_sessions (status, created_at DESC);


-- 1.2 audit_session_classes ---------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_session_classes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID        NOT NULL REFERENCES audit_sessions(id) ON DELETE CASCADE,
  grade       TEXT        NOT NULL,
  class_id    TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, class_id)
);

CREATE INDEX IF NOT EXISTS idx_audit_session_classes_session
  ON audit_session_classes (session_id);


-- 1.3 audit_participants -----------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_participants (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id               UUID        NOT NULL REFERENCES audit_sessions(id) ON DELETE CASCADE,
  student_id               TEXT        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  student_name             TEXT        NOT NULL,
  id_number                TEXT        NOT NULL,
  grade                    TEXT        NOT NULL,
  class_id                 TEXT        NOT NULL,
  baseline_status          TEXT        NOT NULL,
  approved_departure_id    UUID        REFERENCES departures(id) ON DELETE SET NULL,
  approved_departure_label TEXT,
  expected_state           TEXT        NOT NULL
                           CHECK (expected_state IN ('EXPECTED_ON_CAMPUS','APPROVED_OUTSIDE')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_audit_participants_session
  ON audit_participants (session_id);

CREATE INDEX IF NOT EXISTS idx_audit_participants_session_class
  ON audit_participants (session_id, class_id);


-- 1.4 audit_location_responses -----------------------------------------------
CREATE TABLE IF NOT EXISTS audit_location_responses (
  id                            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id                    UUID        NOT NULL REFERENCES audit_sessions(id) ON DELETE CASCADE,
  student_id                    TEXT        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status                        TEXT        NOT NULL CHECK (status IN (
                                 'PENDING','REQUEST_SENT','APP_OPENED',
                                 'GRANTED','DENIED_BY_USER','UNAVAILABLE',
                                 'TIMEOUT','LOW_ACCURACY','FAILED'
                                )),
  lat                           DOUBLE PRECISION,
  lng                           DOUBLE PRECISION,
  accuracy_meters               DOUBLE PRECISION,
  distance_from_campus_meters   INTEGER,
  location_class                TEXT CHECK (location_class IN ('ON_CAMPUS','NEAR_CAMPUS','OUT_OF_RANGE','UNKNOWN')),
  captured_at                   TIMESTAMPTZ,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_message                 TEXT,
  device_meta                   JSONB,
  UNIQUE (session_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_audit_loc_session
  ON audit_location_responses (session_id);


-- 1.5 audit_manual_marks ------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_manual_marks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID        NOT NULL REFERENCES audit_sessions(id) ON DELETE CASCADE,
  student_id      TEXT        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id        TEXT        NOT NULL,
  marked_by       TEXT        NOT NULL,
  marked_by_role  TEXT        NOT NULL CHECK (marked_by_role IN ('SUPERVISOR','ADMIN')),
  status          TEXT        NOT NULL CHECK (status IN ('PRESENT','OUTSIDE_APPROVED','OUTSIDE_UNAPPROVED')),
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_audit_manual_session
  ON audit_manual_marks (session_id);

CREATE INDEX IF NOT EXISTS idx_audit_manual_session_class
  ON audit_manual_marks (session_id, class_id);


-- 1.6 audit_alerts ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_alerts (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID        NOT NULL REFERENCES audit_sessions(id) ON DELETE CASCADE,
  student_id    TEXT        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  type          TEXT        NOT NULL CHECK (type IN (
                  'OUT_OF_RANGE','NO_RESPONSE','LOCATION_DENIED',
                  'LOCATION_FAILED','MANUAL_OUTSIDE_UNAPPROVED','LOW_ACCURACY'
                )),
  severity      TEXT        NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  message       TEXT        NOT NULL,
  resolved_at   TIMESTAMPTZ,
  resolved_by   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, student_id, type)
);

CREATE INDEX IF NOT EXISTS idx_audit_alerts_session_open
  ON audit_alerts (session_id) WHERE resolved_at IS NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. updated_at TRIGGERS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION audit_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_sessions_touch ON audit_sessions;
CREATE TRIGGER audit_sessions_touch
  BEFORE UPDATE ON audit_sessions
  FOR EACH ROW EXECUTE FUNCTION audit_touch_updated_at();

DROP TRIGGER IF EXISTS audit_loc_touch ON audit_location_responses;
CREATE TRIGGER audit_loc_touch
  BEFORE UPDATE ON audit_location_responses
  FOR EACH ROW EXECUTE FUNCTION audit_touch_updated_at();

DROP TRIGGER IF EXISTS audit_manual_touch ON audit_manual_marks;
CREATE TRIGGER audit_manual_touch
  BEFORE UPDATE ON audit_manual_marks
  FOR EACH ROW EXECUTE FUNCTION audit_touch_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. VIEWS
-- ─────────────────────────────────────────────────────────────────────────────

-- 3.1 v_audit_live_board — admin live dashboard view --------------------------
CREATE OR REPLACE VIEW v_audit_live_board AS
SELECT
  p.session_id,
  p.id                                       AS participant_id,
  p.student_id,
  p.student_name,
  p.id_number,
  p.grade,
  p.class_id,
  p.expected_state,
  p.approved_departure_id,
  p.approved_departure_label,
  -- Location response
  r.status                                   AS location_status,
  r.lat,
  r.lng,
  r.accuracy_meters,
  r.distance_from_campus_meters,
  r.location_class,
  r.captured_at,
  r.error_message,
  -- Manual mark
  m.status                                   AS manual_status,
  m.marked_by                                AS manual_marked_by,
  m.marked_by_role                           AS manual_marked_by_role,
  m.note                                     AS manual_note,
  m.updated_at                               AS manual_updated_at,
  -- Open alert (most severe one, if any)
  (
    SELECT a.type FROM audit_alerts a
    WHERE a.session_id = p.session_id
      AND a.student_id = p.student_id
      AND a.resolved_at IS NULL
    ORDER BY (CASE a.severity
              WHEN 'CRITICAL' THEN 0
              WHEN 'WARNING'  THEN 1
              WHEN 'INFO'     THEN 2 END), a.created_at DESC
    LIMIT 1
  )                                          AS open_alert_type,
  (
    SELECT a.severity FROM audit_alerts a
    WHERE a.session_id = p.session_id
      AND a.student_id = p.student_id
      AND a.resolved_at IS NULL
    ORDER BY (CASE a.severity
              WHEN 'CRITICAL' THEN 0
              WHEN 'WARNING'  THEN 1
              WHEN 'INFO'     THEN 2 END), a.created_at DESC
    LIMIT 1
  )                                          AS open_alert_severity
FROM audit_participants p
LEFT JOIN audit_location_responses r
  ON r.session_id = p.session_id AND r.student_id = p.student_id
LEFT JOIN audit_manual_marks m
  ON m.session_id = p.session_id AND m.student_id = p.student_id;

GRANT SELECT ON v_audit_live_board TO authenticated;
GRANT SELECT ON v_audit_live_board TO anon;


-- 3.2 v_audit_class_board — supervisor-safe view (no lat/lng) ----------------
CREATE OR REPLACE VIEW v_audit_class_board AS
SELECT
  p.session_id,
  p.id                          AS participant_id,
  p.student_id,
  p.student_name,
  p.id_number,
  p.grade,
  p.class_id,
  p.expected_state,
  p.approved_departure_label,
  r.status                      AS location_status,
  r.location_class,
  r.captured_at,
  m.status                      AS manual_status,
  m.note                        AS manual_note,
  m.updated_at                  AS manual_updated_at
FROM audit_participants p
LEFT JOIN audit_location_responses r
  ON r.session_id = p.session_id AND r.student_id = p.student_id
LEFT JOIN audit_manual_marks m
  ON m.session_id = p.session_id AND m.student_id = p.student_id;

GRANT SELECT ON v_audit_class_board TO authenticated;
GRANT SELECT ON v_audit_class_board TO anon;


-- 3.3 v_audit_history — past sessions list -----------------------------------
CREATE OR REPLACE VIEW v_audit_history AS
SELECT
  s.id,
  s.mode,
  s.status,
  s.title,
  s.started_by,
  s.started_at,
  s.ended_at,
  s.created_at,
  s.threshold_meters,
  s.summary,
  EXTRACT(EPOCH FROM (COALESCE(s.ended_at, NOW()) - COALESCE(s.started_at, s.created_at)))::INT AS duration_seconds,
  (SELECT COUNT(*) FROM audit_participants p WHERE p.session_id = s.id)               AS participants_count,
  (SELECT COUNT(*) FROM audit_session_classes c WHERE c.session_id = s.id)            AS classes_count,
  (SELECT COUNT(*) FROM audit_alerts a WHERE a.session_id = s.id AND a.severity='CRITICAL') AS critical_count
FROM audit_sessions s;

GRANT SELECT ON v_audit_history TO authenticated;
GRANT SELECT ON v_audit_history TO anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPC: create_audit_session
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Creates a DRAFT session, attaches classes, snapshots participants.
-- Returns existing live session if one exists (idempotent guard).
--
CREATE OR REPLACE FUNCTION create_audit_session(
  p_mode      TEXT,
  p_class_ids TEXT[],
  p_title     TEXT DEFAULT NULL,
  p_started_by TEXT DEFAULT 'admin'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id   UUID;
  v_existing     UUID;
  v_class_id     TEXT;
  v_part_count   INT := 0;
  v_class_count  INT := 0;
BEGIN
  IF p_mode NOT IN ('LOCATION','MANUAL') THEN
    RETURN jsonb_build_object('error','invalid_mode');
  END IF;

  IF p_class_ids IS NULL OR array_length(p_class_ids,1) IS NULL THEN
    RETURN jsonb_build_object('error','no_classes');
  END IF;

  -- If a live session already exists, return it (re-attach behavior)
  SELECT id INTO v_existing FROM audit_sessions
  WHERE status IN ('DRAFT','ACTIVE','CLOSING')
  ORDER BY created_at DESC LIMIT 1;

  IF v_existing IS NOT NULL THEN
    SELECT COUNT(*) INTO v_part_count FROM audit_participants WHERE session_id = v_existing;
    SELECT COUNT(*) INTO v_class_count FROM audit_session_classes WHERE session_id = v_existing;
    RETURN jsonb_build_object(
      'sessionId',     v_existing,
      'participants',  v_part_count,
      'classes',       v_class_count,
      'reused',        TRUE
    );
  END IF;

  -- Create session
  INSERT INTO audit_sessions (mode, title, started_by, status)
  VALUES (p_mode, COALESCE(p_title, 'ביקורת פנימית'), p_started_by, 'DRAFT')
  RETURNING id INTO v_session_id;

  -- Attach classes
  FOREACH v_class_id IN ARRAY p_class_ids LOOP
    INSERT INTO audit_session_classes (session_id, grade, class_id)
    SELECT v_session_id, MAX(s.grade), v_class_id
    FROM students s WHERE s."classId" = v_class_id
    HAVING COUNT(*) > 0
    ON CONFLICT (session_id, class_id) DO NOTHING;
    v_class_count := v_class_count + 1;
  END LOOP;

  -- Snapshot participants with active-departure detection
  WITH classes AS (
    SELECT class_id FROM audit_session_classes WHERE session_id = v_session_id
  ),
  active_deps AS (
    SELECT DISTINCT ON (d.student_id)
      d.student_id, d.id AS departure_id,
      to_char(d.end_at AT TIME ZONE 'Asia/Jerusalem','HH24:MI')
        AS end_label
    FROM departures d
    WHERE d.status IN ('ACTIVE','APPROVED')
      AND d.start_at <= NOW()
      AND d.end_at   >  NOW()
    ORDER BY d.student_id, d.created_at DESC
  )
  INSERT INTO audit_participants (
    session_id, student_id, student_name, id_number, grade, class_id,
    baseline_status, approved_departure_id, approved_departure_label, expected_state
  )
  SELECT
    v_session_id,
    s.id,
    s."fullName",
    s."idNumber",
    s."grade",
    s."classId",
    s."currentStatus",
    ad.departure_id,
    CASE WHEN ad.departure_id IS NOT NULL
         THEN 'יציאה מאושרת עד ' || ad.end_label ELSE NULL END,
    CASE WHEN ad.departure_id IS NOT NULL
         THEN 'APPROVED_OUTSIDE' ELSE 'EXPECTED_ON_CAMPUS' END
  FROM students s
  JOIN classes c ON c.class_id = s."classId"
  LEFT JOIN active_deps ad ON ad.student_id = s.id
  ON CONFLICT (session_id, student_id) DO NOTHING;

  SELECT COUNT(*) INTO v_part_count FROM audit_participants WHERE session_id = v_session_id;
  SELECT COUNT(*) INTO v_class_count FROM audit_session_classes WHERE session_id = v_session_id;

  RETURN jsonb_build_object(
    'sessionId',    v_session_id,
    'participants', v_part_count,
    'classes',      v_class_count,
    'reused',       FALSE
  );
END;
$$;

REVOKE ALL ON FUNCTION create_audit_session(TEXT, TEXT[], TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_audit_session(TEXT, TEXT[], TEXT, TEXT) TO authenticated, anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RPC: activate_audit_session
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION activate_audit_session(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode TEXT;
BEGIN
  SELECT mode INTO v_mode FROM audit_sessions WHERE id = p_session_id;
  IF v_mode IS NULL THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;

  UPDATE audit_sessions
     SET status     = 'ACTIVE',
         started_at = COALESCE(started_at, NOW())
   WHERE id = p_session_id;

  -- Seed location-response rows for LOCATION-mode sessions
  -- (skip participants who already have APPROVED_OUTSIDE baseline)
  IF v_mode = 'LOCATION' THEN
    INSERT INTO audit_location_responses (session_id, student_id, status)
    SELECT p.session_id, p.student_id, 'REQUEST_SENT'
    FROM audit_participants p
    WHERE p.session_id = p_session_id
      AND p.expected_state = 'EXPECTED_ON_CAMPUS'
    ON CONFLICT (session_id, student_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('sessionId', p_session_id, 'status', 'ACTIVE');
END;
$$;

REVOKE ALL ON FUNCTION activate_audit_session(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION activate_audit_session(UUID) TO authenticated, anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RPC: record_audit_app_opened
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION record_audit_app_opened(
  p_session_id UUID,
  p_student_id TEXT,
  p_device_meta JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only record APP_OPENED if no terminal state already present
  INSERT INTO audit_location_responses (session_id, student_id, status, device_meta)
  VALUES (p_session_id, p_student_id, 'APP_OPENED', p_device_meta)
  ON CONFLICT (session_id, student_id) DO UPDATE
    SET status = CASE
        WHEN audit_location_responses.status IN ('GRANTED','DENIED_BY_USER','LOW_ACCURACY')
          THEN audit_location_responses.status
        ELSE 'APP_OPENED' END,
        device_meta = COALESCE(EXCLUDED.device_meta, audit_location_responses.device_meta);

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION record_audit_app_opened(UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_audit_app_opened(UUID, TEXT, JSONB) TO authenticated, anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RPC: record_audit_location_response
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Called by the student app after geolocation completes (or fails).
-- Computes distance/class server-side and raises alerts atomically.
--
CREATE OR REPLACE FUNCTION record_audit_location_response(
  p_session_id    UUID,
  p_student_id    TEXT,
  p_lat           DOUBLE PRECISION,
  p_lng           DOUBLE PRECISION,
  p_accuracy      DOUBLE PRECISION,
  p_gps_status    TEXT,
  p_error_message TEXT DEFAULT NULL,
  p_device_meta   JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campus_lat        CONSTANT DOUBLE PRECISION := 31.5253;
  v_campus_lng        CONSTANT DOUBLE PRECISION := 35.1056;
  v_low_accuracy_m    CONSTANT DOUBLE PRECISION := 200;
  v_threshold         INT;
  v_distance          INT;
  v_location_class    TEXT;
  v_session_status    TEXT;
  v_expected_state    TEXT;
  v_low_confidence    BOOLEAN := FALSE;
  v_status            TEXT;
BEGIN
  SELECT status, threshold_meters INTO v_session_status, v_threshold
  FROM audit_sessions WHERE id = p_session_id;
  IF v_session_status IS NULL THEN
    RETURN jsonb_build_object('error','session_not_found');
  END IF;
  IF v_session_status NOT IN ('ACTIVE','CLOSING') THEN
    RETURN jsonb_build_object('error','session_not_active');
  END IF;

  SELECT expected_state INTO v_expected_state
  FROM audit_participants
  WHERE session_id = p_session_id AND student_id = p_student_id;
  IF v_expected_state IS NULL THEN
    RETURN jsonb_build_object('error','participant_not_found');
  END IF;

  -- Compute classification only for successful GPS
  IF p_gps_status = 'GRANTED' AND p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    v_distance := ROUND(
      6371000 * 2 * ASIN(SQRT(
        POWER(SIN(RADIANS((p_lat - v_campus_lat) / 2)), 2) +
        COS(RADIANS(v_campus_lat)) * COS(RADIANS(p_lat)) *
        POWER(SIN(RADIANS((p_lng - v_campus_lng) / 2)), 2)
      ))
    );
    IF v_distance <= 300 THEN
      v_location_class := 'ON_CAMPUS';
    ELSIF v_distance <= v_threshold THEN
      v_location_class := 'NEAR_CAMPUS';
    ELSE
      v_location_class := 'OUT_OF_RANGE';
    END IF;
    -- Low accuracy → degrade GRANTED to LOW_ACCURACY
    IF p_accuracy IS NOT NULL AND p_accuracy > v_low_accuracy_m THEN
      v_low_confidence := TRUE;
      v_status := 'LOW_ACCURACY';
    ELSE
      v_status := 'GRANTED';
    END IF;
  ELSE
    v_location_class := 'UNKNOWN';
    v_status := p_gps_status;
  END IF;

  INSERT INTO audit_location_responses (
    session_id, student_id, status,
    lat, lng, accuracy_meters,
    distance_from_campus_meters, location_class,
    captured_at, error_message, device_meta
  )
  VALUES (
    p_session_id, p_student_id, v_status,
    p_lat, p_lng, p_accuracy,
    v_distance, v_location_class,
    NOW(), p_error_message, p_device_meta
  )
  ON CONFLICT (session_id, student_id) DO UPDATE
    SET status                       = EXCLUDED.status,
        lat                          = EXCLUDED.lat,
        lng                          = EXCLUDED.lng,
        accuracy_meters              = EXCLUDED.accuracy_meters,
        distance_from_campus_meters  = EXCLUDED.distance_from_campus_meters,
        location_class               = EXCLUDED.location_class,
        captured_at                  = EXCLUDED.captured_at,
        error_message                = EXCLUDED.error_message,
        device_meta                  = COALESCE(EXCLUDED.device_meta, audit_location_responses.device_meta);

  -- Alert rules ----------------------------------------------------------------
  -- OUT_OF_RANGE → critical only if no approved departure
  IF v_location_class = 'OUT_OF_RANGE' AND v_expected_state = 'EXPECTED_ON_CAMPUS' THEN
    INSERT INTO audit_alerts (session_id, student_id, type, severity, message)
    VALUES (p_session_id, p_student_id, 'OUT_OF_RANGE', 'CRITICAL',
            'התלמיד נמצא במרחק ' || v_distance || ' מטר מהישיבה ללא יציאה מאושרת')
    ON CONFLICT (session_id, student_id, type) DO NOTHING;
  END IF;

  IF p_gps_status = 'DENIED_BY_USER' THEN
    INSERT INTO audit_alerts (session_id, student_id, type, severity, message)
    VALUES (p_session_id, p_student_id, 'LOCATION_DENIED','WARNING',
            'התלמיד דחה את בקשת הרשאת המיקום')
    ON CONFLICT (session_id, student_id, type) DO NOTHING;
  ELSIF p_gps_status IN ('UNAVAILABLE','TIMEOUT','FAILED') THEN
    INSERT INTO audit_alerts (session_id, student_id, type, severity, message)
    VALUES (p_session_id, p_student_id, 'LOCATION_FAILED','WARNING',
            COALESCE(p_error_message, 'לא ניתן לקבל מיקום מהמכשיר'))
    ON CONFLICT (session_id, student_id, type) DO NOTHING;
  END IF;

  IF v_low_confidence THEN
    INSERT INTO audit_alerts (session_id, student_id, type, severity, message)
    VALUES (p_session_id, p_student_id, 'LOW_ACCURACY','INFO',
            'דיוק מיקום נמוך (' || ROUND(p_accuracy::numeric) || ' מטר)')
    ON CONFLICT (session_id, student_id, type) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'ok',             TRUE,
    'status',         v_status,
    'locationClass',  v_location_class,
    'distance',       v_distance
  );
END;
$$;

REVOKE ALL ON FUNCTION record_audit_location_response(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_audit_location_response(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, JSONB) TO authenticated, anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. RPC: record_manual_audit_mark
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION record_manual_audit_mark(
  p_session_id    UUID,
  p_student_id    TEXT,
  p_status        TEXT,
  p_marked_by     TEXT,
  p_marked_by_role TEXT DEFAULT 'SUPERVISOR',
  p_note          TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class_id       TEXT;
  v_session_status TEXT;
BEGIN
  IF p_status NOT IN ('PRESENT','OUTSIDE_APPROVED','OUTSIDE_UNAPPROVED') THEN
    RETURN jsonb_build_object('error','invalid_status');
  END IF;
  IF p_marked_by_role NOT IN ('SUPERVISOR','ADMIN') THEN
    RETURN jsonb_build_object('error','invalid_role');
  END IF;

  SELECT status INTO v_session_status FROM audit_sessions WHERE id = p_session_id;
  IF v_session_status IS NULL THEN
    RETURN jsonb_build_object('error','session_not_found');
  END IF;
  IF v_session_status NOT IN ('ACTIVE','CLOSING') THEN
    RETURN jsonb_build_object('error','session_not_active');
  END IF;

  SELECT class_id INTO v_class_id
  FROM audit_participants WHERE session_id = p_session_id AND student_id = p_student_id;
  IF v_class_id IS NULL THEN
    RETURN jsonb_build_object('error','participant_not_found');
  END IF;

  INSERT INTO audit_manual_marks (
    session_id, student_id, class_id, marked_by, marked_by_role, status, note
  ) VALUES (
    p_session_id, p_student_id, v_class_id, p_marked_by, p_marked_by_role, p_status, p_note
  )
  ON CONFLICT (session_id, student_id) DO UPDATE
    SET status         = EXCLUDED.status,
        marked_by      = EXCLUDED.marked_by,
        marked_by_role = EXCLUDED.marked_by_role,
        note           = EXCLUDED.note;

  -- Alert handling: OUTSIDE_UNAPPROVED creates critical alert
  IF p_status = 'OUTSIDE_UNAPPROVED' THEN
    INSERT INTO audit_alerts (session_id, student_id, type, severity, message)
    VALUES (p_session_id, p_student_id, 'MANUAL_OUTSIDE_UNAPPROVED','CRITICAL',
            'אחראי הכיתה סימן: בחוץ ללא אישור')
    ON CONFLICT (session_id, student_id, type) DO UPDATE
      SET resolved_at = NULL, resolved_by = NULL;
  END IF;

  -- PRESENT resolves NO_RESPONSE / LOCATION_FAILED / LOCATION_DENIED alerts
  IF p_status IN ('PRESENT','OUTSIDE_APPROVED') THEN
    UPDATE audit_alerts
       SET resolved_at = NOW(), resolved_by = p_marked_by
     WHERE session_id = p_session_id
       AND student_id = p_student_id
       AND type IN ('NO_RESPONSE','LOCATION_FAILED','LOCATION_DENIED','MANUAL_OUTSIDE_UNAPPROVED')
       AND resolved_at IS NULL;
  END IF;

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION record_manual_audit_mark(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_manual_audit_mark(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- 9. RPC: complete_audit_session
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION complete_audit_session(
  p_session_id UUID,
  p_actor_id   TEXT DEFAULT 'admin'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_summary JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM audit_sessions WHERE id = p_session_id) THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;

  -- Build summary BEFORE flipping status (so view counts are stable)
  SELECT jsonb_build_object(
    'totalParticipants',  (SELECT COUNT(*) FROM audit_participants p WHERE p.session_id = p_session_id),
    'totalClasses',       (SELECT COUNT(*) FROM audit_session_classes c WHERE c.session_id = p_session_id),
    'approvedOutside',    (SELECT COUNT(*) FROM audit_participants p WHERE p.session_id = p_session_id AND p.expected_state = 'APPROVED_OUTSIDE'),
    'onCampusByLocation', (SELECT COUNT(*) FROM audit_location_responses r WHERE r.session_id = p_session_id AND r.location_class = 'ON_CAMPUS'),
    'outOfRange',         (SELECT COUNT(*) FROM audit_alerts a WHERE a.session_id = p_session_id AND a.type='OUT_OF_RANGE'),
    'manualPresent',      (SELECT COUNT(*) FROM audit_manual_marks m WHERE m.session_id = p_session_id AND m.status='PRESENT'),
    'manualOutsideApproved',   (SELECT COUNT(*) FROM audit_manual_marks m WHERE m.session_id = p_session_id AND m.status='OUTSIDE_APPROVED'),
    'manualOutsideUnapproved', (SELECT COUNT(*) FROM audit_manual_marks m WHERE m.session_id = p_session_id AND m.status='OUTSIDE_UNAPPROVED'),
    'noResponse',         (SELECT COUNT(*) FROM audit_location_responses r WHERE r.session_id = p_session_id AND r.status IN ('REQUEST_SENT','PENDING')),
    'criticalAlerts',     (SELECT COUNT(*) FROM audit_alerts a WHERE a.session_id = p_session_id AND a.severity='CRITICAL'),
    'warningAlerts',      (SELECT COUNT(*) FROM audit_alerts a WHERE a.session_id = p_session_id AND a.severity='WARNING')
  ) INTO v_summary;

  UPDATE audit_sessions
     SET status   = 'COMPLETED',
         ended_at = NOW(),
         summary  = v_summary
   WHERE id = p_session_id;

  RETURN jsonb_build_object('ok', TRUE, 'summary', v_summary);
END;
$$;

REVOKE ALL ON FUNCTION complete_audit_session(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_audit_session(UUID, TEXT) TO authenticated, anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- 10. RPC: cancel_audit_session
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cancel_audit_session(p_session_id UUID, p_actor_id TEXT DEFAULT 'admin')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE audit_sessions
     SET status   = 'CANCELLED',
         ended_at = NOW()
   WHERE id = p_session_id
     AND status IN ('DRAFT','ACTIVE','CLOSING');
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION cancel_audit_session(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_audit_session(UUID, TEXT) TO authenticated, anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- 11. RPC: get_active_audit_session
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_active_audit_session()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session JSONB;
BEGIN
  SELECT to_jsonb(s) INTO v_session
  FROM audit_sessions s
  WHERE s.status IN ('DRAFT','ACTIVE','CLOSING')
  ORDER BY s.created_at DESC LIMIT 1;
  RETURN COALESCE(v_session, 'null'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION get_active_audit_session() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_active_audit_session() TO authenticated, anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- 12. PERMISSIONS — table-level grants (anon used since app uses anon JWT)
-- ─────────────────────────────────────────────────────────────────────────────
GRANT SELECT ON audit_sessions, audit_session_classes, audit_participants,
                audit_location_responses, audit_manual_marks, audit_alerts
  TO authenticated, anon;


-- =============================================================================
-- End of migration
-- =============================================================================
