-- Newtonite — Operations Under Pressure: initial schema
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE users (
  id            serial PRIMARY KEY,
  name          text        NOT NULL CHECK (length(trim(name)) > 0),
  email         text        NOT NULL,
  password_hash text        NOT NULL,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));

CREATE TABLE teams (
  id          serial PRIMARY KEY,
  name        text        NOT NULL UNIQUE,
  description text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  user_id    integer     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id    integer     NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('viewer','member','lead','admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, team_id)
);
CREATE INDEX memberships_team_idx ON memberships (team_id);

-- Human-readable identifiers (OPS-1042). A sequence is concurrency-safe; gaps are acceptable.
CREATE SEQUENCE work_item_ref_seq START 1;

CREATE TABLE work_items (
  id          bigserial PRIMARY KEY,
  ref         text        NOT NULL UNIQUE DEFAULT ('OPS-' || nextval('work_item_ref_seq')::text),
  title       text        NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 200),
  description text        NOT NULL DEFAULT '',
  type        text        NOT NULL CHECK (type IN ('incident','customer_issue','payment','compliance','task')),
  priority    text        NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status      text        NOT NULL DEFAULT 'open'
              CHECK (status IN ('open','in_progress','awaiting_approval','resolved','closed')),
  team_id     integer     NOT NULL REFERENCES teams(id),
  assignee_id integer     REFERENCES users(id),
  created_by  integer     NOT NULL REFERENCES users(id),
  due_at      timestamptz,
  version     integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Keyset pagination within a team (ORDER BY updated_at DESC, id DESC)
CREATE INDEX work_items_team_updated_idx   ON work_items (team_id, updated_at DESC, id DESC);
CREATE INDEX work_items_updated_idx        ON work_items (updated_at DESC, id DESC);
CREATE INDEX work_items_assignee_idx       ON work_items (assignee_id, status) WHERE assignee_id IS NOT NULL;
CREATE INDEX work_items_team_status_idx    ON work_items (team_id, status);
CREATE INDEX work_items_team_priority_idx  ON work_items (team_id, priority);
-- Dashboard views
CREATE INDEX work_items_unassigned_urgent_idx ON work_items (team_id, updated_at DESC)
  WHERE priority = 'urgent' AND assignee_id IS NULL AND status NOT IN ('resolved','closed');
CREATE INDEX work_items_awaiting_idx ON work_items (team_id, updated_at DESC) WHERE status = 'awaiting_approval';
-- Search
CREATE INDEX work_items_title_trgm_idx ON work_items USING gin (title gin_trgm_ops);

CREATE TABLE activity_events (
  id             bigserial PRIMARY KEY,
  work_item_id   bigint      NOT NULL REFERENCES work_items(id),
  actor_id       integer     NOT NULL REFERENCES users(id),
  event_type     text        NOT NULL,
  previous_value jsonb,
  new_value      jsonb,
  metadata       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_events_item_idx ON activity_events (work_item_id, id);

-- Append-only: history can never be rewritten, even by buggy application code.
CREATE FUNCTION forbid_activity_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'activity_events is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER activity_events_append_only
  BEFORE UPDATE OR DELETE ON activity_events
  FOR EACH ROW EXECUTE FUNCTION forbid_activity_mutation();

CREATE TABLE comments (
  id           bigserial PRIMARY KEY,
  work_item_id bigint      NOT NULL REFERENCES work_items(id),
  author_id    integer     NOT NULL REFERENCES users(id),
  body         text        NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_item_idx ON comments (work_item_id, id);

-- Row is written in the SAME transaction as the item it created, so it only
-- exists once the work is committed. Uniqueness is the concurrency guard.
CREATE TABLE idempotency_keys (
  actor_id        integer     NOT NULL REFERENCES users(id),
  operation       text        NOT NULL,
  key             text        NOT NULL,
  request_hash    text        NOT NULL,
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, operation, key)
);

-- Transactional outbox
CREATE TABLE jobs (
  id              bigserial PRIMARY KEY,
  type            text        NOT NULL,
  payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key      text        NOT NULL UNIQUE,
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  attempts        integer     NOT NULL DEFAULT 0,
  max_attempts    integer     NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at       timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz
);
CREATE INDEX jobs_due_idx ON jobs (next_attempt_at, id) WHERE status IN ('pending','processing');

-- The logical effect of the notify job. dedupe_key makes the handler idempotent.
CREATE TABLE notifications (
  id           bigserial PRIMARY KEY,
  user_id      integer     NOT NULL REFERENCES users(id),
  work_item_id bigint      NOT NULL REFERENCES work_items(id),
  message      text        NOT NULL,
  dedupe_key   text        NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, id DESC);
