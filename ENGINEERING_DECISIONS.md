# Engineering Decisions

Assumptions the brief left open (confirm with a product manager): Admin cannot approve (approval is Lead-only);
claim assigns an owner but does not change status; a Lead may send an item back from *Awaiting Approval* to *In Progress*;
closed items are immutable (except comments); an item's team never changes; assignees must be active Members or Leads of the item's team.

## 1. Data model and append-only activity history
**Context.** Every owner/priority/state change must be recorded and visible, and history must never disagree with the item.
**Alternatives.** (a) Audit columns on `work_items` (last-changed-by); (b) event-sourcing the item; (c) a separate append-only events table written with the change.
**Chosen.** Normalised tables (`users`, `teams`, `memberships(user,team,role)`, `work_items`, `activity_events`, `comments`, `idempotency_keys`, `jobs`, `notifications`). `activity_events` stores `event_type`, `previous_value`, `new_value`, `metadata` (jsonb). A DB trigger rejects UPDATE/DELETE on it.
**Why.** (c) is simple to explain, queryable per item, and the trigger enforces "append-only" even against buggy code. Memberships carry the role so one user can be Lead in one team and Viewer in another. CHECK constraints guard status/priority/type/role.
**Trade-offs.** Current state lives in `work_items` (not derived from events); the log is not cryptographically tamper-proof (a superuser can drop the trigger).
**Code/tests.** `database/migrations/001_init.sql`, `modules/activity/activity.repo.js`, `tests/activity.transaction.test.js`.

## 2. Concurrency: atomic claim and optimistic version checks
**Context.** Two people claiming one item; two people editing one item.
**Alternatives.** Frontend-only disabling (unsafe); `SELECT … FOR UPDATE` then check; serializable transactions; conditional UPDATE.
**Chosen.** *Claim* is one statement: `UPDATE work_items SET assignee_id=$2, version=version+1 WHERE id=$1 AND assignee_id IS NULL AND status = ANY(...)`; 0 rows → 409 with the latest item. *Edit* sends `expectedVersion` and updates `WHERE id=$1 AND version=$2`; 0 rows → 409 `VERSION_CONFLICT` plus the current item, nothing overwritten, no success event. *Transitions* lock the row (`FOR UPDATE`) because they read-then-write and must serialise.
**Why.** The conditional UPDATE lets Postgres arbitrate and needs no application locks; it is correct under READ COMMITTED because the loser re-evaluates the WHERE after the winner commits.
**Trade-offs.** The user must resolve a conflict manually (no merge). Edits to different fields of one item still conflict (coarse, per-item version).
**Code/tests.** `workItems.service.js` (`claimItem`, `updateItem`, `transitionItem`); `tests/concurrency.claim.test.js`, `tests/concurrency.version.test.js`.

## 3. Idempotent request handling
**Context.** Double-clicks and retries after a network error must not create duplicates.
**Alternatives.** In-memory key map (lost on restart, wrong with >1 instance); unique business key; DB-backed idempotency table.
**Chosen.** `Idempotency-Key` header; table keyed `(actor_id, operation, key)` with a request hash (sha256 of the canonical, validated body) and the stored response. The key row is inserted as the **first statement of the create transaction** (`ON CONFLICT DO NOTHING`); a concurrent duplicate blocks on the unique index until the first commits, then replays the stored response. Same key + different payload → 422 `IDEMPOTENCY_KEY_REUSED`.
**Why.** The key commits atomically with the item, so there is never a stuck "in-progress" row; a failed attempt rolls back and leaves no key, so a corrected retry just runs. Scoped per user so keys cannot collide across users.
**Trade-offs.** Concurrent duplicates hold a DB connection while waiting; keys are never purged (needs a TTL job); protection is opt-in per request (the UI always sends one, generated once per form instance).
**Code/tests.** `services/idempotency.js`, `createItem`; `tests/idempotency.test.js` (sequential, 8-way simultaneous, payload mismatch, per-user scope, failed first attempt).

## 4. Authorization and team isolation
**Context.** Hidden buttons are not security; every read/write must be team- and role-scoped.
**Alternatives.** Role in JWT; per-route middleware only; central function + scoped SQL.
**Chosen.** The token carries only the user id. On every request the user and their **current** memberships are loaded from the DB. One `can(user, action, target)` function (`modules/authz/permissions.js`) plus the workflow rules decide every action. List queries embed `team_id = ANY(userTeams)` in SQL. Items of other teams return **404** (not 403) for reads *and* writes so their existence isn't leaked; same-team-but-insufficient-role returns 403. Request bodies are `.strict()` so clients cannot smuggle `status`, `createdBy`, `teamId`, `version`.
**Why.** Role changes and deactivation take effect immediately; one function is easy to audit and modify live.
**Trade-offs.** Two extra queries per request (cacheable later); Admin is deliberately not a superuser.
**Code/tests.** `permissions.js`, `workflow.js`, `tests/authorization.test.js`, `tests/auth.test.js`, `tests/workflow.test.js`.

## 5. Synchronous transactions vs asynchronous outbox
**Context.** Assignment should trigger a notification, but delivery must never block or corrupt the request.
**Alternatives.** Send inline; fire-and-forget after commit (can be lost); Redis/BullMQ; Postgres outbox.
**Chosen.** Inside the same transaction as the assignment, insert a `jobs` row (`dedupe_key` unique). A polling worker claims jobs with `UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED)`, runs the handler outside any transaction, retries with exponential backoff, stops at `max_attempts` (→ `failed`), and re-claims jobs whose lock is stale (crashed worker). The handler writes a `notifications` row guarded by a unique key, so redelivery is harmless.
**Why.** Job exists iff the change committed; no new infrastructure; every failure state is a queryable row.
**Trade-offs.** Polling latency (≤ poll interval); at-least-once delivery (hence idempotent handlers); a very long handler could exceed the lock timeout and run twice.
**Code/tests.** `services/outbox.js`, `workers/outbox.js`, `workers/handlers.js`; `tests/outbox.test.js`.

## 6. Server-side search, filtering and pagination
**Context.** Tens of thousands of items and growing history.
**Alternatives.** Client-side filtering; OFFSET pagination; keyset pagination; a search engine.
**Chosen.** All filters in SQL; `ORDER BY updated_at DESC, id DESC` with a keyset cursor `(updated_at, id) < (…)` (timestamp carried as Postgres text to keep microseconds). The cursor is opaque base64 and strictly validated (bad cursor → 400). Limit is 1–100. Indexes: `(team_id, updated_at DESC, id DESC)`, `(assignee_id, status)`, partial indexes for *unassigned urgent* and *awaiting approval*, and a trigram GIN index on `title` for `ILIKE`. `%`/`_` in the search text are escaped.
**Why.** OFFSET degrades and skips/duplicates rows under concurrent writes; keyset cost is constant per page.
**Trade-offs.** No "jump to page N" or total count; sort order is fixed; search is title/ref only.
**Code/tests.** `workItems.repo.js`, `lib/cursor.js`; `tests/pagination.filters.test.js`.

## 7. Features deliberately excluded
Email delivery, attachments, SSO, WebSockets (the UI polls/refetches), mobile app, analytics charts, user/team administration screens and endpoints (teams and memberships are read-only; seeded), comment editing, refresh tokens, distributed rate limiting. Spending the time on correctness and tests was a conscious trade.

## What would change at 10× scale
Read replicas for list/dashboard reads; partition `activity_events` by time; move search to OpenSearch/Postgres full-text with `tsvector`; a dedicated queue (SQS/Redis streams) if job volume outgrows polling; cache memberships (short TTL + invalidation); WebSocket/SSE for live updates; per-team sharding of hot item rows is unnecessary at this size.

## With one more week
Browser E2E tests (Playwright); membership admin UI + audit; failed-job dashboard with manual retry; idempotency-key TTL cleanup; field-level merge on conflicts; full-text search incl. descriptions and comments; httpOnly-cookie sessions + CSRF; shared (Redis/DB) rate limiting; accessibility audit; commit a lockfile.

## Known limitations (honest list)
**Not verified at packaging time:** no automated test, Docker build, migration, seed, or browser run was executed (sandbox had no PostgreSQL/Docker/npm registry) — only syntax, import and script-target checks (`npm run check`). No `package-lock.json` exists yet. See `docs/VERIFICATION.md`.

**Deliberate scope exclusions:** listed in decision 7; Admin cannot approve/claim; membership management has no endpoint (matrix entry is documented only).

**Known gaps / defects-in-waiting:**
- Bearer token in `sessionStorage` is readable by injected scripts (XSS); no refresh/revocation list (deactivation is honoured per request); login throttling (10 failures / 15 min per IP+email → 429) is in-memory, so it resets on restart and is per API instance.
- Worker failures are observable via logs, the `jobs` table and `/ready`, but not surfaced in the UI.
- Idempotency keys and notifications are never purged. Notifications have an endpoint but no UI.
- UI activity timeline loads up to 200 events (API supports cursoring).
- Frontend tests are minimal (API client, badges, optimistic rollback); no E2E; responsive layout and keyboard/screen-reader behaviour were not manually tested.
- Admin gets no bypass anywhere by design; if the original brief says otherwise, change `MATRIX`/`TRANSITIONS`.
