-- §24/A3 — one ACTIVE assignment per slot; terminal states must not block re-fill.
CREATE UNIQUE INDEX IF NOT EXISTS uq_assignments_active_slot
  ON assignments (slot_id)
  WHERE status IN (
    'assigned','confirmed','in_progress','paused',
    'awaiting_employer_confirm','awaiting_worker_confirm',
    'awaiting_ops_review','completed','in_review_window','disputed'
  );

-- §24/A5 — one ACTIVE application per (job, worker); allow re-apply after terminal.
CREATE UNIQUE INDEX IF NOT EXISTS uq_applications_active
  ON applications (job_id, worker_id)
  WHERE status IN ('pending','shortlisted','accepted');

-- §24/A2 — deferred balance check on ledger_entries (every txn_id sums to 0).
-- Service layer should ALSO use a LedgerTransaction helper for correctness by construction (§26/M2).
CREATE OR REPLACE FUNCTION ledger_balanced_check() RETURNS trigger AS $$
DECLARE
  s BIGINT;
BEGIN
  SELECT COALESCE(SUM(amount_minor), 0) INTO s
  FROM ledger_entries WHERE txn_id = NEW.txn_id;
  IF s <> 0 THEN
    RAISE EXCEPTION 'ledger_entries imbalance: txn_id=% sum=%', NEW.txn_id, s;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledger_balanced ON ledger_entries;
CREATE CONSTRAINT TRIGGER trg_ledger_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_balanced_check();

-- §26/M9 — banned CNIC enforcement (also a runtime guard, but the constraint is durable).
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_cnic_hash
  ON users (cnic_hash) WHERE cnic_hash IS NOT NULL;

-- §27 — fast feed by location + status.
-- PostGIS spatial index can't be expressed in Prisma; add it here.
ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS geog geography(Point, 4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng::double precision, lat::double precision), 4326)::geography) STORED;

CREATE INDEX IF NOT EXISTS idx_locations_geog ON locations USING GIST (geog);
