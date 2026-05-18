-- Audit Phase 1 — Fix the audit_alerts trigger to skip NULL distance_bucket rows
--
-- Bug discovered while smoke-testing start_audit_session: AUTO_DEFAULT entries
-- (pre-seeded for students with an ACTIVE departure at session start) have
-- distance_bucket = NULL. The trigger's condition was
--   v_should_alert := NEW.distance_bucket IN ('ORANGE','RED');
-- which evaluates to NULL under SQL's three-valued logic. `IF NULL THEN ...`
-- does NOT take the branch, so flow falls through to the unconditional INSERT
-- into audit_alerts — which CHECKs distance_bucket NOT NULL and crashes the
-- entire start_audit_session call.
--
-- Net effect before the fix: opening a MANUAL audit on any class with even one
-- ACTIVE departure produced a server error instead of a session row.

BEGIN;

CREATE OR REPLACE FUNCTION public.tg_audit_entries_alert_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_session   audit_sessions%ROWTYPE;
  v_snap_rec  JSONB;
  v_should_alert BOOLEAN := FALSE;
BEGIN
  -- Early-out for entries without a populated bucket. AUTO_DEFAULT seeds and
  -- supervisor MANUAL marks both arrive with distance_bucket = NULL — only
  -- LOCATION-mode entries with collected GPS will set the bucket.
  IF NEW.distance_bucket IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_should_alert := NEW.distance_bucket IN ('ORANGE','RED');
  ELSIF TG_OP = 'UPDATE' THEN
    v_should_alert := (OLD.distance_bucket IS DISTINCT FROM NEW.distance_bucket)
                  AND (NEW.distance_bucket IN ('ORANGE','RED'));
  END IF;

  IF NOT v_should_alert THEN RETURN NEW; END IF;

  SELECT * INTO v_session FROM audit_sessions WHERE id = NEW.session_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT snap INTO v_snap_rec
  FROM jsonb_array_elements(v_session.student_snapshot) WITH ORDINALITY AS arr(snap, idx)
  WHERE (idx - 1)::INT = NEW.student_snapshot_idx LIMIT 1;

  INSERT INTO audit_alerts (
    session_id, entry_id, student_id, student_name, class_id,
    distance_bucket, distance_m, gps_lat, gps_lng
  ) VALUES (
    NEW.session_id, NEW.id, NEW.student_id,
    COALESCE(v_snap_rec->>'fullName', ''),
    NEW.class_id, NEW.distance_bucket,
    NEW.distance_from_campus_m, NEW.gps_lat, NEW.gps_lng
  );

  RETURN NEW;
END; $$;

COMMIT;
