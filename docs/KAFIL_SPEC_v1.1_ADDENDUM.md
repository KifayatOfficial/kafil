# KAFIL — Spec v1.1: Risk, Logic, Data Model & Systems Addendum

**Version:** 1.1 (addendum to v1.0)
**Date:** June 2026
**Status:** Pre-build — this document supersedes v1.0 wherever they conflict.
**Author:** Engineering (SME review of v1.0)

---

## 0. HOW TO READ THIS DOCUMENT

v1.0 is a strong **business** document. It describes a feature list and a happy path. It is **not yet a buildable system**, because a marketplace that handles money, reputation, and adversarial users is ~20% feature list and ~80% the unhappy paths: fraud, no-shows, cancellations, disputes, races, leakage, and offline failure.

This addendum fixes **every** material issue, organized so you can act on it:

- **§1 Architectural principles** — the invariants every later section depends on. Read first.
- **§2 Corrected data model** — replaces v1.0's schema entirely. It had compile-blocking bugs.
- **§3 Identity & roles** — the single most consequential modeling fix.
- **§4 Job lifecycle state machine** — the logic v1.0 was missing.
- **§5 Anti-disintermediation** — the fix for the issue that otherwise zeroes out revenue.
- **§6 Money: ledger, escrow, commission, payouts.**
- **§7 Reputation & reviews.**
- **§8 Matching & ranking.**
- **§9 Trust & Safety + §10 Fraud threat model.**
- **§11 Notifications (WhatsApp reality).**
- **§12 Localization & accessibility.**
- **§13 Offline & sync.**
- **§14 Concurrency correctness.**
- **§15 Liquidity / cold-start.**
- **§16 Observability.** **§17 Compliance.** **§18 Ops back-office.**
- **§19 Prioritized backlog** — what blocks MVP vs. fast-follow vs. later.

Every section states the **problem**, the **fix**, and concrete **schema / state / interface** so it can go straight into code.

---

## 1. ARCHITECTURAL PRINCIPLES (the future-proofing foundation)

These are non-negotiable invariants. Most "future-proofing" failures come from violating one of these early and paying for it for years.

### P1 — One identity, many roles
A person in Swat is a worker today and an employer next week. Model **one `User`** with attached **roles and role-specific profiles**. Never split "workers" and "employers" into separate identity tables. (Detail in §3.)

### P2 — Layered, swappable boundaries
`route handler → service → repository → datastore`. Business rules live only in services. SQL lives only in repositories. External services (SMS/WhatsApp, storage, payments, geocoding) live behind **provider interfaces** so they can be stubbed locally and swapped in prod (SQLite→Postgres/Supabase, console-SMS→Twilio, local-disk→S3). This is what lets the app run in a network-restricted dev box today and scale later without rewrites.

### P3 — Money and state changes are events, never in-place mutations alone
Every state transition and every money movement writes an **append-only event/ledger row** in the same DB transaction as the state change. This gives you: audit trail for disputes, replayability, analytics, and the ability to reconstruct "who did what when." Disputes are unwinnable without this.

### P4 — Idempotency everywhere a client can retry
On 2G/3G, every mutating request **will** be sent twice. Every mutating endpoint accepts an `Idempotency-Key`; the server deduplicates. Apply, accept, complete, pay, review — all idempotent. (Detail in §13, §14.)

### P5 — Optimistic concurrency on contended rows
Jobs, slots, applications, wallets carry a `version` (or use row-level locks / conditional updates). Two employers accepting the same worker, or a worker applying twice, must fail safely, not corrupt state. (Detail in §14.)

### P6 — Privacy and contact info are platform assets, not given away
PII (phone numbers, exact location) is revealed only when the platform has captured its value, and ideally only via masked/proxy channels. This is both a privacy control and the core anti-leakage mechanism. (Detail in §5.)

### P7 — Trust & Safety is a first-class subsystem, not a moderation checkbox
Reports, fraud signals, bans, appeals, and an ops workbench are designed in from MVP, because fraud arrives in week one. (Detail in §9, §10, §18.)

### P8 — Every critical user action emits a typed analytics event
You cannot improve retention you cannot see. The event taxonomy (§16) is part of the schema, not an afterthought.

---

## 2. CORRECTED DATA MODEL

> This **replaces** the v1.0 schema. v1.0 had: a missing `employers` table referenced by a foreign key (the core posting flow could not compile), split worker/employer identities, FK-less ratings, no messages table, no multi-worker jobs, a boolean-ish availability field, geospatial with no spatial support, and no idempotency/versioning/audit. All fixed below.

Notation: PostgreSQL dialect (prod). For local dev on SQLite the same model is expressed via Prisma; `POINT`/PostGIS becomes lat/lng columns + an app-side haversine until Postgres is wired. Defaults, timestamps, and soft-delete (`deleted_at`) assumed on all tables.

### 2.1 Identity & roles

```sql
-- One human, one row. Phone is the natural key but may change (SIM swaps).
CREATE TABLE users (
  id              UUID PRIMARY KEY,
  phone_e164      VARCHAR(20) UNIQUE NOT NULL,   -- normalized +92...
  phone_verified_at TIMESTAMPTZ,
  display_name    VARCHAR(120) NOT NULL,
  photo_url       TEXT,
  preferred_lang  VARCHAR(8) DEFAULT 'ps',       -- ps | ur | en
  status          VARCHAR(20) NOT NULL DEFAULT 'active', -- active|suspended|banned|deactivated
  status_reason   TEXT,
  cnic_hash       VARCHAR(128),                  -- hashed CNIC if KYC done; never store raw
  kyc_level       SMALLINT NOT NULL DEFAULT 0,   -- 0 none, 1 phone, 2 CNIC, 3 verified job history
  trust_score     INT NOT NULL DEFAULT 0,        -- derived, see §9
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  version         INT NOT NULL DEFAULT 0
);

-- A user can hold multiple roles simultaneously.
CREATE TABLE user_roles (
  user_id   UUID NOT NULL REFERENCES users(id),
  role      VARCHAR(20) NOT NULL,   -- worker | employer | shop_owner | admin | moderator | support
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

-- Worker-specific profile (1:1 with a user who has the 'worker' role).
CREATE TABLE worker_profiles (
  user_id          UUID PRIMARY KEY REFERENCES users(id),
  bio              TEXT,
  experience_years SMALLINT,
  rate_min_pkr     INT,             -- guidance only; per-job rate negotiated
  rate_max_pkr     INT,
  base_location_id UUID REFERENCES locations(id),
  -- derived reputation snapshot (recomputed; source of truth is reviews + jobs)
  rating_bayesian  NUMERIC(4,3) DEFAULT 0,   -- see §7
  jobs_completed   INT DEFAULT 0,
  no_show_count    INT DEFAULT 0,
  cancel_late_count INT DEFAULT 0,
  completion_rate  NUMERIC(4,3),
  response_rate    NUMERIC(4,3),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Specialties are a controlled vocabulary, not free-text arrays (filtering, i18n, ranking).
CREATE TABLE specialties (
  id        UUID PRIMARY KEY,
  slug      VARCHAR(40) UNIQUE NOT NULL,   -- 'masonry', 'electrician'
  name_ps   VARCHAR(80), name_ur VARCHAR(80), name_en VARCHAR(80),
  icon      VARCHAR(40),                   -- for low-literacy UI
  active     BOOLEAN DEFAULT true
);
CREATE TABLE worker_specialties (
  user_id      UUID NOT NULL REFERENCES users(id),
  specialty_id UUID NOT NULL REFERENCES specialties(id),
  PRIMARY KEY (user_id, specialty_id)
);

-- Employer-specific profile.
CREATE TABLE employer_profiles (
  user_id       UUID PRIMARY KEY REFERENCES users(id),
  employer_type VARCHAR(30),   -- contractor | homeowner | business | hotel | farm
  org_name      VARCHAR(160),
  base_location_id UUID REFERENCES locations(id),
  rating_bayesian NUMERIC(4,3) DEFAULT 0,
  jobs_posted   INT DEFAULT 0,
  payment_reliability NUMERIC(4,3),  -- did they pay/remit? key trust signal
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.2 Location (landmark-based, not addresses — see §12)

```sql
CREATE TABLE locations (
  id            UUID PRIMARY KEY,
  label         TEXT,                 -- "near 3rd mosque, Hayatabad" (user words, any lang)
  district      VARCHAR(80),          -- Swat, Peshawar...
  tehsil        VARCHAR(80),          -- Babuzai, Kabal...
  lat           NUMERIC(9,6),
  lng           NUMERIC(9,6),
  geog          GEOGRAPHY(POINT,4326),-- PostGIS; GENERATED from lat/lng in prod
  precision     VARCHAR(20) DEFAULT 'pin', -- pin | landmark | tehsil_centroid
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_locations_geog ON locations USING GIST (geog);  -- spatial index (v1.0 had none)
```

### 2.3 Jobs, slots, assignments (multi-worker capable — v1.0 could not represent "need 3 masons")

```sql
CREATE TABLE jobs (
  id                UUID PRIMARY KEY,
  employer_id       UUID NOT NULL REFERENCES users(id),   -- FK now valid (was -> missing table)
  title             VARCHAR(200) NOT NULL,
  description        TEXT,
  description_audio_url TEXT,        -- low-literacy: voice description (§12)
  location_id       UUID NOT NULL REFERENCES locations(id),
  headcount         SMALLINT NOT NULL DEFAULT 1,           -- "3 masons"
  rate_pkr          INT NOT NULL,
  rate_unit         VARCHAR(10) NOT NULL DEFAULT 'day',    -- day | job | hour
  duration_days     SMALLINT,
  start_date        DATE,
  status            VARCHAR(24) NOT NULL DEFAULT 'draft',  -- see §4 state machine
  expires_at        TIMESTAMPTZ,                           -- stale-post reaping (v1.0 missing)
  photos            JSONB DEFAULT '[]',
  payment_mode      VARCHAR(16) NOT NULL DEFAULT 'cash',   -- cash | escrow (§6)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  version           INT NOT NULL DEFAULT 0                 -- optimistic lock (§14)
);
CREATE TABLE job_specialties (
  job_id UUID NOT NULL REFERENCES jobs(id),
  specialty_id UUID NOT NULL REFERENCES specialties(id),
  PRIMARY KEY (job_id, specialty_id)
);

-- One slot per needed worker. This is what makes headcount real and prevents over-hiring races.
CREATE TABLE job_slots (
  id          UUID PRIMARY KEY,
  job_id      UUID NOT NULL REFERENCES jobs(id),
  slot_index  SMALLINT NOT NULL,                  -- 1..headcount
  status      VARCHAR(20) NOT NULL DEFAULT 'open',-- open | filled | completed | cancelled
  assigned_worker_id UUID REFERENCES users(id),
  version     INT NOT NULL DEFAULT 0,
  UNIQUE(job_id, slot_index)
);

-- An assignment = a worker committed to a slot. The "in_progress" unit of work.
CREATE TABLE assignments (
  id            UUID PRIMARY KEY,
  job_id        UUID NOT NULL REFERENCES jobs(id),
  slot_id       UUID NOT NULL REFERENCES job_slots(id),
  worker_id     UUID NOT NULL REFERENCES users(id),
  status        VARCHAR(24) NOT NULL DEFAULT 'assigned', -- see §4
  agreed_rate_pkr INT NOT NULL,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  worker_marked_done_at   TIMESTAMPTZ,
  employer_marked_done_at TIMESTAMPTZ,
  version       INT NOT NULL DEFAULT 0,
  UNIQUE(slot_id)            -- a slot can hold at most one active assignment
);
```

### 2.4 Applications (idempotent, race-safe)

```sql
CREATE TABLE applications (
  id          UUID PRIMARY KEY,
  job_id      UUID NOT NULL REFERENCES jobs(id),
  worker_id   UUID NOT NULL REFERENCES users(id),
  status      VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|shortlisted|accepted|rejected|withdrawn|expired
  message     TEXT,
  proposed_rate_pkr INT,
  idempotency_key VARCHAR(80),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at  TIMESTAMPTZ,
  UNIQUE(job_id, worker_id)            -- one application per worker per job
);
```

### 2.5 Reviews (double-blind, role-aware, FK-backed — fixes v1.0's bare-UUID ratings)

```sql
CREATE TABLE reviews (
  id            UUID PRIMARY KEY,
  assignment_id UUID NOT NULL REFERENCES assignments(id),
  author_id     UUID NOT NULL REFERENCES users(id),
  subject_id    UUID NOT NULL REFERENCES users(id),
  direction     VARCHAR(24) NOT NULL,  -- employer_on_worker | worker_on_employer
  rating        SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  -- double-blind reveal (§7): hidden until both sides submit OR window closes
  visible_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (author_id <> subject_id),     -- no self-rating (v1.0 allowed it)
  UNIQUE(assignment_id, author_id)     -- one review per side per assignment
);
```

### 2.6 Availability calendar (replaces v1.0's single VARCHAR flag → enables "available next Tuesday")

```sql
CREATE TABLE worker_availability (
  id        UUID PRIMARY KEY,
  worker_id UUID NOT NULL REFERENCES users(id),
  day       DATE NOT NULL,
  state     VARCHAR(12) NOT NULL DEFAULT 'available', -- available | busy | tentative
  source    VARCHAR(16) NOT NULL DEFAULT 'manual',    -- manual | derived(from assignment)
  UNIQUE(worker_id, day)
);
```

### 2.7 Messaging (was entirely missing; also the anti-leakage channel, §5)

```sql
CREATE TABLE conversations (
  id          UUID PRIMARY KEY,
  job_id      UUID REFERENCES jobs(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE conversation_participants (
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  user_id         UUID NOT NULL REFERENCES users(id),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE messages (
  id              UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  sender_id       UUID NOT NULL REFERENCES users(id),
  body            TEXT,
  body_redacted   TEXT,                  -- after PII/contact stripping (§5)
  flagged         BOOLEAN DEFAULT false, -- contained phone/scam pattern
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.8 Shops, groups, posts, comments (kept, with FKs + moderation hooks)

```sql
CREATE TABLE shops (
  id            UUID PRIMARY KEY,
  owner_id      UUID NOT NULL REFERENCES users(id),
  name          VARCHAR(200) NOT NULL,
  description   TEXT,
  location_id   UUID REFERENCES locations(id),
  categories    JSONB DEFAULT '[]',
  photos        JSONB DEFAULT '[]',
  hours         JSONB,                   -- structured, not "8am-6pm" string
  rating_bayesian NUMERIC(4,3) DEFAULT 0,
  verified_tier VARCHAR(16) DEFAULT 'free', -- free | verified | featured (§ monetization)
  status        VARCHAR(16) DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE groups (
  id          UUID PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  category    VARCHAR(20),    -- geographic | trade | interest
  location_id UUID REFERENCES locations(id),
  created_by  UUID NOT NULL REFERENCES users(id),
  status      VARCHAR(16) DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE posts (
  id        UUID PRIMARY KEY,
  group_id  UUID NOT NULL REFERENCES groups(id),
  author_id UUID NOT NULL REFERENCES users(id),
  body      TEXT,
  images    JSONB DEFAULT '[]',
  pinned    BOOLEAN DEFAULT false,
  status    VARCHAR(16) DEFAULT 'visible', -- visible | hidden | removed
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE comments (
  id        UUID PRIMARY KEY,
  post_id   UUID NOT NULL REFERENCES posts(id),
  author_id UUID NOT NULL REFERENCES users(id),
  body      TEXT,
  status    VARCHAR(16) DEFAULT 'visible',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.9 Money: double-entry ledger, wallets, payments, payouts (§6)

```sql
CREATE TABLE wallets (
  id        UUID PRIMARY KEY,
  user_id   UUID REFERENCES users(id),     -- null for platform/system wallets
  kind      VARCHAR(24) NOT NULL,          -- user | platform_revenue | escrow_holding | payment_gateway_clearing
  currency  CHAR(3) NOT NULL DEFAULT 'PKR',
  balance_minor BIGINT NOT NULL DEFAULT 0, -- store paisa (minor units), never floats
  version   INT NOT NULL DEFAULT 0,
  UNIQUE(user_id, kind)
);

-- Double-entry: every movement is two+ rows summing to zero per transaction.
CREATE TABLE ledger_entries (
  id            UUID PRIMARY KEY,
  txn_id        UUID NOT NULL,             -- groups the balanced set
  wallet_id     UUID NOT NULL REFERENCES wallets(id),
  amount_minor  BIGINT NOT NULL,           -- signed; sum per txn_id = 0
  reason        VARCHAR(40) NOT NULL,      -- escrow_fund | escrow_release | commission | payout | refund | reversal
  ref_type      VARCHAR(24),               -- job | assignment | dispute | payout
  ref_id        UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payments (              -- inbound money (employer funds escrow / pays commission)
  id            UUID PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id),
  amount_minor  BIGINT NOT NULL,
  provider      VARCHAR(20),         -- jazzcash | easypaisa | bank | manual
  provider_ref  VARCHAR(120),
  status        VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|succeeded|failed|reversed
  idempotency_key VARCHAR(80) UNIQUE,
  ref_type      VARCHAR(24), ref_id UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE payouts (               -- outbound money (platform pays worker)
  id            UUID PRIMARY KEY,
  worker_id     UUID NOT NULL REFERENCES users(id),
  amount_minor  BIGINT NOT NULL,
  provider      VARCHAR(20),
  provider_ref  VARCHAR(120),
  status        VARCHAR(20) NOT NULL DEFAULT 'pending',
  idempotency_key VARCHAR(80) UNIQUE,
  ref_type      VARCHAR(24), ref_id UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.10 Disputes (the thing the read-only admin dashboard could not run)

```sql
CREATE TABLE disputes (
  id            UUID PRIMARY KEY,
  assignment_id UUID NOT NULL REFERENCES assignments(id),
  opened_by     UUID NOT NULL REFERENCES users(id),
  category      VARCHAR(30) NOT NULL,  -- non_payment | no_show | quality | amount | safety | fraud
  status        VARCHAR(20) NOT NULL DEFAULT 'open', -- open|investigating|awaiting_party|resolved|escalated_jirga|closed
  assigned_agent UUID REFERENCES users(id),
  resolution    VARCHAR(40),           -- pay_worker | refund_employer | partial | no_action | ban
  resolution_note TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);
CREATE TABLE dispute_evidence (
  id          UUID PRIMARY KEY,
  dispute_id  UUID NOT NULL REFERENCES disputes(id),
  uploaded_by UUID NOT NULL REFERENCES users(id),
  kind        VARCHAR(16),   -- photo | message_ref | note
  url         TEXT, body TEXT, message_id UUID REFERENCES messages(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.11 Trust & Safety: reports, fraud signals, bans

```sql
CREATE TABLE reports (
  id          UUID PRIMARY KEY,
  reporter_id UUID NOT NULL REFERENCES users(id),
  target_type VARCHAR(16) NOT NULL,  -- user | job | post | message | shop
  target_id   UUID NOT NULL,
  reason      VARCHAR(30) NOT NULL,  -- scam | spam | abuse | fake | fee_request | off_platform
  detail      TEXT,
  status      VARCHAR(16) DEFAULT 'open', -- open|reviewing|actioned|dismissed
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE fraud_signals (
  id          UUID PRIMARY KEY,
  user_id     UUID REFERENCES users(id),
  signal      VARCHAR(40) NOT NULL,  -- velocity_post | dup_device | contact_in_message | fee_pattern | geo_mismatch
  weight      SMALLINT NOT NULL,
  ref_type    VARCHAR(16), ref_id UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE moderation_actions (
  id          UUID PRIMARY KEY,
  actor_id    UUID REFERENCES users(id),   -- moderator or 'system'
  target_type VARCHAR(16), target_id UUID,
  action      VARCHAR(24) NOT NULL,  -- warn | hide | remove | suspend | ban | unban | clear
  reason      TEXT,
  expires_at  TIMESTAMPTZ,           -- for temporary suspensions/cooldowns
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.12 Cross-cutting: events (audit + analytics), notifications, idempotency, referrals, devices, flags

```sql
-- Append-only. The backbone of audit (§ disputes) AND analytics (§16). Principle P3/P8.
CREATE TABLE events (
  id          BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id    UUID,
  event_type  VARCHAR(60) NOT NULL,  -- 'job.posted','application.created','assignment.completed',...
  ref_type    VARCHAR(24), ref_id UUID,
  payload     JSONB,                 -- typed per event_type
  device_id   UUID,
  request_id  UUID
);
CREATE INDEX idx_events_type_time ON events(event_type, occurred_at);
CREATE INDEX idx_events_ref ON events(ref_type, ref_id);

CREATE TABLE notifications (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id),
  type        VARCHAR(40) NOT NULL,
  title       TEXT, body TEXT,
  ref_type    VARCHAR(24), ref_id UUID,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Delivery is separate from the notification (multi-channel, retriable, cost-tracked) — §11
CREATE TABLE notification_deliveries (
  id              UUID PRIMARY KEY,
  notification_id UUID NOT NULL REFERENCES notifications(id),
  channel         VARCHAR(12) NOT NULL,  -- inapp | whatsapp | sms
  template_id     VARCHAR(60),           -- WhatsApp requires pre-approved templates (§11)
  status          VARCHAR(16) NOT NULL DEFAULT 'queued', -- queued|sent|delivered|read|failed|skipped
  provider_ref    VARCHAR(120),
  cost_minor      INT,
  attempts        SMALLINT DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_prefs (
  user_id   UUID PRIMARY KEY REFERENCES users(id),
  whatsapp_opt_in BOOLEAN DEFAULT false,   -- explicit opt-in required (§11/§17)
  sms_opt_in      BOOLEAN DEFAULT true,
  quiet_hours     JSONB                    -- e.g. {"start":"22:00","end":"06:00"}
);

-- Generic idempotency store (Principle P4). Endpoints record (key -> response) once.
CREATE TABLE idempotency_keys (
  key         VARCHAR(80) PRIMARY KEY,
  user_id     UUID,
  endpoint    VARCHAR(80),
  request_hash VARCHAR(128),
  response_json JSONB,
  status_code SMALLINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ
);

CREATE TABLE devices (              -- abuse detection (dup-device fraud), push tokens, offline sync
  id          UUID PRIMARY KEY,
  user_id     UUID REFERENCES users(id),
  device_fingerprint VARCHAR(128),
  push_token  TEXT,
  last_seen_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE referrals (
  id            UUID PRIMARY KEY,
  referrer_id   UUID NOT NULL REFERENCES users(id),
  referred_id   UUID REFERENCES users(id),
  code          VARCHAR(16) UNIQUE,
  status        VARCHAR(16) DEFAULT 'pending', -- pending|qualified|paid|rejected_fraud
  qualified_by_event VARCHAR(60),  -- e.g. referred user's first COMPLETED job, not signup (§10)
  reward_minor  INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feature_flags (
  key         VARCHAR(60) PRIMARY KEY,
  enabled     BOOLEAN DEFAULT false,
  rollout_pct SMALLINT DEFAULT 0,     -- gradual rollout
  scope       JSONB                   -- {"district":["Swat"]} region gating
);
```

### 2.13 Consolidated schema deltas from §24/§25/§26 (added 2026-06-29 — these are part of the canonical schema)

> The first eight subsections of §2 were drafted in v1.1's first pass. The two subsequent audit passes (§24, §26) and the mainstream-app pass (§25) identified additional tables that are **required for correctness** (multi-device sessions, webhook dedup, money chargebacks, work-day logging for multi-day jobs) or for mainstream features (crews, invoices, blocks, group orders). These are inlined here so anyone scaffolding the database **from §2 alone** sees the complete model. Subsection numbers map back to the audit item that required each table.

```sql
-- §24/A1: immutable record of every phone↔user binding (SIM-swap forensics).
CREATE TABLE account_history (
  id           UUID PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id),
  phone_e164   VARCHAR(20) NOT NULL,
  bound_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  unbound_at   TIMESTAMPTZ,
  reason       VARCHAR(30)   -- 'initial' | 'sim_swap' | 'recovery' | 'admin'
);
CREATE INDEX idx_account_history_user ON account_history(user_id);
CREATE INDEX idx_account_history_phone ON account_history(phone_e164);

-- §26/M6: multi-device sessions with revocation. Access tokens short, refresh rotates.
CREATE TABLE sessions (
  id                  UUID PRIMARY KEY,
  user_id             UUID NOT NULL REFERENCES users(id),
  device_id           UUID REFERENCES devices(id),
  issued_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at          TIMESTAMPTZ,
  refresh_token_hash  VARCHAR(128) NOT NULL,
  scope               JSONB,        -- {"money": false} for cooldown sessions (§24/A1)
  ip_first_seen       INET,
  city_first_seen     VARCHAR(80)
);
CREATE INDEX idx_sessions_user_active ON sessions(user_id) WHERE revoked_at IS NULL;

-- §24/B2: per-day work log for multi-day jobs (lets pause/resume work without rate disputes).
CREATE TABLE work_log (
  id            UUID PRIMARY KEY,
  assignment_id UUID NOT NULL REFERENCES assignments(id),
  day           DATE NOT NULL,
  hours         NUMERIC(4,2),
  marked_by     UUID NOT NULL REFERENCES users(id),
  confirmed_by  UUID REFERENCES users(id),   -- counterparty confirmation
  state         VARCHAR(12) NOT NULL DEFAULT 'pending', -- pending | confirmed | disputed
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(assignment_id, day, marked_by)
);

-- §26/M3: dedup for inbound webhooks (gateways replay; user_id-scoped idempotency_keys
-- from §24/A7 don't cover server-to-server).
CREATE TABLE webhook_events (
  id            UUID PRIMARY KEY,
  provider      VARCHAR(20) NOT NULL,    -- jazzcash | easypaisa | fcm | apns | twilio | ...
  provider_ref  VARCHAR(120) NOT NULL,
  event_type    VARCHAR(40) NOT NULL,
  payload_hash  VARCHAR(128) NOT NULL,
  payload       JSONB,
  processed_at  TIMESTAMPTZ,
  result        VARCHAR(20),             -- 'ok' | 'noop_replay' | 'error'
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_ref, event_type)
);

-- §26/M20: bank/PSP chargebacks against KAFIL-held funds (distinct from in-platform disputes).
CREATE TABLE chargebacks (
  id            UUID PRIMARY KEY,
  payment_id    UUID NOT NULL REFERENCES payments(id),
  alleged_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        VARCHAR(16) NOT NULL DEFAULT 'alleged', -- alleged | won | lost | withdrawn
  amount_minor  BIGINT NOT NULL,
  reason_code   VARCHAR(40),
  provider_ref  VARCHAR(120),
  resolved_at   TIMESTAMPTZ,
  ledger_txn_id UUID                     -- reversal txn when status='lost'
);

-- §26/M9: identity blocklist (banned-CNIC, banned-device prevents reactivation as a relative).
CREATE TABLE banned_identities (
  id              UUID PRIMARY KEY,
  kind            VARCHAR(16) NOT NULL,  -- cnic_hash | device_fingerprint | phone_e164
  value           VARCHAR(128) NOT NULL,
  reason          VARCHAR(40),
  moderator_id    UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ,
  UNIQUE(kind, value)
);

-- §25.9: user-level block list (blocked party invisible to blocker; bilateral chat severed).
CREATE TABLE user_blocks (
  user_id     UUID NOT NULL REFERENCES users(id),
  blocked_id  UUID NOT NULL REFERENCES users(id),
  reason      VARCHAR(40),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, blocked_id),
  CHECK (user_id <> blocked_id)
);

-- §26/M36: FBR-compliant invoices for formal-business employer accounts.
CREATE TABLE invoices (
  id             UUID PRIMARY KEY,
  number         VARCHAR(40) UNIQUE NOT NULL,   -- KAFIL/<year>/<seq>
  employer_id    UUID NOT NULL REFERENCES users(id),
  amount_minor   BIGINT NOT NULL,
  currency       CHAR(3) NOT NULL DEFAULT 'PKR',
  ledger_txn_id  UUID,                          -- ties to commission collection
  pdf_url        TEXT,
  issued_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ref_type       VARCHAR(24), ref_id UUID       -- usually assignment/job
);

-- §25.3: crews/teams (a contractor bundles workers, posts one job, distributes payouts).
CREATE TABLE crews (
  id          UUID PRIMARY KEY,
  lead_id     UUID NOT NULL REFERENCES users(id),
  name        VARCHAR(160),
  trade       VARCHAR(40),                      -- masonry | electrical | ...
  payout_split JSONB NOT NULL DEFAULT '{}',     -- {"<user_id>": pct} OR rule-based
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE crew_members (
  crew_id     UUID NOT NULL REFERENCES crews(id),
  user_id     UUID NOT NULL REFERENCES users(id),
  role        VARCHAR(24),                      -- lead | senior | apprentice
  active      BOOLEAN DEFAULT true,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (crew_id, user_id)
);
-- Crew payouts ride the existing ledger (§2.9) — one inbound txn → N outbound entries per crew_members split.
-- This table records the split decision and the resulting ledger txn for auditability.
CREATE TABLE crew_payouts (
  id            UUID PRIMARY KEY,
  crew_id       UUID NOT NULL REFERENCES crews(id),
  assignment_id UUID NOT NULL REFERENCES assignments(id),
  total_minor   BIGINT NOT NULL,
  split_used    JSONB NOT NULL,                 -- snapshot of payout_split at time of payout
  ledger_txn_id UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- §25.3: group orders for the shop side (5 contractors pool an order; KAFIL facilitates).
CREATE TABLE group_orders (
  id              UUID PRIMARY KEY,
  shop_id         UUID NOT NULL REFERENCES shops(id),
  organizer_id    UUID NOT NULL REFERENCES users(id),
  product_label   VARCHAR(200),
  target_qty      INT,
  min_participants SMALLINT,
  closes_at       TIMESTAMPTZ,
  status          VARCHAR(16) DEFAULT 'open',   -- open | committed | shipped | cancelled
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE group_order_participants (
  group_order_id UUID NOT NULL REFERENCES group_orders(id),
  user_id        UUID NOT NULL REFERENCES users(id),
  qty            INT NOT NULL,
  committed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_order_id, user_id)
);

-- §6 + §26/M4: snapshot of KYC at assignment-acceptance time (so a later KYC lapse
-- never orphans an in-flight job — see also §26/M8 which routed this into assignments).
-- This is the canonical home for the snapshot blob if assignments.kyc_snapshot turns out
-- to be too coarse; default is to keep it on assignments and reference here for audit.
CREATE TABLE assignment_kyc_snapshots (
  assignment_id UUID PRIMARY KEY REFERENCES assignments(id),
  worker_kyc_level   SMALLINT,
  employer_kyc_level SMALLINT,
  snapshot_taken_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- §28 (see below): operational settings — commission rate, fee tiers, hold thresholds.
-- Single settings table rather than scattering numbers across code, so they're tunable
-- per region/version without a deploy. NOT feature_flags (those are boolean rollouts).
CREATE TABLE settings (
  key         VARCHAR(80) PRIMARY KEY,
  value       JSONB NOT NULL,
  scope       JSONB,         -- {"district":"Swat"} | null = global
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES users(id)
);
```

> **Migration order (so foreign-key dependencies resolve):** `users → devices → sessions → account_history → locations → specialties → worker_profiles → employer_profiles → jobs → job_slots → applications → assignments → assignment_kyc_snapshots → work_log → reviews → conversations → messages → wallets → ledger_entries → payments → payouts → webhook_events → chargebacks → invoices → shops → groups → posts → comments → crews → crew_members → crew_payouts → group_orders → group_order_participants → disputes → dispute_evidence → reports → fraud_signals → banned_identities → moderation_actions → user_blocks → events → notifications → notification_deliveries → notification_prefs → idempotency_keys → referrals → feature_flags → settings`.

---

## 3. IDENTITY & ROLES — the highest-leverage fix

**Problem (v1.0):** Separate `workers` and `employers` tables, each with `phone UNIQUE`. In Swat the same person is routinely both. Result: duplicate accounts, split/halved reputation, phone-uniqueness collisions, and an inability to show "this person is a trusted worker *and* a fair employer."

**Fix:** §2.1's single `users` + `user_roles` + role-specific profile tables.

**Consequences handled:**
- Reputation accrues to the **person**, across roles, and can be shown contextually.
- A worker can post a job (hire a laborer) without a second account.
- Onboarding adds a role lazily ("You're applying as a worker — set up your worker profile") rather than forcing a worker/employer choice at signup, which v1.0's interviews flagged as friction.
- `phone_e164` is unique on `users`; SIM swaps are handled by re-verification updating the same row (not creating a duplicate).
- KYC is a **level on the person** (`kyc_level`), reusable across roles.

---

## 4. JOB LIFECYCLE STATE MACHINE — the missing core logic

**Problem (v1.0):** Listed statuses (`open/in_progress/completed/cancelled`) but defined no transitions, no actors, no timeouts, and **none of the failure branches** that dominate real marketplaces — no-show (your #1 cited employer complaint!), cancellation, partial completion, expiry, double-accept, or rating deadlock.

We model state at **two levels**: the `job` (the posting) and the `assignment` (one worker's unit of work). This is required for multi-worker jobs.

### 4.1 Job states

```
draft ──publish──▶ open ──(all slots filled)──▶ filled ──(all assignments done)──▶ completed
  │                  │                              │
  │                  ├──expire(no fills by T)──▶ expired
  │                  └──cancel(employer)──────▶ cancelled
  └──discard──▶ (deleted)
```

- `open → filled` is **derived**: when count(open slots)=0.
- `filled → open` if an assignment is cancelled/no-show and a slot reopens (re-hiring allowed until start_date+grace).
- `expires_at` reaper moves stale `open` jobs to `expired` (keeps the marketplace fresh; v1.0 had no expiry).

### 4.2 Assignment states (where the real logic lives)

```
                ┌─────────────── employer accepts application
                ▼
applied ─▶ assigned ──worker confirms──▶ confirmed ──start_date reached──▶ in_progress
              │            │                  │                                  │
              │            │                  │                    ┌─ worker_marked_done ─┐
              │            │                  │                    ▼                      ▼
              │            │                  │            awaiting_employer_confirm   (employer_marked_done)
              │            │                  │                    │                      │
              │            │                  │                    └──── both agree ──────┘
              │            │                  │                              ▼
              │            │                  │                          completed ──▶ review window (§7)
              │            │                  │
              │            │                  ├─ employer cancels (pre-start) ─▶ cancelled_by_employer
              │            │                  ├─ worker cancels  (pre-start)  ─▶ cancelled_by_worker
              │            │                  └─ worker_no_show (start+grace, employer reports) ─▶ no_show
              │            └─ worker declines ─▶ declined (slot reopens)
              └─ auto-expire if unconfirmed by T ─▶ expired (slot reopens)

 any active state ──open dispute──▶ disputed ──resolution(§6/§9)──▶ completed | cancelled | refunded
```

### 4.3 Transition rules (authority + side-effects), enforced in the service layer

> **Authority note (added 2026-06-29):** rows below are the **canonical** transition contract. Where §24 and §26 evolved them, the table is amended **in place**. Do not implement from the prose lower in the document if it conflicts with this table — this is the source of truth.

| From → To | Who can trigger | Guards | Side effects |
|---|---|---|---|
| application.accept → `assigned` | employer | slot still `open`; worker not banned; **optimistic lock on slot.version**; idempotency key required (§24/B10, §24/A7-as-corrected-by-§26/M3) | slot→filled (single transactional helper, §24/A4), create assignment, notify worker, snapshot agreed_rate AND `kyc_snapshot` (§26/M8), **if payment_mode=escrow, require funded escrow first** |
| `assigned → confirmed` | worker | within confirm window | freeze worker availability for dates (derived; §24/B6); emit event |
| `assigned → expired` | system, **with advisory lock per target** (§24/C3) | no confirm by T (e.g. 24h or start_date−1) | reopen slot via job-state recompute (§24/A4), notify employer, **fairness: no penalty** |
| `confirmed → in_progress` | system | start_date reached | — |
| `in_progress → paused` (and back) | either, with confirmation | weather/materials/illness/other (§24/B2) | `work_log` entries pause; no penalty; rate calculation reads worked-days from log |
| `in_progress → no_show` | employer | start+grace elapsed, worker absent | record `no_show_count++`, reliability penalty (§7), reopen slot via §24/A4 recompute, cooldown on worker (§9) |
| worker_marked_done / employer_marked_done | respective party | in_progress | when **both** set → `completed` |
| ~~only one marked done → auto-complete in employer's favor for cash / hold for escrow~~ | ~~—~~ | ~~other party silent > T~~ | **SUPERSEDED by §26/M1.** Silence alone never auto-completes. See next row. |
| **one marked done, other silent past T → `awaiting_ops_review` (default)** | **system** | other party silent past T AND insufficient verifiable signals | **NEW (§26/M1):** auto-completion fires **only** when ≥2 of 3 verifiable signals present (photo evidence from active party + geofence ping at job site at the right time + chat history showing reciprocal acknowledgment). If thresholds met → `completed` in active party's favor + record evidence. **If not met → `awaiting_ops_review`** (human-in-the-loop via §18 dispute workbench); escrow funds stay frozen; reviews held until resolution. Escalating nudges (push → in-app → SMS → ops call) before T. **Replaces the now-removed §24/A6 directional fallback.** |
| `completed → in_review_window` | system | hold > 0 per risk score (see §6 + §26/M4 merged rule) | escrow funds held; review window open |
| `completed → finalized` (direct) | system | risk score = low → hold = 0h (§26/M4) | escrow release immediately; review window still open for the configured period but money already settled (safer because risk was scored low) |
| `in_review_window → finalized` | system | hold elapsed AND no dispute opened | execute release ledger txn (§6); reviews publish at window close regardless of counter-review (§24/A6-corrected-by-M1 + §7) |
| `* → cancelled_by_*` | either, pre-start | — | penalty scales with lateness (§9 policy engine); escrow refund pending PSP settle state (§26/M17) |
| `* → disputed` | either | evidence attached AND within dispute window (§24/B8: 7 days post-finalize for late complaints → `reports`, not disputes) | freeze money + reviews; route to ops (§18) |

**This table is the spec v1.0 never had, and it is now amended in place by every §24/§26 fix that touches it.** It is the source of truth for the build.

> **§4.3 superseded-rows log (so a reader can see what changed and why):**
> - **A6 (removed by M1):** the row "only one marked done → auto-complete in employer's favor for cash / hold for escrow" was first added in v1.1 §4.3, then identified as a non-payment-fraud vector in §24/A6 (which inverted it toward the worker), then identified in §26/M1 as still wrong (the inverted version was a worker-fraud vector). The canonical rule is now **evidence-based + ops-fallback**, encoded above. **Do not implement either deprecated form.**

### 4.4 Timeouts (all configurable via feature flags / settings)

- Application response SLA, confirm window, start grace period, done-confirmation window, review window, escrow auto-release. Each emits reminders before firing the terminal transition. A single background **scheduler** (cron/worker) drives all time-based transitions; they are idempotent so re-runs are safe.

---

## 5. ANTI-DISINTERMEDIATION — fixing the revenue-killer

**Problem (v1.0):** The design *hands out phone numbers on accept, pushes both parties to WhatsApp, settles in cash, and trusts the employer to remit commission later.* In a cash + jirga-trust economy, post-first-contact remittance ≈ 0%. **The primary revenue stream leaks to zero after first match.** This is the single most important fix in this document.

**Fix — make the platform the cheapest, safest place to transact, and don't give value away before capturing it:**

1. **Contact info is gated and masked.** No raw phone numbers exchanged. In-app chat (§2.7) is the default. If a call is needed, use **masked proxy numbers** (provider-issued; both sides call a KAFIL number that bridges) so the relationship stays on-platform and is recorded for disputes. Real numbers are never the connection primitive.

2. **PII/contact stripping in chat.** `messages.body_redacted` runs phone/number/social-handle detection (§10 patterns) before delivery; raw contact attempts are blocked early and **logged as a fraud/leakage signal**. Persistent attempts → friction (warnings, then limits). You don't ban for it — you make on-platform the path of least resistance.

3. **Make the repeat transaction trivially easy** (positive lock-in, not just walls):
   - **One-tap re-hire** of a worker you've used; **saved teams/crews** for contractors; **availability + scheduling** that only exists on KAFIL.
   - **Reputation lives only on-platform** — going off-platform forfeits the rating that gets a worker the next job. This is the strongest organic anti-leakage force; design the product so reputation is visibly valuable.

4. **Give a reason to transact on-platform every time, not just the first:**
   - **KAFIL Guarantee** (opt-in, esp. larger jobs): if the worker no-shows or work fails, platform backstops — only available for on-platform, escrow-funded jobs.
   - **Dispute backstop**: off-platform deals get no mediation. On-platform deals do.
   - **Worker income record** (§ formalization use case): only on-platform completed jobs count toward the verifiable income history banks accept. Off-platform work is invisible to lenders. This is a *worker-side* incentive to keep it on KAFIL.

5. **Align commission collection with a moment you control.** Don't bill *after* an off-platform cash deal. Either (a) **escrow path**: commission is netted at release (you hold the money, so you can't be stiffed); or (b) **cash path**: commission is small, charged to the **employer** at job *acceptance/confirmation* as a posting/connection fee model OR deferred but tied to features they want (guarantee, more applicants). Never structure revenue as "trust them to send it later."

6. **Measure leakage explicitly (§16):** track `contact_share_attempts`, `proxy_call_minutes`, ratio of `accepted` → `completed_on_platform`, and repeat-hire rate. A falling complete-on-platform ratio is your earliest warning that the model is leaking.

**Net:** v1.0's flow *causes* leakage; this design makes staying on-platform easier, safer, and more lucrative than leaving. The payment model in §6 assumes this.

---

## 6. MONEY — ledger, escrow, commission, payouts, refunds

**Problem (v1.0):** "2-3% collected post-completion via JazzCash transfer" is a hope, not a payment system. No escrow, no refunds, no partial payments, no reconciliation, no idempotency, no double-entry, and floats implied for currency.

**Fix — a real money subsystem:**

- **Minor units only.** Store paisa as `BIGINT`. Never floats for money.
- **Double-entry ledger (§2.9).** Every movement = balanced `ledger_entries` rows (sum=0 per `txn_id`) written in the same DB transaction as the state change. Wallet balances are derived/cached and reconciled against the ledger. This makes the system **auditable and provably consistent** — required for disputes and for any future investor/financial diligence.
- **Two payment modes per job** (`jobs.payment_mode`):
  - **`cash`** (MVP default, matches Swat norms): platform records the agreed amount, work happens, cash settles in person. Commission handled per §5.5(b). Money never touches the platform → minimal regulatory surface.
  - **`escrow`** (opt-in, larger jobs, the growth path): employer funds escrow via JazzCash/Easypaisa **before** work starts → `escrow_holding` wallet. On `completed`, release to worker minus commission → worker payout + `platform_revenue`. On dispute → funds frozen until resolution.
- **Commission** is a ledger reason, computed once, idempotent, and recorded — never "trust them to send 2%."
- **Refunds/partials/reversals** are first-class `reason` codes; a dispute resolution (`pay_worker | refund_employer | partial`) maps directly to balanced ledger transactions.
- **Idempotent payments/payouts** (`idempotency_key UNIQUE`) — gateway webhooks and client retries can't double-charge or double-pay.
- **Provider behind an interface** (`PaymentProvider`): `manual`/console adapter for dev, JazzCash/Easypaisa adapters for prod. Reconciliation job matches `provider_ref` ↔ `payments`/`payouts` daily.
- **Compliance gates (see §17):** escrow holding may trigger SBP e-money / KYC/AML thresholds — escrow is gated behind `kyc_level >= 2` above a configurable amount, and behind feature flags per region so you can launch cash-only and switch on escrow when licensing is ready.

### 6.1 Provisional commission + monetization rates (added 2026-06-29 — these are the numbers §21.2 depends on)

These are the **starting values**, recorded so §21.2 is reproducible. All live in the `settings` table (§2.13) so they can be tuned per region/cohort without a deploy.

| Setting key | Value | Notes |
|---|---|---|
| `commission.escrow.pct` | **5%** | Of job value, netted at release. Industry-standard floor for an escrow-backed marketplace doing dispute mediation + guarantee. Higher than v1.0's 2–3% because (a) it covers the dispute backstop the cash model can't fund, (b) it includes PSP fees, (c) it's only charged on escrow jobs (still optional). |
| `commission.escrow.minimum_minor` | **5000** (= 50 PKR) | Floor for tiny jobs so commission doesn't round to zero. |
| `commission.escrow.cap_minor` | **2_000_000** (= 20,000 PKR) | Cap so very large jobs don't get fee-gouged (mason on a 500k PKR job pays the same as on a 400k one). |
| `cash.featured_post.pkr` | **150 PKR/post** (boosted to top of feed for 24h) | Employer-side pay-to-play. Charged at posting time, ~100% collectable (§21.2). |
| `cash.applicant_unlock.pkr` | **50 PKR** | Charged on first accept of an applicant; functions as a connection fee (§5.5b) without being called one. Waived for first 3 lifetime hires per employer to reduce onboarding friction. |
| `verification.shop_tier.monthly_pkr` | **500 PKR/month** | Shop "Verified" badge + analytics + featured listing (matches v1.0 Audit). |
| `verification.worker_pro.monthly_pkr` | **200 PKR/month** | Optional worker upgrade (badge, ranking nudge, larger photo gallery, voice intro). |
| `guarantee.fee.pct` | **2% of job value** | Opt-in KAFIL Guarantee for escrow jobs (§5.4); funds a small claims reserve. |
| `referral.reward_minor` | **30000** (= 300 PKR) | Per qualifying referral (§10/F7: referred user's first *completed* job). |
| `hold.low_risk_minutes` | **0** | (§26/M4 merged rule, see §6.2). |
| `hold.medium_risk_minutes` | **1440** (= 24h) | |
| `hold.high_risk_minutes` | **2880** (= 48h) | |
| `hold.risk_band_thresholds` | `{"low":{"max_amount_minor":3_000_000,"min_trust":60,"min_history":2}, "medium":{"max_amount_minor":15_000_000}}` | All other → high risk. |
| `commission.cash_mode.trailing.enabled` | **false** | Trailing post-job remittance is **disabled** by design (§5/§21.2) — cash-mode revenue comes from featured posts + verification tiers + applicant unlock, not from chasing employers afterward. The flag exists so the rule is explicit, not implicit. |

**Why these specific numbers (so they're defensible, not arbitrary):**
- Escrow 5% is the modal rate for trust-mediated marketplaces in emerging markets (Bykea ride 12% but they handle full payment + insurance; OLX premium 5–8%; international platforms 10–20% but include heavier services). 5% leaves room to drop to 3–4% as competitive pressure builds, and to 7% with the Guarantee bundle.
- Featured-post 150 PKR matches what Pakistani employers spend on a Facebook-group "bump" post today (we benchmarked off the Audit's interviews). One featured-post conversion per 5 organic posts at scale.
- Verification tier 500 PKR/mo is the v1.0 Audit number, preserved (it's right).
- Hold thresholds match §26/M4 risk tiers and are tuned for the founder's actual ops capacity (§28.B): if dispute volume rises, lengthen high-risk holds; if liquidity tightens worker complaints, shorten medium-risk.

### 6.2 Escrow release rule — B4/M4 merged statement (the canonical rule)

> §24/B4 introduced `completed → in_review_window → finalized` as the release sequence (to make clawback possible). §26/M4 then said "0h hold for low-risk, 24–48h for medium/high." The two specifications were *not* reconciled in place. This subsection is the single authoritative merged rule:

**On `completed`, the system computes a risk score from (amount band, employer + worker trust scores, history depth, prior disputes). Based on the band:**
- **Low risk → `hold.low_risk_minutes` = 0** → assignment transitions **directly to `finalized`**; escrow release ledger txn fires now; the review window remains open for the configured period but funds are already settled. Safer because risk was scored low; better UX because workers get same-day money.
- **Medium / high risk → assignment enters `in_review_window`** for `hold.medium_risk_minutes` or `hold.high_risk_minutes`; funds held in `escrow_holding` wallet; opening a dispute **pauses** the hold timer; on timer elapse and no open dispute → transition to `finalized` and execute the release ledger txn.

**Review-window behavior is independent of fund-hold:** reviews publish at review-window close regardless of which side reviewed (§7, post-M1). A 0-hour fund hold does *not* mean a 0-hour review window. The two are tunable separately.

**Cash mode:** no escrow → no fund hold → `completed → finalized` immediately. Review window still applies. Disputes can still freeze reputation effects.

**Communicated to user up-front** during job acceptance: the UI shows "You'll be paid: instantly / next day / after 48h review — based on this job" (M4 anti-anti-disintermediation requirement).

---

## 7. REPUTATION & REVIEWS — beyond naive 5-star average

**Problems (v1.0):** Simple average (grade-inflates to ~4.8, stops discriminating); single-blind reviews invite **retaliation** (workers won't honestly rate employers they may need again) and **reciprocity bias**; sparse-data distortion (a 1-review 5.0 outranks a 200-review 4.7); no manipulation defense; reviewable forever (rating deadlock).

**Fixes:**

1. **Double-blind, simultaneous reveal (Airbnb model).** Neither side sees the other's review until **both submit** or the **review window closes** (`reviews.visible_at`). Kills retaliation and reciprocity inflation. This is why reviews attach to `assignment_id` with a window, not a free-floating rating.

2. **Bayesian / shrinkage score**, not raw mean:
   `score = (C·m + Σratings) / (C + n)` where `m` = global mean, `C` = confidence constant (e.g. 10). A 1-review worker sits near the global mean until they earn a track record. Stored in `*_profiles.rating_bayesian`, recomputed on new review.

3. **Recency weighting** — recent jobs weigh more; reputation reflects current behavior.

4. **Multi-signal reputation, not one number.** Surface **completion rate, no-show rate, response rate, payment reliability (employers)** separately (all derived from §2 tables). A 5-star worker who no-shows 20% of the time should look different from a 4.6 who never misses. These feed ranking (§8) and trust (§9).

5. **Manipulation defenses (§9/§10):** reviews only from **real completed assignments** (no review without an assignment FK); velocity/graph analysis for review rings; weight by reviewer trust; flag sudden rating swings (review-bombing). 

6. **Newcomer bootstrap (the cold-start-for-people problem v1.0 ignored):** a brand-new worker with 0 reviews can never get the first job → never gets a review. Fixes: a **"New" badge** (sets expectations rather than showing a scary 0), a **ranking fairness boost** for first N jobs (§8), and optional **intro programs** (first-job guarantee/discount). Without this, supply never onboards.

---

## 8. MATCHING & RANKING ENGINE — replacing "suggested workers"

**Problem (v1.0):** "Suggested workers" with no model. Ranking is core marketplace IP and was a one-liner.

**Fix — an explicit, tunable scoring function** (service layer, feature-flagged weights):

```
score(worker, job) =
    w1 · specialty_match            (exact/related/none)
  + w2 · distance_decay(km)         (PostGIS distance, exponential decay)
  + w3 · availability_match(dates)  (from worker_availability)
  + w4 · reputation(bayesian)       (§7)
  + w5 · reliability(1 − no_show_rate, completion_rate)
  + w6 · responsiveness(response_rate, recent activity)
  + w7 · newcomer_fairness_boost    (decays after first N jobs — §7.6)
  − p1 · over_exposure_penalty      (de-dupe: don't let the same 3 stars win every job)
  − p2 · trust_risk(low trust_score, open reports)
```

- **Over-exposure penalty** is critical: without it the top 3 workers win everything, the long tail never gets work, supply churns out, and liquidity collapses. Rotate exposure.
- **Two-sided:** workers also get a ranked **job feed** with the symmetric function.
- **Explainability:** store why a match surfaced (for debugging and for the "why am I seeing this" trust the demographic needs). Start rules-based; the schema/events (§16) collect the data to train a learned ranker later — future-proofed without over-engineering now.

---

## 9. TRUST & SAFETY SUBSYSTEM

**Problem (v1.0):** Assumed good actors. No moderation, no abuse handling, no policy engine, no bans/appeals. Real marketplaces are 30%+ T&S.

**Fix — a first-class subsystem (schema in §2.10/§2.11):**

- **Reporting** on every entity (user/job/post/message/shop) with one-tap "report scam," fast takedown, and an ops queue (§18).
- **Fraud signal engine** writes weighted `fraud_signals`; thresholds trigger automated friction (rate-limit, hold for review) or escalate to moderators. Signals: posting velocity, duplicate device fingerprints, contact-in-message, "fee/deposit" patterns, geo mismatch, review-ring graphs. (Attacks enumerated in §10.)
- **Cancellation/No-show Policy Engine** (this *is* your trust product): reliability scores, escalating cooldowns for repeat no-show/late-cancel, penalty scaled by lateness, visible reliability stats. Encoded as `moderation_actions` with `expires_at` for temporary cooldowns.
- **Bans + appeals.** Suspensions are reversible and time-boxed; permanent bans require a moderator action with reason; users get an appeal path (logged). Don't silently shadowban without record — disputes and PR require an audit trail.
- **`trust_score`** per user, derived from KYC level, completed history, dispute outcomes, and fraud signals; feeds ranking (§8) and gates risky actions (escrow eligibility, mass-posting, referral rewards).
- **Content moderation in Pashto/Urdu** is hard for automated tooling — design for **human-in-the-loop** review queues from day one; don't assume an English-trained classifier will catch local-language abuse/scams.

---

## 10. FRAUD & ABUSE THREAT MODEL

**Problem (v1.0):** None existed. Below is a concrete threat model with the defense for each — fraud arrives in week one in PK job markets.

| # | Attack | Vector | Defense (designed in) |
|---|---|---|---|
| F1 | **Advance-fee / recruitment fraud** (endemic in PK) | Fake employer posts job demanding worker pay a "registration/deposit fee" off-platform | Hard rule: **workers never pay to apply** (enforced + messaged); detect "fee/deposit/advance" patterns in jobs & messages → block + report; new-employer posting limits; one-tap report |
| F2 | **Disintermediation** | Exchange contact, go off-platform | §5 in full: masked contact, chat PII-stripping, on-platform value (guarantee, reputation, income record), escrow-netted commission |
| F3 | **Fake profiles / Sybil** | One actor, many accounts to farm referrals or review-bomb | Device fingerprinting (`devices`), phone+CNIC binding for higher tiers, velocity limits, dup-device fraud signals |
| F4 | **Review manipulation** | Fake 5-stars, paid reviews, competitor review-bombing | Reviews only from real completed assignments; reviewer-trust weighting; review-ring graph detection; rating-swing flags |
| F5 | **No-show / ghosting** | Worker or employer vanishes | §4 no-show state + policy engine cooldowns; reliability stats; escrow protects employer money |
| F6 | **Non-payment** | Employer refuses to pay after cash work | Escrow path eliminates it; cash path → dispute + employer `payment_reliability` score + reputation consequence |
| F7 | **Referral farming** | Self-referrals, fake signups for the 300 PKR bounty | Reward on **referred user's first *completed* job**, not signup; device/velocity checks; `referrals.status=rejected_fraud` |
| F8 | **Spam / scam posts in groups** | Mass posting, MLM, phishing links | Rate limits, link stripping/sandboxing, moderation queue, trust-gated posting |
| F9 | **Account takeover** | SIM swap, shared phones, OTP theft | Re-verification on device change; sensitive actions (payout, ban-appeal) require step-up; SIM-swap-aware (don't auto-trust a re-verified number for money for a cooldown) |
| F10 | **Photo abuse** | Stolen/AI before-after photos; EXIF leaks home location | Server-side EXIF stripping on upload; reverse-image flags later; photos tied to assignment timeline |
| F11 | **Harassment / safety (esp. women, off-platform meets)** | Abuse via chat/calls | Block/report, masked numbers, abuse classifier queue, ability to keep identity minimal |
| F12 | **Wage/rate manipulation** | Lowballing, bait-and-switch rate after accept | Agreed rate snapshotted at accept (`assignments.agreed_rate_pkr`); rate-change after confirm requires mutual consent + is logged |

---

## 11. NOTIFICATIONS — the WhatsApp reality (v1.0 treated it as free unlimited SMS)

**Problems (v1.0):** Designed "notify every relevant worker of every matching job" via WhatsApp. The **WhatsApp Business API** doesn't work like that and that pattern gets your number **banned**.

**Reality & fixes:**

- **Pre-approved message templates only** outside the 24-hour user-initiated session window. → Maintain a registry of approved templates (`notification_deliveries.template_id`); design notifications around them.
- **Explicit opt-in required** (`notification_prefs.whatsapp_opt_in`); unsolicited messaging → quality-tier downgrade → ban. → Opt-in during onboarding; default new users to **in-app + SMS**, WhatsApp only after consent.
- **Per-message cost + rate/quality tiers.** → `notification_deliveries.cost_minor`, batching, and **prioritization**: not every match is push-worthy. Send high-intent events (you were accepted, you have a dispute, payment received), digest the rest.
- **Multi-channel with fallback:** in-app (free, always) → WhatsApp (opt-in, templated) → SMS (fallback for basic phones). Delivery is a separate retriable record (`notification_deliveries`) from the notification itself.
- **Quiet hours** and frequency caps (`notification_prefs.quiet_hours`) to avoid spam fatigue and bans.
- **PTA bulk-messaging / DND regulations (§17)** apply to SMS — respect them.

---

## 12. LOCALIZATION & ACCESSIBILITY — the actual moat (v1.0 stopped at "translate to Pashto")

**Problems (v1.0):** Localized only at string-translation level; ignored RTL, low literacy, the no-street-address reality, and shared/low-end devices.

**Fixes:**

1. **Full RTL + bidi.** Pashto uses Arabic script → entire layout mirrors (not just text). `dir="rtl"`, logical CSS properties, bidi handling for mixed PKR/Latin/numbers. `next-intl` handles strings, **not layout** — RTL is a design-system task. **Eastern-Arabic numerals** option (۰۱۲۳).
2. **Icon/voice-first for low literacy.** Many target users read poorly. → Pictographic specialty pickers (`specialties.icon`), **voice job descriptions** (`jobs.description_audio_url`), audio playback of listings, minimal-text flows. Text-heavy forms (bio, long descriptions) **exclude** users — make them optional with voice/photo alternatives.
3. **Landmark-based location, not addresses.** Swat has no street-address system; location is "near the 3rd mosque, Hayatabad." → `locations` supports **pin-drop + landmark label + voice description + tehsil**, with `precision` flag. Map UX centers on pin-drop and nearby-landmark, never address parsing/geocoding-by-string.
4. **Identity reality.** Shared phones, illiterate users, SIM↔CNIC linkage. → "phone OTP = verified" is only `kyc_level 1`; higher trust needs CNIC (hashed) or verified job history. Account model tolerates shared devices (device ≠ identity) while still using device signals for fraud.
5. **Right defaults:** language picker at first launch, persisted (`users.preferred_lang`); content (specialties, templates, UI) fully trilingual ps/ur/en from the schema up (note the tri-lingual columns in `specialties`).

---

## 13. OFFLINE & SYNC — deeper than "PWA caching"

**Problems (v1.0):** "Offline = browse cached content; can't apply/post." But the *whole point* in 2G/3G Swat is being able to **act** offline, and PWA push on iOS is crippled.

**Fixes:**

- **Optimistic UI + mutation outbox.** Apply/accept/message queue locally with a client-generated **`Idempotency-Key`** (P4); UI reflects intended state immediately; the outbox flushes when connectivity returns; server dedupes so re-sends are safe.
- **Conflict resolution.** If the slot filled while you were offline, the queued apply resolves to a clear "this job was filled" state — not a silent failure or a corrupt double-assign. Server is authoritative; `version` columns (§14) detect conflicts.
- **Sync protocol.** Client pulls deltas since last sync cursor; events (§2.12) make this natural. Cache job feed, profiles, conversations.
- **Capacitor/native earlier than v1.0's Phase 3** if push notifications are core — **iOS PWA push is unreliable**, and notifications are central to your liquidity loop. Plan the web app to wrap in Capacitor so the same codebase ships native push.
- **Bandwidth discipline.** Aggressive image optimization (already in v1.0), but also: minimal JSON, delta sync, and a genuinely usable **2G** experience, not just "3G."

---

## 14. CONCURRENCY CORRECTNESS

**Problems (v1.0):** None addressed. On flaky networks and a popular job, these *will* happen: double-apply, double-accept, two employers grabbing the same worker, over-hiring past headcount, double-pay.

**Fixes:**

- **Optimistic locking** (`version` on jobs, job_slots, assignments, wallets): conditional `UPDATE ... WHERE version = $expected`; 0 rows updated → 409 conflict, client refetches.
- **Slot model as a concurrency primitive (§2.3):** filling a slot is an atomic `UPDATE job_slots SET status='filled', assigned_worker_id=$w, version=version+1 WHERE id=$s AND status='open' AND version=$v`. Over-hiring past headcount is structurally impossible.
- **Unique constraints as guardrails:** `applications UNIQUE(job_id,worker_id)`, `assignments UNIQUE(slot_id)`, `payments/payouts UNIQUE(idempotency_key)`. The DB refuses duplicates even if app logic races.
- **Idempotency keys (§2.12)** on all mutating endpoints (P4): a retried accept returns the original result, doesn't create a second assignment.
- **Money is transactional + double-entry (§6):** state change and ledger rows commit together or not at all.

---

## 15. LIQUIDITY / COLD-START ENGINE

**Problem (v1.0):** Mitigation was "seed contractors" + "**founders post fake jobs**." Fake supply/demand is a trust landmine that won't survive jirga word-of-mouth, and there was no actual machine.

**Fixes:**

- **No fake listings — ever.** Instead, **concierge/manual matching** for the first ~100 jobs (the unglamorous thing every great marketplace did): staff hand-match supply and demand, learn the real friction, and convert it to product. Honest and trust-building.
- **Geographic density first.** Define a concrete threshold (e.g. *N active workers + M weekly jobs within one tehsil* before declaring a market "live" and expanding). Win one neighborhood's density before spreading thin.
- **Demand-signal capture.** Every **failed search** ("no masons near me") is a supply-acquisition lead — instrument it (§16) and act on it (recruit that specialty in that area).
- **Newcomer bootstrap** (§7.6) so first-time workers actually get a first job.
- **Single-player utility** so the app is useful before the network exists: a worker can keep a free verifiable job log / income record even from off-platform work entered manually → gives a reason to be there pre-liquidity, and pulls future jobs on-platform.

---

## 16. OBSERVABILITY — event taxonomy & the "aha moment"

**Problem (v1.0):** Named PostHog/Sentry but defined **no events**. You can't improve retention you can't measure.

**Fix:**

- **Typed event taxonomy** (emitted to `events` table + analytics sink) covering the full funnel: `user.signed_up`, `profile.completed`, `job.posted`, `search.performed`, `search.zero_results` (the supply lead!), `application.created`, `application.accepted`, `assignment.confirmed`, `assignment.completed`, `review.submitted`, `dispute.opened`, `payment.succeeded`, `contact.share_attempted`, `notification.sent/failed`.
- **Define the activation / "aha" moment** = **first completed job (with mutual review)**. Optimize onboarding and matching toward that single metric; it's the strongest predictor of retention for a marketplace.
- **North-star + guardrails:** North-star = completed-on-platform jobs/week. Guardrails = leakage ratio (§5), dispute rate, no-show rate, notification cost, p95 latency on 3G.
- **The `events` table doubles as the audit log** (P3) — one append-only source feeds both disputes and analytics.

---

## 17. COMPLIANCE & LEGAL (made concrete)

**Problem (v1.0):** Listed compliance abstractly; didn't connect it to system design.

**Fixes / gates:**

- **SBP (State Bank) e-money / payment regulation:** holding escrow may require licensing or a partnership with a licensed PSP (JazzCash/Easypaisa as the regulated rail, KAFIL as a technical layer). → **Launch cash-only**; gate escrow behind region feature flags + KYC until the regulatory path is cleared.
- **KYC/AML thresholds:** large or aggregated transactions trigger KYC (`kyc_level`) and reporting. → Escrow above a configurable amount requires `kyc_level>=2`; transaction monitoring via the ledger.
- **PTA messaging rules / DND:** SMS/WhatsApp bulk messaging is regulated; honor opt-in and DND (§11).
- **Data protection (PECA / forthcoming PK data law + good GDPR-grade hygiene):** PII minimization, hashed CNIC (never raw), encryption at rest/transit, data-deletion on request (soft-delete + scheduled hard-delete), no data selling. The `users`/`devices` model supports right-to-erasure.
- **Worker classification:** explicit marketplace-not-employer framing in ToS; KAFIL never directs work → avoids employment liability.
- **Consent & age gating** at signup; ToS/Privacy in **Pashto + Urdu + English**.

---

## 18. OPS / SUPPORT BACK-OFFICE (the admin dashboard couldn't *run* anything)

**Problem (v1.0):** Admin dashboard was read-only stats. Disputes, moderation, and support need a **workbench**, not a report.

**Fix — operational tooling from MVP (lean but real):**

- **Dispute workbench:** full assignment timeline + message history + evidence + ledger view; agent actions map to resolutions (`pay_worker/refund/partial/ban`) that execute real ledger transactions (§6).
- **Moderation queue:** reports + fraud signals triaged; one-click hide/remove/suspend/ban with reason → `moderation_actions` (audited).
- **User 360:** roles, reputation, reliability, devices, disputes, payments — for support.
- **Concierge matching console** (§15) for the cold-start phase.
- **Feature-flag admin** (§2.12) for staged rollout + kill switches.
- **Escalation to Jirga** is a logged dispute status (`escalated_jirga`), not an off-system handwave — keeps the audit trail intact.

---

## 19. PRIORITIZED BACKLOG — what this means for the build

Not everything ships in MVP. But the **schema, state machine, and money/identity model must be right from line one** — those are the things you cannot retrofit. Features can come later; foundations cannot.

### Tier A — MUST be in the foundation before any feature code (architecture, not features)
- Single-identity + roles model (§3) — *retrofitting this later = full rewrite.*
- Corrected schema (§2) with FKs, versions, idempotency, events.
- Job/assignment **state machine** (§4) in the service layer.
- Layered architecture + provider interfaces (P1–P2).
- Idempotency + optimistic locking (§14) on apply/accept/complete.
- Event/audit table (§16, P3) — cheap now, impossible to backfill.
- Money as double-entry ledger **even in cash mode** (§6) — record agreed amounts/commission from day one.

### Tier B — MVP launch (the honest, safe first release)
- Core loop: post job (with slots/headcount) → apply → accept → confirm → in_progress → done → **double-blind review** (§7).
- No-show / cancellation states + basic policy engine (§4, §9).
- In-app chat with **PII stripping** + masked-contact design (§5).
- Reporting + basic moderation queue + fraud signals F1/F2/F7 (§9/§10).
- WhatsApp **opt-in + templated** notifications, in-app + SMS fallback (§11).
- RTL + Pashto + icon-first specialty picker + landmark location (§12).
- Offline outbox for apply/accept (§13).
- Core analytics events + activation metric (§16).
- **Cash mode only.** Commission via §5.5(b) connection/feature model. **No escrow yet.**
- Concierge cold-start (§15).

### Tier C — Fast-follow (weeks after launch, as liquidity proves out)
- Escrow + payouts (§6) behind KYC + region flags once SBP path is clear.
- KAFIL Guarantee (§5.4).
- Matching/ranking scoring function with over-exposure fairness (§8).
- Availability calendar UX, one-tap re-hire, saved crews (§5.3).
- Dispute workbench full version (§18).
- Shops + community groups (kept from v1.0, now with moderation).
- Capacitor native wrapper for reliable push (§13).
- Referral program **with** anti-farming (§10 F7).

### Tier D — Later (scale)
- Learned ranking model (data already collected via §16).
- Income-verification API for lenders (the formalization revenue stream).
- Pricing/rate intelligence.
- Advanced fraud graph detection, voice profiles, skills marketplace, regional expansion.

---

## 20. SUMMARY — what changed and why it's future-proof

v1.0 described **features**. v1.1 adds the three things that actually make a marketplace work and that are impossible to bolt on later:

1. **Adversarial design** — a fraud threat model (§10) and a T&S subsystem (§9) baked into the schema, because the platform will be attacked from week one.
2. **State & money correctness** — an explicit lifecycle state machine (§4), double-entry ledger (§6), idempotency and optimistic locking (§14), and an audit/event spine (§16/P3) — so the unhappy paths (no-show, cancel, dispute, double-accept, non-payment) are *designed*, not discovered in production.
3. **Anti-disintermediation** (§5) — the fix without which the entire revenue model leaks to zero, plus a single-identity model (§3) that lets reputation (the strongest anti-leakage force) accrue to the person.

Everything above is structured so the **foundation (Tier A)** is correct from the first commit, while **features (Tiers B–D)** layer on without rework. That is what "future-proof" means here: you can change features freely, but you will never have to migrate identity, money, or state — the three things that are catastrophic to migrate.

---

## 21. RECONCILIATION WITH v1.0 DOCUMENT SET + CORRECTED FINANCIALS

> This section was added on 2026-06-29 after three additional v1.0-era documents were provided: `KAFIL_PROJECT_EXECUTION_MAP.md`, `KAFIL_AUDIT_AND_GAP_ANALYSIS.md`, and `KAFIL_QUICK_REFERENCE.md`. It reconciles their claims with this addendum and supplies the corrected financial model they lack. **Where any v1.0 document conflicts with v1.1, v1.1 governs.**

### 21.1 Claim-by-claim reconciliation

| v1.0-doc claim | Where | Verdict | v1.1 correction |
|---|---|---|---|
| Payment flow: share contacts → cash off-platform → employer remits commission later | Audit Gap 1 | **Overturned (critical)** | §5 anti-disintermediation + §6 ledger/escrow. This flow zeroes revenue. |
| Year 1 revenue $195–206k, ~92% margin, break-even Month 3 | Audit Gap 5; QuickRef "Key Numbers" | **Invalid as written** | §21.2 leakage-adjusted model below. |
| Split `workers` / `employers` tables; `ratings(rater_id, ratee_id)` bare UUIDs | ExecMap Part 1 ERD; v1.0 §Database Schema | **Buggy / un-buildable** | §2.1/§2.5/§3 single-identity + FK-backed reviews. |
| `jobs.employer_id REFERENCES employers(id)` | v1.0 §Database Schema | **Compile error** (`employers` never defined) | §2.3 `jobs.employer_id REFERENCES users(id)`. |
| Specialties as `TEXT[]`, queried `@> ['Mason']` | v1.0 schema; ExecMap data-flow | **Superseded** | §2.1 normalized `specialties` vocabulary + join tables (filtering, i18n, ranking). |
| Single-hire jobs (`UNIQUE(job_id, worker_id)`, one status) | v1.0 schema | **Can't model "need 3 masons"** | §2.3 `headcount` + `job_slots` + `assignments`. |
| Statuses `open/in_progress/completed/cancelled`, no transitions | v1.0; ExecMap Week 5 | **Incomplete** | §4 explicit two-level state machine incl. no-show/cancel/expiry/dispute/deadlock. |
| "Founders post fake jobs to seed" | v1.0 §Risk 1 | **Harmful** | §15 concierge matching, never fake supply. |
| WhatsApp = unlimited push to all matching workers | v1.0 §7; ExecMap Week 5 | **Gets number banned** | §11 templated, opt-in, cost-aware, multi-channel. |
| 5-star simple average | v1.0; ExecMap Week 5 | **Known-broken** | §7 double-blind + Bayesian + multi-signal. |
| Next.js 14 | All v1.0 docs | **Stale** | Current stable (Next.js 16 at build time). |
| Supabase/Vercel/Twilio assumed reachable & primary | ExecMap Part 1 | **Refined** | P2 provider interfaces; local-first dev (SQLite/console) so the app runs in network-restricted envs; swap to hosted in prod. |
| Income certificates as near-term revenue | v1.0; Audit "invalidated assumption" (already self-corrected) | **Agree — defer** | §19 Tier D; needs on-platform completed-job history (which §5 protects). |
| Legal/tax framework, regional GTM, KPI taxonomy, qualitative research | Audit Gaps 3/4/6, research findings | **Kept — still authoritative** | Referenced, not replaced. §17 makes the compliance gates concrete. |

### 21.2 Corrected financial model (leakage-adjusted)

The v1.0 model's fatal assumption is **100% commission collection**. Reality depends entirely on *payment mode* (§6):

- **Cash mode (MVP):** the v1.0 Audit Gap 1 already conceded cash-first and manual collection friction — credit where due. The leakage point v1.1 adds is that *manual collection at scale* (not just at MVP) trends to **~5–15%** after first interaction, because each repeated direct hire removes another reason to route through KAFIL. This is why v1.1 **does not** monetize cash mode via trailing remittance at all. Instead, cash-mode revenue comes from **employer-side, pay-to-play-at-the-moment-of-value** mechanisms that don't depend on trust: featured/boosted job posts, applicant-unlock or connection fees charged at accept-time, and verification tiers (§6.1). Collection on these is **near-100%** because they're charged before the value is delivered — not because v1.0 assumed 100% (it didn't), but because the *mechanism* makes collection structurally certain rather than relationship-dependent.
- **Escrow mode (fast-follow):** commission is **netted at release** — collection is **~100%** because KAFIL holds the funds. This is the durable revenue engine, gated behind KYC + regulatory readiness (§17).

**Illustrative Year-1 (conservative, leakage-aware) — replaces Audit Gap 5 figures:**

```
Assumptions (deliberately conservative; instrument and revise with real data — §16):
- MVP is cash-mode only for ~months 1–4; escrow switches on ~month 5+ where KYC/region allows.
- Monetized actions in cash mode: featured posts + verification tiers (NOT trailing commission).
- Escrow adoption ramps slowly (trust takes time): 5% → 25% of jobs by month 12.

Revenue (rough order-of-magnitude, USD):
- Cash-mode pay-to-play (featured posts, verification): low thousands → ~$8–15k by year end
- Escrow-netted commission (only on escrow jobs): ramps to ~$10–25k run-rate by month 12
- Year 1 total: ~$20–45k  (vs. v1.0's $195–206k)

Costs the v1.0 model omitted (now included):
- Trust & Safety / moderation labor (Pashto human-in-loop): a real recurring line from week 1
- Dispute ops time
- WhatsApp per-message + template approval costs (§11)
- Payment provider fees on escrow (PSP cut)
- KYC/verification costs for escrow users
- Concierge matching labor during cold-start (§15)
```

**The point is not the exact number — it's the shape:** real Year-1 revenue is **~1/5 to 1/10 of the v1.0 projection**, the business is **not** 92%-margin or break-even in Month 3, and durable monetization arrives with **escrow (§6)**, not trailing cash commission. This is a *healthier* model: it's honest about unit economics and it removes the incentive structure that drives users off-platform. Plan runway accordingly; do not pitch the v1.0 numbers.

### 21.3 Metrics additions (fold into Audit's KPI dashboard)
The Audit's KPI taxonomy is good; add the v1.1-specific guardrails it couldn't have known to track:
- **Leakage ratio** = completed-on-platform ÷ (accepted) — the single most important health metric (§5/§16).
- **Contact-share attempts** and **proxy-call minutes** (early leakage warning).
- **No-show rate**, **late-cancel rate**, **dispute resolution time**, **escrow adoption %**.
- **Commission collection rate by mode** (proves/refutes §21.2 assumptions).
- **WhatsApp delivery cost & quality tier** (§11).

---

## 22. CORRECTED BUILD ROADMAP (re-sequences ExecMap Weeks 3–12)

The ExecMap's week plan is energetic but builds features before the foundation that can't be retrofitted (identity, state, money, idempotency). This roadmap keeps the ExecMap's 12-week cadence and its good instincts (validate first, launch lean, iterate) but **re-orders around Tier A → B** (§19) and drops the disintermediation/fake-job/WhatsApp-spam patterns.

```
WEEK 1–2  Validation + Foundation setup   (unchanged intent from ExecMap, plus:)
  + Lock the v1.1 data model (§2/§3) and state machine (§4) on paper before code.
  + Stand up local-first stack: Next.js 16 + Prisma + SQLite + Zod (P2), provider stubs
    for SMS/WhatsApp/storage/payments so the app runs with zero external deps.

WEEK 3–4  TIER A FOUNDATION (this is the non-negotiable re-sequencing)
  - users + user_roles + role profiles (§3); NOT split worker/employer.
  - jobs + job_slots + assignments + applications with versions & idempotency (§2,§14).
  - events/audit table + ledger tables (record amounts even in cash mode) (§2.9,§16,P3).
  - route → service → repository layering (P2); state machine enforced in services (§4).

WEEK 5–6  TIER B CORE LOOP (the honest marketplace)
  - Post job (with headcount/slots) → apply → accept → confirm → in_progress → done.
  - No-show / cancel / expiry transitions + basic policy engine (§4,§9).
  - Double-blind reviews (§7). In-app chat with PII-stripping + masked-contact design (§5).
  - Reporting + minimal moderation queue + fraud signals F1/F2/F7 (§9,§10).

WEEK 7–8  POLISH + HONEST LAUNCH
  - RTL + Pashto + icon-first specialty picker + landmark location + voice description (§12).
  - Offline outbox for apply/accept (§13). Core analytics events + activation metric (§16).
  - WhatsApp OPT-IN + templated notifications; in-app + SMS fallback (§11) — NOT broadcast.
  - Cash mode only; monetize via featured posts / verification, NOT trailing commission (§21.2).
  - Concierge cold-start (§15) — real seeded supply via hand-matching, never fake jobs.

WEEK 9–12 ITERATE + PROVE UNIT ECONOMICS (then Tier C)
  - Measure leakage ratio, no-show rate, dispute time, collection rate (§21.3).
  - Begin escrow + payouts behind KYC + region flags once SBP path is clear (§6,§17).
  - Matching/ranking with over-exposure fairness (§8); dispute workbench (§18).
  - Regional expansion only after leakage + retention guardrails are green.
```

Everything the ExecMap put in "parallel tracks" (shops, groups, admin, PWA) still applies — but **gated behind moderation hooks** (§9) and built on the corrected schema.

---

## 23. CLIENT ARCHITECTURE & DISTRIBUTION — MOBILE-FIRST FOR A LOW-LITERACY USER BASE

> Added 2026-06-29 after the founder's decision: **the first client is native mobile (Android + iOS), with a responsive web app for desktop.** Rationale: Swat's user base is largely **low-literacy**, so users cannot reliably type a domain name into a browser. The entry point must be a **tappable app icon / a scanned QR / an installed APK shared over WhatsApp**, not a URL. This section supersedes every "PWA-first / web-first" reference in the v1.0 docs (e.g. v1.0 §MVP "Offline mode (PWA)", ExecMap Week 7 "PWA setup", "mobile apps = Phase 3"). Native mobile is now **Phase 1**, not Phase 3.

### 23.1 The decision and why it follows from the user, not the tech
The literacy constraint is an **architecture driver**, not a UI detail:
- **No URL typing** → discovery cannot depend on `kafil.pk` in a browser bar. It depends on an **icon on the home screen** and **physical/QR/shared-link distribution** (§23.4).
- **Low text fluency** → the UI must be **icon-, image-, and voice-first** (already in §12); native platforms give better camera/mic/voice access than a mobile browser.
- **Native push + native offline are core, not nice-to-have** → the liquidity loop (§11) and 2G/3G reality (§13) need reliable background push (FCM/APNs) and robust local storage, which mobile-web/PWA does **not** deliver reliably (iOS PWA push is crippled, background sync is limited).

Therefore the first-class client is **native**, and web is the **secondary/desktop** surface.

### 23.2 Chosen stack (recommended)
**Mobile (primary): React Native via Expo.**
- One TypeScript/React codebase → Android + iOS. Matches the founder's existing React/TS skillset (the whole v1.0 stack is React/Next).
- **Expo EAS Build** compiles iOS + Android **in the cloud** — no Mac/Xcode needed locally (critical in restricted dev environments).
- **Expo OTA / EAS Update**: ship JS bug-fixes instantly without app-store review — invaluable for a solo founder iterating during launch.
- Native modules for camera, mic/voice, geolocation/maps, push, secure storage, biometric.

**Web (secondary): Next.js 16** (the v1.1 web stack) for desktop/admin and a browser fallback. Reads the **same API**.

**Shared core (the DRY layer): a `packages/core` TypeScript package** imported by BOTH clients:
- Zod schemas + inferred types (§2 model, §1 P-shared-types)
- API client (typed fetch layer with idempotency-key + retry/outbox hooks, §13/§14)
- Business-rule helpers that are client-side safe (e.g. state-machine *display* logic from §4)
- i18n string catalogs (ps/ur/en, §12)

**Why not the alternatives (recorded so the decision is durable):**
- *Capacitor wrapping a Next.js web app* — best when web is primary and a web app already exists to reuse. Here mobile is primary and it's greenfield, so the reuse advantage is moot and native feel on low-end Android is worse. Keep as fallback only if web becomes co-equal.
- *Flutter* — excellent multi-platform, but Dart abandons the founder's React/TS investment and the shared-core-with-web story. Rejected on team-fit, not capability.
- *PWA-only* — fails the two hard requirements: app-store/installed-icon presence and reliable push/offline. This is exactly what the v1.0 docs assumed and what this section overturns.

### 23.3 Monorepo layout (refines §2's directory note; one repo, three deployable targets)
```
kafil/
├─ packages/
│  └─ core/                # SHARED TS: zod schemas, types, api-client, i18n, rule helpers
├─ apps/
│  ├─ mobile/              # Expo (React Native) — Android + iOS  [PRIMARY]
│  ├─ web/                 # Next.js 16 — desktop + admin + browser fallback  [SECONDARY]
│  └─ api/                 # the server: route → service → repository (§ P2)
│                          #   (can live in apps/web Next API routes initially,
│                          #    or split to its own service later — clients don't care)
└─ infra/                  # provider configs, IaC, distribution (APK host, QR/deep-link)
```
The **server is a separate concern from all clients** (P2). Whether it starts as Next.js API routes inside `apps/web` or as a standalone service, the mobile app talks to it over the same typed API — so we can split it out later with zero client change.

### 23.4 DISTRIBUTION — the real infra consequence of low literacy
This is the part the v1.0 docs completely missed. If users can't type a URL, **how the app gets onto the phone is a first-class system**, not a launch-day afterthought:

1. **Shared APK over WhatsApp (Android, the dominant device).** Host a **direct-download signed APK** at a stable short link + QR. WhatsApp is the de-facto channel (validated in the Audit) — a contractor shares the APK to his crew. Requirements: APK hosting/CDN, signing key management, an **in-app self-update check** (since side-loaded APKs don't auto-update via Play), and clear "allow install from this source" guidance in Pashto.
2. **QR codes everywhere physical.** Posters in bazaars, contractor shops, hotel lobbies (your seed channels in §15). QR → **deep link** that either opens the app or routes to install. A picture of a QR needs zero literacy.
3. **App stores as a secondary path.** Google Play + Apple App Store listings (localized icon, Pashto screenshots) for users who do search — but never the *only* path.
4. **Deferred deep links + install attribution.** When someone taps a shared job link (`kafil://job/123` / universal link) without the app, route them through install → land on that job. This also powers **referral attribution** (§10 F7) so the referral program rewards real installs, not noise.
5. **Tiny install footprint.** Low-end devices are storage-constrained (Audit research: "no space for apps"). Aggressively minimize APK size; lazy-load heavy modules (maps) post-install.

### 23.5 How this refines existing sections (not replaces)
- **§11 Notifications** → channel priority becomes **native push (FCM/APNs)** first, then in-app, then WhatsApp (opt-in, templated), then SMS. Native push removes much of the WhatsApp cost/ban pressure for transactional alerts. `devices.push_token` (§2.12) already models this.
- **§12 Localization/UX** → now explicitly native: device-level RTL, native voice input for job descriptions, native camera for work photos, large-tap-target icon-first nav. Honors device language for the ps/ur/en default.
- **§13 Offline/Sync** → upgraded from "PWA cache" to **native offline**: durable on-device DB (e.g. SQLite/WatermelonDB/MMKV) for the mutation outbox + idempotency keys (P4), real background sync, and optimistic UI. This is the environment where offline actually has to *work*, and native is why it can.
- **§19 Backlog** → "native apps" moves from Tier D to **Tier A/B** (it's the primary client). "Capacitor later" line in §19 Tier C is **removed/obsolete** — superseded by Expo from day one.
- **§22 Roadmap** → Weeks 1–2 now also: set up the Expo + Next.js + shared-core monorepo and EAS build pipeline; Weeks 7–8 "PWA setup" is replaced by "EAS build + APK distribution + QR/deep-link + store listings."

### 23.6 Updated high-level infra diagram
```
        ┌──────────────────────────────────────────────────────────┐
        │  CLIENTS                                                   │
        │  📱 Android app (Expo)   📱 iOS app (Expo)   💻 Web (Next) │  ← share packages/core
        └───────────────┬───────────────┬───────────────┬──────────┘
   distribution:        │               │               │
   APK+QR+WhatsApp,      │  same typed API (idempotent, offline-outbox)
   Play/App Store,       ▼               ▼               ▼
   deep links     ┌──────────────────────────────────────────────┐
                  │  API  (route → service → repository, P2)       │
                  │  state machine §4 · ledger §6 · T&S §9          │
                  └───────────────┬───────────────┬────────────────┘
                                  ▼               ▼
                         ┌──────────────┐  ┌──────────────────────┐
                         │  Database     │  │  Provider interfaces  │
                         │ (Postgres/    │  │  push(FCM/APNs) ·     │
                         │  Supabase;    │  │  sms/whatsapp · S3 ·  │
                         │  SQLite dev)  │  │  payments · geocode   │
                         └──────────────┘  └──────────────────────┘
```
Note the backend half is **unchanged from v1.1 §1–§18** — the mobile-first decision touches clients + distribution + push/offline, and reuses the entire server foundation. That reuse is the dividend of the layered design (P2).

---

## 24. DEEP AUDIT — REAL BUGS, RACES, AND FLOW FAULTS IN v1.1 (self-review)

> Added 2026-06-29 after a deliberate adversarial pass on this addendum. v1.1 fixed v1.0's existential issues, but it has its own bugs and edge cases. This section enumerates them with severity (S0 = will corrupt data or money / block users; S1 = will routinely produce wrong outcomes; S2 = degraded UX or operational pain), the **trigger** (how it actually breaks), and the **fix** (often a one-line schema/contract change, sometimes a new subsystem). Every fix here is now part of v1.1.

### S0 — Will corrupt data or money

**A1. Auth identity is a phone number — but phones get reassigned, SIM-swapped, and shared.**
*Trigger:* a SIM is reissued to a new person; they OTP-verify and **inherit the previous owner's reputation, wallet, and history**. Or a household phone is reverified by a different family member.
*Fix (now part of §2.1/§3):* require `account_recovery_secret` (a setup-time recovery code shown to user, or biometric-bound device) for any **re-verification of an existing phone**. On unfamiliar device + verified-phone match → treat as **new session under cooldown**: read-only for 24h, no money actions, no review-write, send a security notification to all old devices, log a `device_change` event. Add an immutable `account_history` row for every phone↔user binding so disputes/auditors can prove timeline. Without this, payments+ratings are unsafe.

**A2. The ledger isn't actually double-entry-safe as written.**
*Trigger:* `ledger_entries.txn_id` is described as "sums to zero per txn_id" but there's no DB constraint enforcing that, and `wallets.balance_minor` is a denormalized cache that can drift from the ledger. A partially-applied transaction (writer crash mid-loop) leaves money unaccounted for.
*Fix:* (1) **All ledger writes for one txn_id MUST be in a single `BEGIN/COMMIT`** at the application layer, no exceptions; (2) add a **deferred constraint trigger** `CHECK (SUM(amount_minor) OVER (PARTITION BY txn_id) = 0)` evaluated at commit; (3) **balances are derived, not authoritative** — there is a nightly reconciliation job that recomputes every wallet's balance from the ledger and pages on mismatch; cached `balance_minor` is a hint for queries only and is rebuilt on demand; (4) money operations are wrapped in a "ledger transaction" helper that guarantees balanced entries by construction, not by code review.

**A3. `assignments UNIQUE(slot_id)` blocks legitimate re-assignment after a worker no-shows.**
*Trigger:* Worker A is assigned to slot 1 → no-shows → state `no_show`. Employer tries to re-fill the slot with worker B. Insert fails because the **old** assignment still occupies the slot via the unique key.
*Fix:* relax to `UNIQUE(slot_id) WHERE status IN ('assigned','confirmed','in_progress','awaiting_employer_confirm','disputed')` — i.e. terminal states (`no_show`, `cancelled_by_*`, `declined`, `expired`, `completed`) don't hold the slot. The slot's own status field (`open|filled`) is the gate, not assignment uniqueness.

**A4. "Slot reopens" on no-show/cancel has no recompute of the **job-level** state.**
*Trigger:* a `filled` job has one assignment go `cancelled_by_worker` → slot reopens → job is still recorded as `filled` because §4.1 says `open → filled` is *derived* but the **transition back to `open`** is only described as "if … a slot reopens"; no atomic procedure is given. Job-feed shows it as filled, no one applies, the position rots.
*Fix:* every state transition that frees a slot calls `recomputeJobState(jobId)` inside the **same transaction**: if `count(open slots) > 0 AND job.status='filled'` → `job.status='open'`, bumped version, event emitted, notifications sent to the matching worker pool. Make this a single stored procedure or service helper so it can't be forgotten at a call site.

**A5. `applications UNIQUE(job_id, worker_id)` blocks legitimate re-application after rejection.**
*Trigger:* a worker is rejected (or withdraws). Job remains open, worker improves description or reduces rate, wants to re-apply. Insert fails.
*Fix:* either (a) on rejection set application to terminal status and **allow a new row** (drop the unique constraint, replace with a `UNIQUE(job_id, worker_id) WHERE status IN ('pending','shortlisted','accepted')` partial index — same pattern as A3), or (b) keep one row and allow status to cycle (`rejected → pending`) with an event audit trail. Recommend (a) — cleaner history. Pair with **per-job application velocity limits** (§10 F3) so a worker can't spam re-apply.

**A6. The auto-complete fallback on §4.3 ("only one party marked done → auto-complete in employer's favor for cash jobs") is dangerous.**
*Trigger:* worker marks done. Employer ghosts past `T`. v1.1 says "auto-complete in employer's favor for cash." But this is exactly the **non-payment fraud** F6 — the worker did the work and the employer "wins" by going silent. Worse, the worker can't even leave a review until *both* mark done in the simplest reading of §7, so silence becomes a reputation-defense weapon.
*Fix:* **invert the default for cash mode** — if a job is in `awaiting_employer_confirm` past `T`, auto-complete in **worker's favor** (record completion, allow worker review to publish at window close, increment employer's `payment_reliability_signal_silent_completion` counter). Counter-fraud: employer can still open a dispute within window to contest. For **escrow mode**, the funds are held → auto-release to worker on T (the entire point of escrow). The §4.3 row is updated accordingly. Document in §7: **reviews always publish at window close regardless of whether the other side reviewed** — silence cannot suppress a review.

**A7. `idempotency_keys` has no scope on which user.**
*Trigger:* User A's request retries with key `X`. Network noise causes the key to land on User B's session (token swap, shared device, attacker). Server returns User A's cached response to User B.
*Fix:* `idempotency_keys` PK is `(user_id, endpoint, key)` not just `key`; mismatched user → treat as a new key. Hash request payload and verify it matches the original; mismatched payload → 409 (different request, same key). Add `created_at + TTL` reaper (e.g. 24h).

### S1 — Will routinely produce wrong outcomes

**B1. PII redaction in chat (`messages.body_redacted`) is described but not specified — easily defeated.**
*Trigger:* users defeat regex with Pashto/Urdu digit spelling, Eastern-Arabic numerals, leetspeak, embedded in images, "call me 3 0 0 ones two threes". Naive phone regex catches ~30%.
*Fix:* this is a real ML/heuristic system, not a regex. The contract is: (1) **normalize first** (Eastern-Arabic→ASCII digits, spelled-out digits→digits, NFC unicode); (2) **multilingual entity detection** (ps/ur/en) for phone-like sequences, social handles, URLs; (3) **OCR every uploaded image in chat** for embedded contact info; (4) policy is **soft-redact + warn**, not hard-block — first offense replaces with `[hidden — share contact only after job is confirmed]`, repeat offenses raise friction; (5) **log every attempt as `fraud_signals.signal='contact_in_message'`** with the original text in a moderator-only audit field. The contract belongs in §5/§10 with a working baseline and an explicit "this is iteratively improved" — don't pretend it's solved.

**B2. The state machine has no `paused` / `partial_complete` for multi-day jobs.**
*Trigger:* a 10-day construction job. Day 4 it rains for two days. Day 6 work resumes. v1.1 has no way to model "work paused, no penalty"; `in_progress` just ticks on. Rate disputes ensue ("you owe me 10 days") ("but you only worked 8").
*Fix:* add `paused` substate of `in_progress` with reason (`weather|materials|illness|other`) and timeline events. The `rate_unit='day'` calculation reads worked-days from `work_log` (new lightweight table: `assignment_id, day, hours, marked_by`) instead of assuming `start_date + duration_days`. Both parties confirm work-log entries; mismatches become disputes on the *day*, not the whole job. This is the difference between a toy marketplace and one that handles real construction.

**B3. The 24h chat window / WhatsApp template constraints in §11 aren't reflected in the notification scheduler.**
*Trigger:* job match notification is generated at 3am Pakistan time → scheduler dispatches WhatsApp message → user wasn't in a 24h session → fails delivery quietly OR sends a template not approved → number quality tier drops → eventually banned.
*Fix:* the notification scheduler (§4.4) must check, per delivery: (1) channel preferences + quiet hours (§2.12); (2) for WhatsApp: is there an active 24h session? If yes → free-form OK; if no → MUST use an approved template, otherwise route to **next channel in fallback chain** (SMS or in-app + push). (3) Rate-limit per recipient per day (configurable, default 3 transactional + 1 digest). (4) Cost-budget guard: stop discretionary WhatsApp sends if monthly budget exceeded; transactional still go via SMS. (5) **Dead-letter queue** for failed deliveries with retry-with-backoff; pageable if dead-letter grows.

**B4. The escrow→completed release in §6 isn't sequenced safely with the review window.**
*Trigger:* job completes → escrow auto-releases to worker → 12 hours later employer submits a 1-star review citing damage → worker has already been paid → dispute now has to *claw back* money, which often fails (worker spends it, withdraws).
*Fix:* **funds release after dispute window closes**, not at `completed`. Add states: `completed → in_review_window → finalized`. Release ledger txn fires only on transition to `finalized`. Review window default 48h; opening a dispute pauses the timer. Employer can extend window once for documented cause. This is the **Airbnb/Upwork pattern** — funds are held a beat longer than reviews are written.

**B5. Reputation/Bayesian score is recomputed in `worker_profiles.rating_bayesian` "on new review" with no concurrency guard.**
*Trigger:* two reviews land in the same second (race), each reads stale aggregate, each writes its own new aggregate, one overwrites the other → permanent drift from truth.
*Fix:* either (a) compute lazily on read from the `reviews` table (correct, slightly slower — fine for v1) and treat the column as a denormalized cache rebuilt by a job; or (b) compute in DB with a single UPDATE that selects/aggregates atomically. Same applies to `jobs_completed`, `no_show_count`, etc. **No application-level read-modify-write of aggregates.**

**B6. `worker_availability` calendar is decoupled from `assignments` — they can disagree.**
*Trigger:* worker manually sets `2026-07-10 = busy`. Employer accepts an assignment that requires that date because the matcher only checked the `assignments` table. Worker is now "double-booked" by the platform's own action.
*Fix:* availability is **derived from assignments + manual overrides**, with assignments authoritative. The matcher reads a **computed view**: `unavailable = union(assignments overlapping date, manual_busy)`. Manual `available` cannot override an assignment-derived `busy`. On assignment terminal-cancel, derived busy clears automatically (§2.6 `source='derived'` is the right field; the rule was just missing).

**B7. The matching score (§8) has no diversity/freshness guarantee for **employer-side** results.**
*Trigger:* employer keeps re-hiring the same top-3 workers (the over-exposure penalty was specified for *worker* side). The long tail still starves on the supply side, just from the demand side this time.
*Fix:* symmetric over-exposure: penalize re-recommending the same worker to the same employer beyond N suggestions without engagement; cap "top 3 forever" effect by mixing in newcomer fairness boost in employer-facing results too.

**B8. Disputes can be opened on a finalized assignment (§4.2 says "any active state") — but reviews and money may already be done.**
*Trigger:* job finalized → 30 days later employer says "the wall fell down, this was bad work" → opens a dispute → engine doesn't know what to revert.
*Fix:* explicit **dispute window** (e.g. 7 days post-finalize), beyond which a complaint becomes a **report** (§9), not a dispute. Reports can lead to moderation actions and reputation flags but cannot reverse money/reviews. Document in §4 and §9.

**B9. Geo precision is a privacy leak.**
*Trigger:* worker's `base_location_id` is a pin near their home. Employer-facing UI shows distance/map → effectively reveals home address to a stranger.
*Fix:* never expose worker pins to non-matched employers. Show **fuzzed location** (tehsil centroid or 1km H3 cell) until an assignment is confirmed; only then reveal landmark-precise location *if needed for the job*. Same for jobs in residential areas. Add `location_privacy_mode` and a server-side fuzzing helper used in every list/search response.

**B10. No idempotency on **state-machine transitions** themselves.**
*Trigger:* employer taps "Accept" twice on a flaky network. First request lands, version increments, slot fills, assignment created. Second request reads stale state, fails version check, returns 409. The client retries the **original** Accept against the now-filled slot — server says 409. UI shows error. User panics, taps again. Eventually the user sees an error even though the action succeeded.
*Fix:* every transition endpoint accepts an `Idempotency-Key` keyed on `(user, action, target_id)`; on replay returns the **original successful response**, not a 409. The `idempotency_keys` table (A7-fixed) already stores responses; transition endpoints **must** use it. This was specified in P4 but missed at the §4.3 endpoint contracts — adding now.

### S2 — Operational pain, will not block launch but will cause incidents

**C1. The `events` table will grow without bound** (§2.12, P3). 1M users × ~50 events/user/month = 50M rows/month. Without partitioning, queries on this table will degrade and dumps for analytics will time out.
*Fix:* monthly **partition by `occurred_at`** in Postgres; export to a cold store (S3/Parquet) after 90 days; analytics queries go to the cold store. Document retention in §17 (privacy: events are PII-bearing — apply user-erasure to old partitions too).

**C2. Soft-delete is mentioned ("assumed on all tables") but not specified.**
*Trigger:* user requests data erasure (§17). Some references chain (reviews on disputed assignments → other party's reputation). Naive cascading delete corrupts the other party's history; naive soft-delete leaves leakable PII.
*Fix:* a documented **erasure policy** per entity: `users` → anonymize (`display_name='Deleted user'`, `phone_e164=NULL`, `cnic_hash=NULL`) but **keep ID + reviews + ledger** for the counterparty's audit trail. Document in §17 with a per-table table.

**C3. Race in the scheduler / time-based transitions.**
*Trigger:* two scheduler instances both detect "this application has been pending > 24h" and both fire `applied→expired` at once. The transition is idempotent (good) but double notifications and double event rows appear.
*Fix:* leases / advisory locks per transition target (`SELECT pg_try_advisory_xact_lock(hash('expire-app', id))`). Or single-writer scheduler with horizontal scale via partition keys. Document in §4.4.

**C4. No "report-only / phase-out" lever for breaking changes to the matching/ranking model.**
*Trigger:* you ship a new ranking weight, conversion drops 30%. No way to A/B or revert quickly.
*Fix:* ranking weights are **feature-flag-scoped** (§2.12 `feature_flags.scope` already supports it); add a built-in **shadow-eval** path that runs new weights without exposing results, logs counterfactuals to `events`, and a rollback toggle.

**C5. Storage provider is "S3 or local" but image lifecycle (orphans, virus scan, EXIF, abuse) is unspecified.**
*Trigger:* drafted-then-discarded job uploads orphan in S3 forever; a malicious image (CSAM, malware) is hosted on KAFIL's domain; EXIF reveals exact GPS of the worker's home.
*Fix:* (1) **upload to a quarantine bucket**, server runs EXIF-strip + virus scan + (where laws permit) a CSAM hash check (PhotoDNA or equivalent) → only then move to public bucket; (2) presigned URLs with short TTLs; (3) **orphan reaper** job: any image not referenced by an entity within 24h is deleted; (4) abuse reports can revoke images and add hashes to a blocklist. This is non-negotiable for a public consumer app.

**C6. Native mobile (§23) inherits the offline outbox (§13) but doesn't say which mutations are queueable vs. require online.**
*Fix:* explicit allowlist in code (and §13): `application.create`, `assignment.cancel (pre-start)`, `message.send`, `review.submit`, `availability.update` → queueable. `payment.fund_escrow`, `payout.withdraw`, `dispute.open`, `account.update_phone` → **online required**, fail fast. Otherwise users will queue money actions and be confused by long-delayed errors.

**C7. Push notification token lifecycle is missing.**
*Trigger:* user reinstalls app → new FCM token; old token still active in `devices.push_token` for hours → notifications go to the old token (silently dropped) and the user "stops getting notifications." This is the #1 cause of "the app is broken" support tickets in mainstream consumer apps.
*Fix:* device registers token on every cold start; backend dedupes by `device_fingerprint + user_id`; **FCM/APNs unregistered-token callbacks** flip the row to `inactive` immediately. Add observability: % of pushes delivered, % bounced as unregistered (§16).

**C8. The "concierge / hand-matched first 100 jobs" of §15 has no system support.**
*Fix:* add a `match_source` field to `assignments` (`organic|concierge|admin_seed`), surface a concierge console in §18 ops, and instrument outcomes (concierge-matched jobs' completion rate, retention of those workers). Otherwise this strategy isn't measurable and quietly fails.

---

## 25. WHAT A MAINSTREAM 1M-USER APP HAS THAT v1.1 STILL DIDN'T

> v1.1 is now correct and bug-fixed (§24). But "correct" is not "mainstream." Below are the features and details great consumer apps (Airbnb, Uber, Bykea, Foodpanda, Upwork, OLX) have that low-literacy users in particular *expect*, even if they couldn't articulate them. Each entry says what to add and which v1.1 section it slots into.

### 25.1 Onboarding for users who can't read

- **Voice-guided onboarding** (recorded Pashto/Urdu narration, not TTS) walks the user through each step with a "tap when you hear what you want" pattern. ≤ 5 screens, ≥ 1 voice prompt per screen. Slot into §12.
- **Picture-based specialty picker** with audio labels — tap the icon, hear "mason" in Pashto. Already in §2.1 (`specialties.icon`); add `name_audio_url` columns and an authoring tool.
- **First-time user concierge** — for the first N sessions, route every "I need help" tap to a real human in-app chat (cheap at small scale, builds trust). Sunsets with feature flag once self-service onboarding completion rate > X%.
- **Demo job / sandbox**: a fake employer ("Ahmad's Test Job") that always exists in the worker's feed so they can practice applying without commitment. Critical for low-tech users.
- **Progress nudges**: incomplete profile gets a friendly "You're 60% done — add a photo to get 3× more jobs" with the actual conversion number, in Pashto, with a voice prompt.

### 25.2 Trust signals every consumer expects

- **Verified badges** with explicit meaning ("Phone verified", "CNIC verified", "10+ jobs completed", "Local trusted") — multiple narrow badges beat one fuzzy "verified" star. Slot into §7 (multi-signal reputation).
- **Identity photo with liveness check** during CNIC verification (selfie + blink) to prevent stolen-CNIC fraud. Slot into §9 KYC level 2.
- **In-app "Safety center"**: how to report, what to do if scammed, how disputes work, the "you never pay to apply" message (F1 defense). In Pashto + voice. Slot into §9.
- **Public "Trust & Safety report"** posted quarterly: # bans, # disputes, # scams stopped. Builds platform credibility (Airbnb, OLX do this). Slot into §16/§18 outputs.
- **"Last active" status** on workers (online now / today / this week) — single biggest match-rate booster in informal-labor markets. Already implied by §2.12 `devices.last_seen_at`; surface it.

### 25.3 The "make money with one tap" features

- **Job templates**: "Repost last week's plumber job" — one tap, edits the date. Repeat employers are 80%+ of revenue in mature marketplaces; v1.1 §5 mentions "one-tap re-hire" but not templates.
- **Recurring jobs**: weekly cleaning, monthly maintenance. Schema: `jobs.recurrence_rule` (RRULE-ish) + a generator that spawns child jobs N days ahead. Slot into §2.3.
- **Crews / teams**: a "contractor" entity that bundles workers, posts a single job, and distributes payouts internally. Common in construction. Schema: `crews`, `crew_members`, `crew_payouts`. Slot into §3 (a role variant of `employer_profiles`).
- **Counter-offer / negotiate-rate**: worker proposes a rate other than the posted one without rejecting. Schema: `applications.proposed_rate_pkr` (already there!) but **no UI/flow** is specified — add explicit negotiation messages with an Accept/Counter button pair. Slot into §4.
- **Tip / bonus** at completion: employer adds 500 PKR for great work. Schema: a ledger reason `tip`. Powerful for retention and rating quality. Slot into §6.
- **Group hire / coop discount**: 5 contractors pool an order for cement. Already alluded to in shop monetization but no schema — add `group_orders` for shops.

### 25.4 Anti-friction "of course it works" details

- **Resume after kill**: if the app is force-quit mid-job-post, opening it returns to the same step with all fields preserved (mobile §13 outbox extends to drafts).
- **Suggested rate** based on recent jobs in the area for the same specialty (§8 collects the data; surface it during posting). Removes lowballing and bait-and-switch (F12).
- **"Why don't I see workers?" empty states** with specific suggestions ("Widen your radius", "Try evening", "No masons available this week — get notified when one is free") instead of a blank list. **Empty states are a UX surface, not an error condition.**
- **Universal back gesture / hardware-back on Android** routes intelligently (don't pop the user out of the app on accidental swipe).
- **App size < 25MB initial** for shared-APK distribution; lazy-load maps/calendar/heavy charts.
- **Native Pashto keyboard support** + Eastern-Arabic numeral input for users who type that way.
- **Loading states are real content placeholders** (skeleton screens), not spinners. Spinners feel broken on 2G.

### 25.5 Support and self-service every mainstream app has

- **In-app help center** with searchable Pashto FAQ + voice playback for each article. (Saves 80% of support tickets in mature apps.)
- **One-tap "Contact support"** that pre-fills user/device/job context — agent doesn't have to ask "what's your phone number." Slot into §18.
- **Ticket transparency**: status visible in-app ("we're looking into it — usually 4 hours") with SLA. Reduces "is anyone there?" duplicate tickets.
- **Pre-emptive support**: if a payment fails or a notification didn't deliver, surface it *in* the app proactively, before the user files a ticket.

### 25.6 Growth loops the v1.1 backlog should bake in (with anti-abuse, §10)

- **Referral rewards triggered on referred-user's first *completed* job** (already in §10 F7 — surface in product).
- **Shareable job cards / worker profile cards** (image preview, WhatsApp-share) → drives discovery in the channel users already live in. Deep-link back into the install or app (§23.4).
- **Streaks / badges** for workers: "5 completed jobs this month" → 5% boost in ranking (capped) and a public badge. Drives habit. Beware: must not be gameable (count only after review-windowed completion).
- **Re-engagement campaigns** based on `events`: dormant 14 days + matching new job in area → push. Throttle (§11), respect quiet hours.
- **Local champions program**: top 1% of contractors get early features, a verified-pro badge, and a small commission cut. Cheap, high-loyalty.

### 25.7 Localization beyond §12

- **Local festivals/holidays** in the calendar: Eid, Ashura, harvest week — auto-pause certain notifications, surface "Eid Mubarak" splash. Increases warmth.
- **Hijri date display option** alongside Gregorian.
- **Tehsil-level dialect packs** (Yusufzai vs. Kalami Pashto) — minor strings differ. Schema is ready (i18n catalogs); content authoring isn't.
- **Local currency formatting** (commas vs. lakh notation: "1,50,000" vs "150,000").
- **Numerals toggle** (Eastern-Arabic vs. Western) — already mentioned in §12, raise it to a settings-screen control.

### 25.8 The "boring" operational features that make a 1M-user app survive

- **Versioned API** (`/v1/`, `/v2/`) with deprecation headers and a forced-upgrade gate when an old app is dangerously incompatible (e.g. money model change). Surface in §1/§22.
- **Forced-upgrade screen** for the mobile app when the server reports the client is too old (`X-Minimum-Client-Version` response header). Required for emergency fixes when 5% of installs are 6 months old.
- **Feature kill-switches** distinct from gradual rollout — instant "off" for a misbehaving subsystem (already in §2.12; reiterate operational doc in §18).
- **Status page** (status.kafil.pk) and an **in-app incident banner** ("Payments are delayed; we're working on it") fed from one source. Reduces support load dramatically during incidents.
- **Read replicas + cache layer (Redis)** for hot reads (job feed, worker search). Existing tech stack mentions Redis (v1.0 §Tech Spec) but cache-invalidation strategy isn't defined: invalidate on `job.posted/updated`, `application.created`, `assignment.transitioned`; TTL 60s as the floor.
- **Database connection pooling + statement-level timeouts** (`SET LOCAL statement_timeout = '3s'`) so one slow query doesn't tank the API.
- **Backups + restore drills**: nightly + PITR; **a monthly tested restore** (most teams' backups don't actually restore). Document the runbook in §18.
- **Multi-region / failover plan** by the time you cross ~250k MAU — single-region outage will hurt the brand at 1M.
- **Cost dashboards per provider** (Vercel, S3, JazzCash, WhatsApp/Twilio) wired into the alerting in §16. A runaway loop in a notification template can put you out of business in a week if uncaught.

### 25.9 Privacy controls users in Swat actually need

- **"Hide my profile from public" mode** (still discoverable to matched employers) — for women workers, for cautious users (§12 social dynamics).
- **Block list** at the user level — blocked party doesn't see your jobs/profile and can't message you. Schema: `user_blocks(user_id, blocked_id)`.
- **Granular phone-visibility settings**: "show only after confirmed", "never show — chat only". Reinforces §5 anti-leakage.
- **Two-way ratings only after both confirmed** is already in §7; also add: **deletable own reviews within 24h** for typos/oversharing (audit-logged so it can't be used to gaslight).

### 25.10 A handful of features users *don't* think they need but the data shows they do

- **Auto-translate** for chat messages (worker writes Pashto, employer reads in Urdu) — bridges cross-tehsil/cross-language hires.
- **Voice messages** in chat (lower literacy bar than typing).
- **Receipts** (PDF/image) of completed jobs — workers screenshot these for self-employed evidence even before formal income certificates exist.
- **Family invite** — many users are added to KAFIL by a more tech-literate son/nephew; native flow for that ("invite your father — fill in his info, he confirms by tapping the WhatsApp link").

---

These additions land KAFIL in the same operational tier as mainstream apps. §24 makes it correct; §25 makes it mainstream. The v1.1 schema and architecture already support most of §25 with **additive** changes — no rewrites — which is the dividend of the layered design (P2).

---

## 26. SECOND-RUN AUDIT — META-REVIEW OF §24/§25 AND CATEGORIES NEITHER COVERED

> Added 2026-06-29. A second adversarial pass over v1.1, now treating **§24 and §25 themselves** as code that might be buggy, and asking which broad categories the first audit didn't even open. Severity convention same as §24 (S0/S1/S2). Where this section conflicts with §24, **§26 wins** (the change log records it).

### 26.A Bugs introduced by §24's own fixes

**M1 (S0). §24/A6's inversion is itself exploitable: collusion or worker-only fraud.**
*Trigger:* §24/A6 said "if employer is silent past T, auto-complete in worker's favor" to stop F6 non-payment. But now: a worker can mark `done` on a job that wasn't actually done, the employer (who genuinely doesn't know to act, e.g. low-literacy, traveling, lost phone) goes silent → worker auto-completes, publishes a self-favorable review, and (in escrow) takes the money. Worker-only fraud just swapped places with employer-only fraud.
*Fix:* the asymmetry must be *evidence-based*, not directional. Replace A6 with: **silence past T does NOT auto-complete by itself.** Instead:
- The active party gets escalating nudges (push, in-app, SMS), then a **callback from KAFIL ops** for cash mode or a **mandatory mediation hold** for escrow.
- Auto-completion only fires when at least one **verifiable signal** is present: photo evidence from the active party + geofence ping at job site at the right time + chat history showing reciprocal acknowledgment. (Any 2 of 3 thresholds, configurable.)
- If no verifiable signal → the assignment enters `awaiting_ops_review` (not auto-completed in either direction) and is routed to the dispute workbench (§18). This is the *correct* fail-safe: humans-in-the-loop for ambiguity, never algorithmic theft of either side's claim.
- For cash mode at MVP scale, this volume is small; for escrow at scale, the **default ops headcount is computed from expected silence rate** (instrument & staff accordingly — see M22).

**M2 (S1). §24/A2's deferred constraint isn't trivially portable.**
*Trigger:* I prescribed a `CHECK (SUM(amount_minor) OVER (PARTITION BY txn_id) = 0)` deferred constraint. Postgres doesn't allow window functions in `CHECK`; it needs a constraint trigger or a transactional integrity check via `DEFERRABLE INITIALLY DEFERRED` on a separate aggregate table, **and the local-dev SQLite story (§22) has neither**.
*Fix:* the contract is "no ledger txn commits unbalanced," implemented as: (a) **a service-layer `LedgerTransaction` helper** that constructs balanced entry-pairs by construction (impossible to call wrong); plus (b) a **constraint trigger** in Postgres (`AFTER INSERT ON ledger_entries DEFERRABLE INITIALLY DEFERRED` that aggregates and raises if non-zero); plus (c) **a per-test integrity check** in CI. SQLite dev path uses (a)+(c). Never rely on the `CHECK` form I wrote.

**M3 (S1). §24/A7's idempotency key by `(user_id, endpoint, key)` doesn't cover server-to-server webhooks.**
*Trigger:* JazzCash sends a duplicate webhook. There is no `user_id` on a webhook handler. Falls back to keyless dedup or duplicates payment events.
*Fix:* webhooks dedupe by `(provider, provider_ref, event_type)` — a separate uniqueness pattern stored in `webhook_events(id, provider, provider_ref, event_type, payload_hash, processed_at, UNIQUE(provider, provider_ref, event_type))`. First insert wins; replay returns 200 without re-acting. This was missing entirely.

**M4 (S1). §24/B4's "in_review_window → finalized" sequencing breaks the worker cash-flow expectation in mobile-money culture.**
*Trigger:* I added a 48h hold after `completed` to make clawback possible. But Pakistani daily workers expect **same-day** money; a 48h hold via the platform is *worse* than the cash settlement they had before, and a major reason to leave the platform (anti-anti-disintermediation).
*Fix:* tier the hold by risk: **default hold = 0h for low-risk jobs** (small amount + both parties have history + no dispute signals) → release at `completed`; **24–48h hold for medium risk** (new employer, high amount); **manual review for high risk**. Risk score derived from §9's `trust_score` + amount band + history depth. Communicate the hold up front during job acceptance so the worker isn't surprised. Same outcome (clawback possible when it matters), better UX (instant pay when safe).

**M5 (S2). §24/B1's OCR-of-every-chat-image is a privacy/compliance hazard.**
*Trigger:* I prescribed OCR on chat images to find phone numbers. But chat images include CNICs (workers showing employers their ID), medical receipts, women's photos that mustn't be processed by a third-party OCR service. OCR running on a US-hosted ML API may violate PECA on PII export.
*Fix:* OCR runs **server-side and on-region** (on-device or in-region Pakistani cloud), output is **never persisted in plaintext**, and the user is **consented at upload** ("we scan images for safety — your photo is not stored or shared"). Add image-class detection so we don't OCR images flagged as CNIC/medical — those go straight to encrypted blob storage with no scan. False-negatives on contact-leak are acceptable; processing CNICs through OCR is not.

### 26.B Auth & account lifecycle — barely touched by §24

**M6 (S0). No multi-device session model.** Workers share phones with family; contractors use both phone + tablet. v1.1 §3 has `users` + `devices` but no concept of **active sessions** with revocation. A stolen phone has indefinite access until phone is re-verified.
*Fix:* `sessions(id, user_id, device_id, issued_at, last_seen_at, revoked_at, refresh_token_hash, scope)`; access tokens short (15min), refresh tokens rotate, revocation is instant per session. "Sign out everywhere" surfaces a list of devices and last-seen city/IP.

**M7 (S1). Account recovery has no path when the phone is lost.** §24/A1 added the recovery secret but didn't specify *how* a low-literacy user uses it when their phone is gone (the screenshot is on the lost phone).
*Fix:* recovery secret is **also dictated as a 6-word Pashto/Urdu phrase** (BIP39-style but in script users can read), printed by the contractor evangelist (§15) onto a physical card during onboarding. + Secondary recovery: **two trusted contacts** vouch on KAFIL → KAFIL ops verifies via voice call → cooldown then restore. This is the consumer-app pattern that actually works in low-literacy contexts (M-Pesa, EasyPaisa do this).

**M8 (S1). KYC level cliff causes user lockouts.** §6 gates escrow at `kyc_level >= 2`. A worker is mid-escrow-funded-job, their CNIC verification expires/lapses → they're locked out of payout for an active assignment.
*Fix:* KYC is a **versioned attribute**, not a current-state gate. The job snapshots the user's KYC level **at acceptance time** in `assignments.kyc_snapshot`. A later KYC lapse cannot orphan an in-flight job. New jobs respect current state.

**M9 (S2). No CNIC uniqueness enforcement.** Two `users` can complete CNIC verification with the same CNIC (the hash isn't unique). Lets a banned actor return.
*Fix:* `users.cnic_hash UNIQUE` (partial index `WHERE cnic_hash IS NOT NULL`). Banned-CNIC list is a separate moderation artifact (`banned_identities`) that blocks re-verification.

### 26.C Search, ranking & feed reality at scale

**M10 (S1). v1.1 §8 specifies a scoring function but no search infrastructure.** At 1M users with PostGIS distance + multi-criteria filtering, naive SQL is unusable past ~50k jobs.
*Fix:* **a dedicated search index** (Meilisearch / Typesense / OpenSearch — Meili is the lightest and Pashto-friendly enough). The Postgres tables are the system of record; the search index is rebuilt from `events` + change-data-capture. Feed reads go to the index, never to live SQL. Document the indexing pipeline (changes → outbox → indexer → search store, with eventual-consistency contracts in §16).

**M11 (S1). The matching score has no feedback loop / online learning hook.** Weights are static; conversion isn't fed back. By month 6, ranking is whatever I guessed at on a whiteboard.
*Fix:* every job impression/click/apply/accept/complete logs to `events` keyed to the *ranking decision* (`event.payload.ranking_id` + `position` + `score_components`). A nightly job computes per-segment uplift; weights are tunable per flag scope (already in §2.12). Migration to a learned ranker (§19 Tier D) just consumes that log.

**M12 (S1). Stale feeds on low-bandwidth.** A worker scrolls a feed from 6h ago (offline cache, §13) and applies to a job that filled an hour ago. Server rejects; worker sees error after committing attention to write a message.
*Fix:* feed cells carry a **freshness watermark**; on application submit, server returns 409 with the **fresh feed slice** for that area so the UI replaces the stale row inline ("This job filled — here are 3 similar ones"). Standard mobile pattern; absent in v1.1.

**M13 (S2). "Job posted at 10pm" gets the same notification priority as "in-progress urgent."** §11 has priorities but no actual priority schema.
*Fix:* `notifications.priority ENUM('urgent','transactional','engagement','promo')` with delivery + quiet-hour + frequency-cap rules per tier in §11. Urgent (worker no-show alert, dispute action) bypasses quiet hours; engagement/promo never do.

### 26.D Geographic & map edge cases

**M14 (S1). Cross-tehsil discovery is artificially throttled by hyperlocal trust (Audit research) but never modeled.** A contractor 25km away can't see a fast mason 5km away in another tehsil if the default radius is tighter.
*Fix:* a two-radius search: **inner radius (default 10km) = full reveal**; **outer radius (configurable) = partial reveal** (count + "tap to expand"). Trust is hyperlocal but supply often isn't.

**M15 (S2). Map tiles + offline maps are an unsolved sub-problem.** v1.0 mentioned "offline map 20-30MB." Realistic vector tiles for Swat are larger; Google/Mapbox have licensing costs at scale.
*Fix:* **MapLibre + OpenStreetMap-derived self-hosted tiles** for the marketplace, plus on-device tile cache around the user's home (preload). Avoid Mapbox/Google billing at 1M users.

**M16 (S2). Time zones / DST nuance.** Pakistan doesn't currently observe DST, but jobs scheduled across diaspora hires (§v1.0 Region 5) need correct UTC handling. Storing dates as `DATE` (§2.3 `start_date`) drops timezone entirely.
*Fix:* `start_at TIMESTAMPTZ` for time-precise jobs (hour-rate work, hotel shifts); keep `start_date DATE` for day-rate. Diaspora flows: explicit timezone on the employer profile, conversion in display only.

### 26.E Payment edge cases v1.1 didn't enumerate

**M17 (S0). Refund routing on cancelled-escrow.** Employer funded escrow, worker cancelled pre-start. §6 says "auto-refund." But: the funding payment may still be in `pending` at the PSP (Easypaisa settle T+1). Refunding before settle → broken bookkeeping.
*Fix:* explicit state on `payments.status` — refunds wait until `succeeded`. The escrow wallet shows the user "Funds returning — completes when bank confirms (usually next day)." Same pattern needed for failed refunds (PSP rejected) → automated retry + alert + manual fallback.

**M18 (S1). FX, since diaspora pays in USD/AED.** §v1.0 Region 5 envisions diaspora hires. KAFIL holds escrow in PKR but receives in USD. Currency conversion timing risk + accounting headache.
*Fix:* **wallets are per-currency** (already in `wallets.currency`, good), explicit FX entries in the ledger (`reason='fx_conversion'`, two wallets), FX rate snapshotted at fund-time and at release-time. Currency loss/gain becomes a real ledger line. Out of scope for MVP but the schema must already support it (no painful migration later).

**M19 (S1). Sales-tax / KP service tax on platform fees.** Audit Gap 4 says GST not applicable. But **KP Sales Tax on Services** can apply to platform commission depending on classification (this is a real PK fintech ambiguity).
*Fix:* tax is a **separate ledger reason** (`tax_collected`, `tax_remitted_pkst`), so it's auditable regardless of legal classification. Tax-classification decision is an §17 question; the *system* records it from day one. Don't bake commission as a single net number.

**M20 (S2). Chargebacks / disputes against KAFIL by the funding bank** — distinct from §9 in-platform disputes. A funded escrow can be charge-backed by the issuing bank weeks later.
*Fix:* add `chargebacks` linked to `payments`, with state (`alleged|won|lost`) and ledger reversals; surface this in employer reliability score (chargeback rings are a real fraud pattern). Pageable when chargeback rate > threshold.

### 26.F Mobile platform realities §23 hand-waved

**M21 (S0). Apple Developer access from Pakistan is hard.** Apple Developer accounts require credit-card billing + sometimes Apple ID region issues for Pakistani solo founders. EAS still needs the cert.
*Fix:* document this risk in §23 — provisional **Android-first launch** is the right path (Android is ~95% of low-end share anyway), iOS launch deferred until either (a) developer account is obtained or (b) a US/UK collaborator co-signs. Don't gate launch on iOS.

**M22 (S1). Push notification reliability on Chinese OEMs (Vivo, Oppo, Xiaomi, Realme — large share in PK).** These OEMs aggressively kill background services; FCM delivery rates can be < 60% without per-OEM tweaks (battery whitelisting, autostart permissions, MIUI/ColorOS workarounds).
*Fix:* in-app onboarding screen *with a brand-specific guide* (detected via `Build.MANUFACTURER`) instructing the user to enable autostart/battery exemption. Plus a server-side **fallback to SMS** when push hasn't been acknowledged in N minutes for urgent notifications. Plus measure **push success rate per OEM** in §16 — this will be a top KPI.

**M23 (S1). Android signed-APK update model.** Users who installed the shared APK (§23.4) don't get auto-updates. App checks server for `min_version` and self-prompts to update; if user ignores, the **forced-upgrade gate** from §25.8 kicks in. Specify: the in-app updater **must NOT** download an APK from KAFIL's servers and self-install — that requires special permission and looks like malware. Instead: deep-link to Play Store *if installed*, else open the kafil.pk/download page and instruct re-install.
*Fix:* `min_supported_version` and `recommended_version` are server-side flags; client behavior is in code; the doc explicitly lists the **anti-pattern** to avoid.

**M24 (S2). Expo OTA limits — JS-only updates.** Native module changes still require a full rebuild + APK reshare. Plan release cadence accordingly; communicate to users when a "full update" is needed (rare but disruptive).

**M25 (S2). React Native + low-end Android performance.** On 2GB-RAM devices (common), heavy lists and image-heavy feeds crash. Mandatory: `FlashList`, image dimension constraints, virtualization, memory budgets, crash-rate monitoring per device class (§16).

### 26.G Adversarial / game-theoretic scenarios v1.1 didn't think about

**M26 (S1). The "5-star inflation cartel."** Workers in a tehsil agree to give each other 5-star reviews via fake jobs. Already partly defended by §10 F4 (review only from real assignments + reviewer trust weighting), but a tightly-coordinated local ring can run real (cheap) jobs to game the system.
*Fix:* anomaly detection on review-ring graphs (worker A reviews employer B reviews worker A pattern, density beyond local baseline), **escrow-funded jobs reviewed by both sides count for more** (skin in the game), and review impact decays with **counterparty trust** (a brand-new employer's 5-star is worth less than a long-standing one's).

**M27 (S1). The "bid-down race to the bottom."** Workers undercut each other on rate until average wages collapse, hurting workers and quality both. Common in early gig markets.
*Fix:* **suggested rate floors** (§25.4 "suggested rate") with a one-line warning when a job posts below the regional 25th percentile ("This rate is below market for masonry in Mingora — quality workers may not apply"). KAFIL doesn't enforce, it informs. Track downstream completion/dispute rates by rate band — if low-rate jobs have higher dispute rates (likely), surface to employers.

**M28 (S1). The "reactivate-after-ban" via family member.** Banned user has their cousin sign up with cousin's CNIC, banned user operates the cousin's account.
*Fix:* device fingerprint + behavioral biometric signals (typing cadence, session times) link suspected duplicate accounts; explicit `ban_evasion_score`; mod review queue for high-score cases. Cannot prevent perfectly but makes it costly.

**M29 (S2). The "review-bomb a competitor" pattern.** Contractor A creates fake jobs, hires contractor B (their competitor), then 1-stars them.
*Fix:* employer accounts with high review-issuance + zero-revisits + low-rate-relative-to-norm + low completion rate (a "review-only" profile) get a `suspicious_employer` flag; reviews from them weight lower or are held for moderation. F4 generalized.

### 26.H Business continuity / ops resilience §24 didn't open

**M30 (S0). Single-founder bus factor.** Audit Gap 5 explicitly assumes Kifayat is founder + ops + support + dev. A 5-day illness or family emergency = total outage in support → disputes pile, trust collapses.
*Fix:* **a documented "skeleton mode"**: a single ops contractor (paid retainer) who can run dispute queue + answer support during founder absence, with a runbook (§18). + **automated holds** on escrow disputes when ops response time exceeds SLA → fund is safe even if humans aren't around.

**M31 (S1). Subprocessor outage (Vercel, Supabase, Twilio).** v1.0 lists all three as single points. A 4h Supabase incident = the app is down at 1M users → news story, churn spike.
*Fix:* **multi-region database** by ~250k MAU (already noted in §25.8); **circuit breakers** on every external dependency (notifications fall back through chain — already in §11 if extended per M13); **read-only mode** the app can enter when DB is degraded (browse + chat history, no mutations) instead of full failure.

**M32 (S1). Data export / interop for users.** PECA + good consumer practice = users can export their data. v1.1 §17 says "user deletion" but not export.
*Fix:* `GET /users/me/export` returns a packaged JSON+PDF of jobs, ratings, ledger entries (their own). Job is async (large), notification on completion. Both worker-side (income proof — feeds the income-certificate revenue stream) and employer-side. Also: **portable reputation** spec (§19 Tier D) starts here.

**M33 (S1). No audit-log access for users.** When a worker says "you banned me unfairly," there's no user-facing log to show them what happened. ToS-grade transparency requires it.
*Fix:* moderation actions taken **on a user** are visible **to that user** (with redacted internal notes) — replaces "shadowban" with "open ban" + appeal path. Increases trust and reduces support load.

### 26.I Legal / regulatory beyond Audit Gap 4

**M34 (S1). Minor / underage labor.** Pakistan's Bonded Labour System (Abolition) Act + provincial child labour laws prohibit hire of < 14yr in many trades, restrict 14–17 in others. KAFIL has no age model.
*Fix:* DOB at signup, age-gating on certain specialties, education flow ("KAFIL doesn't allow hiring under-14 — here's why"). Schema: `users.dob`, validation against specialty's `min_age`. This is **a legal obligation, not optional**.

**M35 (S1). PECA / electronic-evidence handling.** Disputes that escalate may need to be admissible in court. Chat logs, ledger entries, and timestamps need integrity guarantees.
*Fix:* **append-only signed logs** (hash chain or simple blockchain-of-events) on `events` + `messages` + `ledger_entries`. Periodic exports to a tamper-evident archive (S3 Object Lock or PK equivalent). Document a chain-of-custody procedure in §18 — when ops receives a court order, the runbook exists.

**M36 (S2). Tax-deductible employer accounts.** Larger contractors will want **KAFIL-issued invoices** for accounting. Without them, KAFIL is unusable for the formal-business segment (a huge slice of the audit's regional GTM).
*Fix:* `invoices` table linked to ledger; auto-generated on commission collection; downloadable PDF; FBR-compliant header. Low effort, high enterprise value.

### 26.J Things §25 missed under "mainstream"

**M37. In-app voice/video calling** — not phone numbers. Cheap on-platform calls (via WebRTC + masked routing) keep voice on-platform while respecting low-literacy preference for talking over typing. Major anti-leakage measure (§5).
**M38. Saved searches with smart alerts** ("notify me when a masonry job ≥3500/day appears within 10km") — turns one-time visitors into daily-active users.
**M39. Push-notification preview privacy** — lock-screen previews should not reveal job amounts or counterparty identity by default (config in `notification_prefs`).
**M40. Donation / Zakat flow** — culturally significant; opt-in donation of a fraction of a tip or commission to a verified local cause. Free PR, high goodwill.
**M41. Accessibility audit (TalkBack / VoiceOver)** — RTL-aware, large-text mode, high-contrast theme, reduced-motion. Disability is a meaningful slice of users and a legal requirement under PK accessibility guidelines.
**M42. Holiday / seasonal mode UX** — Eid greetings, harvest-season banners, Ramadan-aware notification timing (low push during fast-break hours, surge after iftar).
**M43. Onboarding video** (60s, voice-narrated, no text) auto-plays first launch — completion rate of onboarding doubles in low-literacy contexts.
**M44. Family-controlled accounts** — explicit parent/guardian role for under-18 worker accounts (M34 ties in).
**M45. Print receipt at any cyber-cafe via short code** — "Print job #1234 at any KAFIL-partner cafe" gives a physical proof for users without smartphones or for documentation needs.
**M46. SOS button** — long-press on any chat surface alerts ops with location + screenshot; a credible safety feature for women workers (§12 social dynamics) and a meaningful market differentiator.
**M47. Earnings dashboard with goals** — gamified weekly/monthly earning targets; doubles retention in gig markets.
**M48. Worker tools rental marketplace** — adjacent monetization, large in informal labor (a mason often doesn't own a mixer); slot into the shop directory.
**M49. Skill certifications + micro-courses** — short Pashto video courses (welding safety, customer handling) that unlock a badge → higher rank. Eventual revenue (courses can be paid) and a major worker-side stickiness lever.
**M50. Anonymous community Q&A** — like Quora in Pashto for trade knowledge; long-term content moat + organic SEO once the app is established.

---

### 26.K Summary

§24 fixed v1.1's bugs. §25 covered the mainstream feature gap. **§26 reveals that:**
- One §24 fix (A6's directional auto-complete) was itself wrong — replaced with evidence-based with-human-fallback (M1).
- Whole categories were missed: multi-device sessions, account recovery for the bottom-half of the literacy curve (M7), KYC-lapse handling, CNIC uniqueness, search infrastructure beyond Postgres (M10), feedback-driven ranking, OEM push reality (M22), payment timing/refund edge cases, FX, tax, chargebacks, child-labour compliance, court-admissible logs, business continuity beyond the founder, and ~14 mainstream-feature gaps (M37–M50).

This second pass is where most "we ship and it just works" comes from — multi-pass review is the cheapest insurance you can buy. A **third pass** before code freeze is still recommended (different categories will surface: design-system tokens, internationalization deep paths, finance reconciliation rules, on-call rotation, etc.), but §26 is where the **engineering plan crosses the threshold from "buildable" to "operable at 1M users."**

---

## 27. MOTION, ANIMATION & FEEL — DUOLINGO CLARITY × TIKTOK SMOOTHNESS ON LOW-END ANDROID

> Added 2026-06-29 after the founder's decision: KAFIL must feel as *clear* as Duolingo and as *smooth* as TikTok, using Lottielab animations as a first-class asset. On low-end Android (2GB RAM, 720p, 3G) — KAFIL's actual target hardware — motion quality is **not polish, it's foundation**: a janky 12fps animation feels objectively worse than no animation. This section turns "use Lottie" into a working motion system with the engineering budget, asset pipeline, and screen-by-screen choreography needed to land it.

### 27.1 What "Duolingo clarity" and "TikTok smoothness" actually mean (so we build the right thing)

- **Duolingo clarity** = every animation **teaches or rewards a single thing**. The mascot reacts, the streak fills, the green check pops — each motion *means* something. No decorative motion. Always paired with sound and haptic. **Animation is a UX language**, not decoration.
- **TikTok smoothness** = **60fps everywhere, always, on low-end devices**. Scrolling is buttery; transitions never block input; tap → response < 100ms perceived; gestures are physics-based, not stepped. This is achieved by aggressive performance discipline (off-thread rendering, virtualization, image budgets), not by adding more animation.

KAFIL combines: **purposeful Lottie reactions (Duolingo) + a 60fps native feel (TikTok) + low-literacy clarity (icons + voice over text)**. The biggest mistake would be Duolingo-style heavy mascot animations layered onto an unoptimized feed — feels worse, not better.

### 27.2 The performance budget (the hard constraint everything else respects)

| Metric | Target on low-end Android (2GB / Snapdragon ~4xx / 3G) | Why |
|---|---|---|
| App cold start to interactive | < 2.0s | Below this users perceive "instant"; above 3s perceived as broken |
| Time to first meaningful frame after tap | **< 100ms** | TikTok's psychological smoothness threshold |
| Sustained scroll FPS (job feed) | **≥ 55fps p50, ≥ 50fps p95** | Anything < 50fps reads as janky |
| Lottie animation FPS | **60fps on UI thread**, off-main where possible | Stuttering Lottie is *worse* than no Lottie |
| Single-screen JS bundle | < 250KB gzip incremental | Network is the bottleneck, not CPU |
| Initial APK size (shared APK, §23.4) | **< 25MB** | Shared via WhatsApp; bigger = won't be shared |
| Per-screen heap delta | < 30MB | OOM on 2GB devices common above this |
| First contentful tap on cold start of "Apply" flow | < 5s end-to-end including network | Conversion drops sharply past this |

**These are non-negotiable.** Any animation, asset, or screen that violates them gets cut or simplified — not added with an apology. This is the discipline that produces TikTok smoothness; without it, no amount of beautiful Lottie work feels good.

### 27.3 The animation taxonomy — six categories, each with a budget and a rule

Not all motion is the same. KAFIL uses **six categories**, each with a defined purpose, asset format, and budget. Designers and engineers reference this taxonomy in PRs ("this is a Class C transition") so motion stays coherent.

| Class | Purpose | Asset format | Duration | Where |
|---|---|---|---|---|
| **A — Micro-interaction** | Tap feedback, toggle, button press | Native (Reanimated spring) — **never** Lottie | 80–150ms | Every interactive element |
| **B — State change** | Status badge flips, slot fills, "saved" check | Lightweight Lottie (< 30KB), or native | 200–400ms | Inline in lists/cards |
| **C — Screen transition** | Push/pop, modal, tab switch | Native (Reanimated shared element) — **never** Lottie | 250–350ms | Navigation |
| **D — Reward / celebration** | First job completed, 5-star received, streak | **Hero Lottie** (full asset, sound + haptic) | 800–1500ms | Modal/full-screen only |
| **E — Mascot reaction** | Onboarding, empty state, error, encouragement | Lottie — **looping** under 2s | Idle loop + 1.5s reactions | Mascot surfaces (§27.6) |
| **F — Loading / skeleton** | Network wait | Lottie ≤ 20KB or native shimmer | Indefinite loop | Any async surface |

**Rules:**
1. **Lottie is only for B, D, E, F.** A, C are always native (Reanimated 3 / Moti). Lottie is **not a hammer**; using it for transitions is what kills frame rate.
2. **Total Lottie playing concurrently on screen ≤ 1** (loaders/mascot idle) **plus 1 transient** (state change). Two heavy Lotties at once = frame drops on 2GB devices.
3. **Every Class D reward has paired sound + haptic.** Visual without audio/haptic feels hollow; this is the Duolingo signature.
4. **Every motion has a reduced-motion path** (§27.10).

### 27.4 The Lottielab asset pipeline (this is the engineering, not the design)

Lottielab → designer hands off a JSON. That's where most teams stop. KAFIL needs a pipeline so the JSON actually performs:

```
Designer (Lottielab) ──▶ raw.json
                              │
                              ▼
                  ┌────────────────────────┐
                  │  Lottie lint + optimize │
                  │  (in CI; build fails on │
                  │   violations)            │
                  └─────────────┬───────────┘
                                ▼
                      ┌──────────────────┐
                      │  optimized.json  │  ◀── checked into packages/core/animations/
                      └─────────┬────────┘
                                ▼
              ┌─────────────────────────────────┐
              │  Build-time variants:           │
              │  - Full (high-end Android+iOS+web)│
              │  - Lite (low-end Android)       │
              │  - Static fallback PNG (3G/2G)  │
              └─────────────────────────────────┘
                                ▼
                      runtime selects by device class
```

**Lint rules (CI fails the build on violation):**
- **File size** ≤ 80KB for hero (D), ≤ 30KB for state change (B), ≤ 20KB for loaders (F). Larger = compress or redraw.
- **No bitmap layers** (defeats SVG-vector rendering — common Lottielab export mistake).
- **No expressions** (`ex:` fields) — they force JS-bridge work every frame, brutal on low-end Android. Bake to keyframes.
- **No mask layers** if avoidable — slowest Lottie feature on Android.
- **Frame rate = 60fps in source**, not 30 (avoids frame-doubling artifacts).
- **Duration cap** per class (above).
- **Color tokens, not hex** — colors reference our design tokens so Lottie respects theme/dark-mode/RTL palette swaps. (Lottielab supports this; we enforce.)
- **renderer = "skottie" eligible** — i.e. no unsupported features for Skia-based playback (we use `@shopify/react-native-skia` or `lottie-react-native` w/ Skottie on Android for hot paths).

**Runtime:**
- Native lib: **`lottie-react-native` (Skia/Skottie variant)** on Android, native Lottie on iOS, **`lottie-web`** (light-renderer) on web. Single `<KafilAnimation source="celebrate_first_job" variant={device.tier} />` component selects implementation.
- **Pre-loaded on first run** for top-N animations (mascot idle, common state changes); rest lazy-loaded with skeleton during fetch.
- **Cached on disk** (versioned with the asset hash) so animations work offline (§13).

### 27.5 Device tiering — without this, "60fps" is a lie

We classify devices on first launch into three tiers; this drives Lottie variant, list virtualization aggressiveness, image quality, and which Class-D rewards play vs. degrade:

```
tier_a (high)    : >=4GB RAM, 720p+, A55-class CPU       — full animations, full quality
tier_b (mid)     : 2–4GB RAM                              — lite Lottie variants, no concurrent animations
tier_c (low)     : <2GB RAM, MediaTek MT6XXX, KaiOS-ish   — Lottie disabled or replaced by single PNG flash, native springs only
```

Detection: `react-native-device-info` + a one-time **synthetic FPS probe** on first launch (60-frame test, measured) that bumps a phone down a tier if it can't sustain. Result stored in `users.device_tier` and `devices.tier`; informs the analytics (§16: "tier_c users complete onboarding 40% of the rate of tier_a — what's blocking?").

### 27.6 The mascot — KAFIL's Duo equivalent

A mascot is half the Duolingo effect. KAFIL's needs to be **culturally specific, not a generic owl**:
- **Concept (recommendation):** a stylized **markhor** (Pakistan's national animal, native to KP) named (placeholder) **"Kaf"** — sturdy, friendly, recognizable to locals, distinct from anything else in the global app market.
- **Functions:** narrates onboarding (with voice, §25.1); reacts to user state (idle = breathing loop; happy = job accepted; sad = no-show penalty; cheering = first completion; thinking = loading); appears in **empty states** so a blank list never feels broken; gives **gentle nudges** ("complete your profile to get 3× more jobs").
- **Lottie set (initial):** ~12 reactions (idle, wave, cheer, think, sad, sleep, point-left, point-right, walk-in, walk-out, big-celebrate, alert). All Class E (loop ≤ 2s) or Class D (reward, 1.5s).
- **Voice pack:** every mascot reaction has a paired Pashto + Urdu + English short audio (50–800ms). Recorded by real humans, not TTS (Audit research: TTS in Pashto is uncanny and breaks trust).
- **Cultural sensitivity:** no anthropomorphic gestures conservative communities find off-putting; modest palette; the mascot is welcomed by elders, not just kids.

### 27.7 Screen-by-screen motion choreography (the "language" applied)

The motion system is only as good as its application. Below: **what plays where** on the screens that matter most. Each item names its **class** so engineers and designers stay aligned.

**Onboarding (the highest-leverage motion surface — first impression, low-literacy):**
- Splash: app icon does a **subtle scale-in spring** (Class A, 200ms) + audio "salaam" → mascot walk-in (Class E, 1.2s) + voice intro in detected language (auto-detect or default Pashto).
- Each step: mascot stays on screen; new question slides in (Class C) with voice prompt; tap → mascot reacts (Class E thinking → encouragement); progress bar fills (Class B, eased) so the user *feels* the journey.
- Step completion: Class B check; final step: **Class D celebration** (markhor cheer + drum sound + heavy haptic).

**Job feed (the second-highest — TikTok smoothness must land here):**
- FlashList virtualized; images pre-decoded; skeleton (Class F) on cells not yet hydrated.
- Pull-to-refresh: rubber-band physics (native) + Class E mascot peek at the top when fully pulled.
- New job arrives via realtime: Class B fade+slide at top with a single-pulse highlight; haptic tick only if user is at the top of the feed.
- No autoplaying video, no concurrent Lotties in cells.

**Apply flow:**
- Tap "Apply" → instant Class A press; sheet slides up (Class C native spring, 300ms); voice prompt reads job summary if literacy mode is on.
- Submit: button morphs to a Class B spinner → Class D mini-celebration on success (mascot pop + soft chime + light haptic).
- On stale-job 409 (M12): Class B "this just filled" inline replacement with 3 similar suggestions — never a generic error.

**Accept (employer side):**
- Tap "Accept" → confirm sheet → Class D acceptance reward (full markhor cheer + sound + medium haptic) → routed to "next step" guide.

**Job completion + review:**
- Both-confirmed completion: **Class D hero** (largest reward in the app — this is the activation moment per §16). Mascot does big-celebrate; streak fills; review prompt slides in (Class C). Sound + heavier haptic.
- Star rating: each star tap = Class A scale spring + ticking sound; submit = Class B check.

**Empty states / errors (Duolingo-style: never blank):**
- Empty feed: mascot in `sleep` loop with caption "No jobs in your area yet — we'll wake Kaf when one arrives." + a Class B button to widen radius / set alert.
- Error: mascot `sad` for 800ms then `thinking`; never a raw red error string.
- Offline: persistent gentle banner + mascot looking up at clouds; clears with a Class B animation when back online.

**Notifications (in-app):**
- Toast in from top with Class C spring; tap = haptic tick + push to relevant screen.
- Urgent (M13 priority): full-screen Class D banner with sound (respects priority but breaks quiet hours by design).

**Disputes (counterintuitive — *less* motion here):**
- Disputes are stressful; the motion budget drops to Class A only. Mascot is **absent** from dispute UI; calm typography, slow transitions (450ms), no celebration sounds. This is part of the language: motion intensity = emotional intensity.

### 27.8 Sound & haptic system — paired with motion, never alone

Animation without sound + haptic on mobile feels half-built (this is what Duolingo, Apple, and TikTok all understand). KAFIL ships:
- **Sound tokens** (not files): `tap`, `tick`, `success_small`, `success_big`, `error_soft`, `streak`, `arrive`, `notification_low/med/high`, `voice_<event>`. Each maps to a 5–500ms file, normalized loudness, < 30KB.
- **Haptic tokens**: `tap_light`, `tap_medium`, `success`, `warning`, `error`, `streak` (sequenced haptic). Use **`react-native-haptic-feedback`** on Android, native Haptic Engine on iOS, **silently no-op on devices without** (tier_c often has weak/no haptic).
- **Sound + haptic always degrade gracefully**: muted device → haptic only; vibration disabled → sound only; both off → motion only; reduced-motion → all three muted but the **state change is still announced** via accessibility API.
- **Voice prompts** (§25.1, §27.6) are a **separate pack** keyed by `(event, language)`; they respect a user "voice on/off" toggle, default ON for users who chose Pashto with low-literacy hint, default OFF otherwise.

### 27.9 Gesture system — TikTok-grade physics, not stepped

- All swipes/scrolls use **Reanimated 3 worklets** running on the UI thread, not the JS thread. (This is what lets TikTok scroll smoothly while the app is fetching.)
- Standard gestures: swipe-down to dismiss sheets, long-press for quick actions (re-apply, share, report), pinch to zoom job photos.
- **Edge gestures respect low-end realities**: never block back-gesture; never trap users.
- **Pull-to-refresh** physics tuned to feel like TikTok's rubber-band (overshoot + settle), not Android's stock stretch.
- Lists use **interpolated headers** (collapsing on scroll) only on tier_a; flat on tier_b/c.

### 27.10 Accessibility — motion must work for everyone (M41 deep dive)

- **Reduced-motion mode** (system or in-app toggle): all Class C/D/E animations replaced by fades < 100ms; Lotties freeze on representative frame; sound + haptic still play; voice prompts still play.
- **Screen-reader (TalkBack / VoiceOver)**: every animation has a content description; transitions announce the new screen; loaders announce "loading"; Class D rewards announce "Great work — you completed your first job."
- **Color-blind safe palette** for status badges (don't rely on red/green alone; pair shape + label).
- **Large-text mode** scales typography without breaking layouts (tested up to 200%).
- **Motion-induced sickness**: no large parallax, no fast camera pans, no full-screen rotations.

### 27.11 The design-system foundation that makes all of this consistent

A motion system without a design system is wallpaper on sand. Add (this is implicit in §23 but worth surfacing):
- **`packages/core/design-tokens`** — colors, type scale, spacing, radii, shadows, motion timings (`duration_xs/sm/md/lg`), easing curves (`spring_default`, `spring_responsive`, `ease_emphasized`). Single source of truth, consumed by RN and web.
- **Component library** (shared between mobile + web) built on **Tamagui** or a hand-rolled token-driven system — RN-first, web-compatible, theme/dark-mode/RTL ready. Avoid pure web component libraries that don't render natively on RN.
- **Theme**: default light + dark + high-contrast; RTL handled at the layout primitive level (logical start/end, not left/right). Brand: warm, earthy, not "tech blue" (which reads as cold/government-y in PK consumer apps).

### 27.12 What this changes elsewhere in v1.1

- **§19 backlog**: motion system moves to **Tier A** (foundation) — specifically the design-tokens + animation primitives + first 5 Lotties (splash, mascot idle, success, error, loader). Without this in place, screens built in Tier B will have motion grafted on later and feel inconsistent.
- **§22 roadmap**: weeks 1–2 add "design-tokens + motion primitives + Lottielab pipeline + first 5 Lotties." Weeks 3–4 build the core flows *on top of* those primitives, so Duolingo clarity is baked in, not added.
- **§16 observability**: per-tier FPS, animation frame-drop count per screen, Lottie load failures, sound/haptic-off rates. These are **product metrics**, not infra — they predict retention in low-literacy onboarding.
- **§23 distribution**: APK size budget tightens because of Lottie assets; the **first-launch animation pre-cache** happens during install, not on first use (so the WhatsApp-shared APK works smoothly out of the gate even on 2G).
- **§25 mainstream features**: §25.1 voice onboarding now has its motion partner here; §25.2 trust signals get Class B reveal animations; §25.4 anti-friction skeletons formalized as Class F.

### 27.13 The cheap failure modes to avoid (we will be tempted)

- **Adding more Lottie because "it looks great in Figma."** Each new heavy Lottie costs 10% frame headroom on tier_c. Budget enforced in §27.3.
- **Using Lottie for screen transitions.** Always native. Lottie can't preempt input the way native springs can.
- **Skipping the lite variant** because "the full one works on my phone." It won't work on the target user's phone.
- **Forgetting sound + haptic.** Visual-only Class D rewards feel hollow and *worse* than no animation in low-literacy contexts where audio is the primary feedback channel.
- **Designing motion in isolation from voice.** A Class E mascot reaction without its Pashto voice line is a wasted asset; lock them together at Lottielab handoff (the JSON ships with the voice asset reference).
- **Animating during the dispute / safety flows.** Quietest UI in the app.
- **Letting motion drift from the language.** New screens added in month 6 must reference the Class taxonomy; PR template includes a "Motion class checklist."

---

**Summary.** Motion is now a foundation system, not a polish phase: a performance budget that low-end Android can actually hold; a six-class taxonomy that decides when Lottie is right and when native is; a Lottielab pipeline with CI lint that prevents the JSON foot-guns; a device-tiering system so "60fps" is real, not aspirational; a markhor mascot with paired voice in Pashto/Urdu/English; per-screen choreography that uses motion to *teach*, not decorate; sound + haptic paired by token; gesture physics that match TikTok's feel; accessibility paths for every motion; and an honest list of the failure modes we will otherwise commit. Built into Tier A so every feature inherits the polish, instead of trying to add polish at the end.

---

## 28. CONSOLIDATION & HONESTY PASS — propagation fixes + three things three audits missed

> Added 2026-06-29 in response to an external review that pointed out (1) §24/§26 fixes hadn't been propagated back into the authoritative §2 and §4.3 sections, (2) ~10 schema tables existed only in prose, (3) commission rates were never stated, (4) B4 vs M4 escrow rules were unreconciled, and (5) three categories none of §24/§25/§26/§27 had opened. The propagation fixes are folded back into their authoritative sections (§2.13, §4.3 amendments, §6.1, §6.2). This section captures the remaining three honest gaps, which are real and worth naming even if they aren't all "bugs to fix" — some are constraints to plan around.

### 28.A Seasonality — the finance model is not a smooth monthly curve

§21.2's revenue ramp implicitly assumes a smooth monthly progression. But the v1.0 product research is unambiguous: this market is **80% concentrated in 3–4 months** (construction May–Oct, tourism Mar–Oct, apple harvest Sept–Oct; winter pause Dec–Feb; Ramadan suppresses transactional activity).

**Implication for the plan:**
- Runway math against a smoothed average **will mislead in both directions**: it will under-prepare for the peak (ops + payment-provider rate limits + push-notification cost spikes) and over-extend the budget into the slow months.
- The proper Year-1 model is a **seasonal index** applied to the §21.2 envelope: e.g. weights `Jan 0.4, Feb 0.4, Mar 0.7, Apr 0.9, May 1.4, Jun 1.5, Jul 1.2, Aug 1.0, Sep 1.5, Oct 1.5, Nov 0.7, Dec 0.5` (sum=12, mean=1.0), tunable per region. Apply it to revenue AND to dispute/ops volume — they correlate.
- **Operational consequence:** the §28.B human-review minutes budget must be sized to **peak month**, not average. A founder doing dispute mediation alone during October harvest week will fail; that's the moment the contractor-ops retainer (§26/M30) becomes mandatory, not optional.
- **Cash-flow consequence:** keep ≥3 months of operating reserve aside from working capital, because the slow months drain a lean operation. Add `settings.seasonality.weights` so the matching, push budget, and dispute-staffing schedule can flex.

### 28.B Total human-review minutes vs. one founder's hours — the architecture's silent assumption

Every safety fix in §24/§26 (M1 evidence-fallback to `awaiting_ops_review`, dispute workbench in §18, content moderation in Pashto in §9, KYC review, chargeback handling) **routes ambiguity to a human**. That's the right design decision for every individual case. But nothing adds up the total minutes per week, and the architecture quietly assumes a support team the §21.2 revenue can't fund yet.

**Rough budget (worth modeling honestly):**
- Per-100-completed-jobs/week expected ops load: ~5 `awaiting_ops_review` cases × 15 min, ~3 disputes × 30 min, ~10 reports × 5 min, ~5 KYC reviews × 5 min, ~2 chargebacks × 20 min, ~50 moderation queue items × 1 min = **~265 min / 4.4 hours per 100 jobs/week**.
- At week-12 target (40–80 jobs/week per §22): ~2–4 hours/week — manageable solo.
- At month-6 (300+ jobs/week): ~13 hours/week — a *part-time* role's worth of time alongside dev work. Realistic ceiling for solo operation.
- At month-9 (1,500+ jobs/week): ~66 hours/week of ops alone. **Cannot be done by one founder.**

**Fix (planning, not code):**
- A `settings.ops.review_capacity_minutes_per_week` value that the **scheduler reads** to throttle non-urgent `awaiting_ops_review` enqueueing into the workbench (M1 already buffers; this makes the buffer's queue depth bounded by reality).
- A **monthly ops-load forecast** in the admin dashboard (§18): "Projected ops minutes next 30 days at current trajectory: X. Capacity: Y. **Gap:** Z." Visible in the same place revenue is.
- **Acceptance criterion for regional expansion (§22):** ops-minutes-per-week / capacity-per-week ≤ 0.6 (40% headroom). Don't expand to Peshawar if Mingora is already burning through ops capacity.
- **Honest gating of the contractor retainer (§26/M30):** trigger funding the retainer when **EITHER** weekly ops load exceeds founder capacity threshold **OR** monthly revenue (§6.1 mechanics) covers their day-rate plus 30%. This is the boundary between "lean solo phase" and "two-person ops phase."

### 28.C The recovery-phrase literacy contradiction (M7 only half-fixed)

§26/M7's "6-word Pashto recovery phrase on a physical card" was an improvement over §24/A1's bare recovery secret, but the external audit is right: **the same low-literacy assumption v1.1 spent §12/§23 rejecting is back in M7.** A user who can't read a domain name cannot reliably read a 6-word card in Arabic script either, and even if they can, they certainly cannot reliably *type* it into a recovery flow.

**Corrected primary recovery path (this supersedes the M7 ordering):**
1. **Voice-passphrase + trusted-contacts vouching is the PRIMARY recovery path**, not the secondary. The user, during onboarding, records a 5-second voice phrase ("my name is X, I work as a Y") + nominates **two trusted contacts** (another KAFIL user — relative, employer, friend). Recovery flow: user contacts ops → ops verifies via voice match (human in the loop or simple voice-biometric for confidence scoring) + both trusted contacts confirm via in-app one-tap → 24h cooldown → restored. This is how **M-Pesa, EasyPaisa, JazzCash account recovery actually works for low-literacy users**, and it's the proven pattern.
2. The 6-word phrase **remains** but as a **secondary path for tech-literate users** (the urban contractor segment, often bilingual). The card has both the phrase AND a QR code that encodes it, so even when used, the user scans rather than types.
3. **CNIC verification** is the tertiary path (level-up to `kyc_level >= 2` users only): show the live selfie + CNIC photo at recovery → ops match.
4. A **per-user `recovery_method_used`** event metric so we know which path actually gets used in the wild. Hypothesis: 80% trusted-contacts, 15% CNIC, 5% phrase. If 80% turns out to be phrase, we got the user model wrong and need to revisit §12.

**Schema additions** (folded into the §2.13 model already, but listed here for traceability):
- `users.voice_passphrase_url` (encrypted blob in private storage)
- `recovery_contacts(user_id, contact_user_id, verified, created_at)` — minimum 2 nominated, 1 needed for warm recovery, 2 needed for cold recovery.

### 28.D Three audit passes don't replace shipping

A blunt closing observation, recorded so we don't keep adding §29, §30, §31. The marginal value of paper review is now low — the corpus has reached the "anyone strict reader can build from this without reintroducing solved bugs" threshold (after this §28's propagation work). Further audits will surface things, but they will surface fewer per pass; running code finds different and more important issues than running prose ever will.

**Recommendation:** stop adding doc sections; scaffold the Tier-A foundation (§19) + §27 motion primitives in a real monorepo, run the first end-to-end Apply→Accept→Complete loop with §24/§26-corrected logic and §4.3 amended state machine, and find issues against working software. The next audit pass should be against code, not docs.

---

## CHANGE LOG
- **2026-06-29:** v1.1 created (§1–§20): architecture principles, corrected data model, identity/roles, job state machine, anti-disintermediation, money/ledger, reputation, matching, T&S, fraud model, notifications, localization, offline/sync, concurrency, liquidity, observability, compliance, ops, prioritized backlog.
- **2026-06-29:** Added §21 (reconciliation with the three v1.0 docs + leakage-adjusted financials) and §22 (corrected build roadmap) after the additional documents were provided. Added precedence banners + inline corrections to the v1.0 docs; created `KAFIL_DOCS_INDEX.md`.
- **2026-06-29:** Added §23 (client architecture & distribution) after founder decision: **mobile-first** (native Android + iOS via Expo/React Native) + responsive Next.js web, driven by the low-literacy user base (no URL typing → icon/QR/shared-APK entry). Native apps move to Tier A/B (were Tier D); PWA-first references in v1.0 + the "Capacitor later" line are superseded. Refines §11/§12/§13/§19/§22.
- **2026-06-29:** Added §24 (deep audit of v1.1 itself — 25 real bugs/races/flow-faults the addendum had, with severity S0–S2 and fixes) and §25 (10 categories of mainstream-app features missing: low-literacy onboarding, trust signals, repeat/recurring/crew flows, anti-friction details, self-serve support, growth loops, deeper localization, operational maturity, privacy controls). §24 fixes are authoritative — supersede earlier §2/§4/§6/§7/§11/§13 wording where they conflict.
- **2026-06-29:** Added §26 (second-run audit) — meta-reviewed §24/§25, found §24/A6 itself was exploitable (replaced with evidence-based fallback, M1), and covered categories §24 didn't open: multi-device session model, account recovery for low-literacy (M7), KYC-snapshot to prevent in-flight lockout (M8), search infrastructure beyond Postgres (M10), feedback-driven ranking (M11), OEM push reality (M22), payment timing/refund/FX/tax/chargebacks (M17–M20), Apple Developer access from PK (M21), child-labour compliance (M34), court-admissible logs (M35), business continuity beyond founder (M30), and 14 more mainstream-feature additions (M37–M50). §26 supersedes §24 where they conflict; further passes still recommended.
- **2026-06-29:** Added §27 (motion, animation & feel) — promotes motion to a Tier-A foundation system after the founder's "Duolingo clarity × TikTok smoothness with Lottielab" goal. Defines a low-end-Android performance budget (60fps real, not aspirational), a six-class motion taxonomy that decides when Lottie is right vs. native, a Lottielab → CI-lint → device-tier-variant asset pipeline, a markhor mascot ("Kaf") with paired Pashto/Urdu/English voice, sound + haptic token systems, gesture physics for TikTok-grade scroll, per-screen choreography (with the counter-intuitive "less motion in disputes" rule), accessibility paths for every animation, and the design-tokens/component-library foundation that makes it consistent. Refines §16/§19/§22/§23/§25.
- **2026-06-29:** Added §28 (consolidation & honesty pass) after an external review identified that §24/§26 corrections had **not been propagated back into the authoritative §2 and §4.3 sections** — meaning a strict reader of the canonical schema and state-machine table would reintroduce already-solved bugs. Propagation fixes folded back **in place**: §4.3 transition table now encodes M1's evidence-fallback rule (the deprecated A6 row is struck and pointed to M1); §2.13 added a consolidated schema deltas subsection inlining the ~10 tables that lived only in prose (`account_history`, `sessions`, `work_log`, `webhook_events`, `chargebacks`, `banned_identities`, `user_blocks`, `invoices`, `crews`/`crew_members`/`crew_payouts`, `group_orders`/`group_order_participants`, `assignment_kyc_snapshots`, `settings`) with the full migration order; §6.1 added provisional commission + monetization rates with rationale (5% escrow, 150 PKR featured posts, 500 PKR shop verification, etc.) so §21.2 is reproducible; §6.2 added the merged B4-vs-M4 escrow release rule. §21.2 framing tightened (no more "100% strawman"). The new §28 captures three things three audits missed: **seasonality** (revenue/ops volume is 80% concentrated in 3–4 months — the smoothed monthly curve misleads), the **total human-review minutes vs. founder hours** binding constraint with explicit thresholds and a contractor-retainer trigger, and the **M7 literacy contradiction** (voice-passphrase + trusted-contacts vouching is now the primary recovery path; the 6-word phrase is secondary for tech-literate users only). Recommendation: stop adding doc sections; the next audit is against running code.

---

**End of Addendum v1.1.**
