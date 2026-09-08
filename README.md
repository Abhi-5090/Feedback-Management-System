# Feedback Management System (FMS)

A production **MERN** app for collecting **anonymous**, one-per-student feedback on training
sessions across **8 admin-configurable star parameters + a mandatory comment per subject**,
gated by a per-batch passcode.

Built around the way a training institute actually staffs its schedule: a **batch** (cohort) runs
several **subjects**, and each subject is delivered by a team of **main mentors** and assisted by
a team of **support mentors** — decided per batch, not per subject.

- **Admin** — manages mentors, subjects, parameters and batches; unlocks/locks batches
  (generating/rotating passcodes); sees all feedback with cohort and role filters; exports
  Excel/PDF; reads an audit trail.
- **Mentor** — sees analytics for **only the sessions they are staffed on** (enforced
  server-side), split by whether they **delivered** or **assisted**; exports their own data.
- **Student** — anonymous, no login: enter a batch passcode → rate every subject → one comment
  each → submit once.

```
FMS/
  FMS_Backend/    Node + Express + Mongoose API  (JWT httpOnly cookies, ExcelJS, pdfmake)
  FMS_Frontend/   React + Vite + Tailwind + framer-motion + Recharts
  scripts/        check-secrets.sh — CI guard against committed credentials
  docker-compose.yml   mongo (replica set) + api + web
```

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full design.

---

## Quick start (local)

**Prerequisites:** Node **20+** and MongoDB.

> For the transactional feedback write, run Mongo as a **replica set**. A standalone also works —
> the API detects it and falls back to ordered writes guarded by the `DeviceLock` unique index.
> ```bash
> mongod --replSet rs0 --dbpath /tmp/fms-mongo --port 27017 --bind_ip 127.0.0.1
> mongosh --eval 'rs.initiate()'
> ```

### 1) Backend

```bash
cd FMS_Backend
cp .env.example .env          # then edit MONGO_URI and generate the two secrets
npm install
npm run seed                  # creates the admin + 8 parameters, PRINTS the password ONCE
npm start                     # http://localhost:5555
```

Generate the secrets `.env` asks for:
```bash
openssl rand -hex 32          # JWT_SECRET
openssl rand -hex 32          # DEVICE_SALT   (keep this STABLE — see below)
```

### 2) Frontend

```bash
cd FMS_Frontend
cp .env.example .env          # VITE_API_PROXY must match the backend PORT (5555)
npm install
npm run dev                   # http://localhost:5173
```

Then: **Mentors** → add people · **Classes** → add subjects · **Batches** → create a cohort,
pick its subjects, assign **main** and **support** mentors to each, **Unlock** it → copy the
passcode + student link → open that link on a phone/incognito.

---

## Importing an existing training schedule

If your timetable already lives somewhere else, `import-schedule.js` builds the whole catalog
from it — mentors, subjects, and batches with their mentor rosters:

```bash
cd FMS_Backend
npm run import:schedule                          # from the committed snapshot
npm run import:schedule -- --fetch               # from the live board API
npm run import:schedule -- --dry-run             # report only, writes nothing
npm run import:schedule -- --password='Chosen#2026'
```

- Reads [`src/data/torii-schedule.json`](FMS_Backend/src/data/torii-schedule.json) and maps board
  names to accounts via [`src/data/torii-mentors.json`](FMS_Backend/src/data/torii-mentors.json)
  — **edit that file**, not the script, when someone joins or a name changes.
- A timetable has one row per day+slot, so the same subject appears several times per batch. Rows
  are **merged per (batch, subject)**, unioning both mentor rosters. Where someone is main on one
  session and support on another, **main wins** and the collapse is reported.
- **Idempotent** — matches accounts by email, subjects by name, batches by name. Re-running
  updates rosters in place. An **open** batch is never restaffed (that would invalidate in-flight
  feedback); it is reported and skipped.
- Days, slots, times and halls are deliberately **not** imported: FMS asks "how was this subject
  for this cohort?", which no timetable coordinate changes, and mirroring the grid would create a
  second source of truth that drifts.

---

## Upgrading an existing install

The main/support mentor model replaced a single `trainer` per batch-class. Run the migration once:

```bash
cd FMS_Backend
npm run migrate -- --dry-run   # see what would change
npm run migrate                # apply
```

It promotes each old `trainer` to the sole **main** mentor (support starts empty, which is exactly
what the old data meant — there was no way to record an assisting mentor), backfills
`Batch.round`, `Feedback.round`, `User.shortName` and `User.tokenVersion`, and is idempotent.

---

## Tests

```bash
cd FMS_Backend  && npm test    # 88 tests, Jest + Supertest, in-memory Mongo replica set
cd FMS_Frontend && npm test    # 111 tests, Vitest + Testing Library
```

The backend suite spins up a real **replica set** (so the transaction path is exercised, not just
the fallback) and proves the hard requirements:

- a duplicate device is rejected (`DEVICE_LOCKED`), and **re-unlocking a batch starts a new round**
  so a legitimate second collection is not blocked by the first;
- the live cap is enforced (`CAP_REACHED`) and counts **students**, not rows;
- the comment is mandatory and every parameter issued at verify time must be rated — **including
  after an admin deactivates one mid-window**, which must not destroy a student's answers;
- a valid passcode session is required, and a session from a previous round is refused;
- **a mentor cannot read or export another mentor's data** (403) — including the other subjects of
  a batch they are only partly staffed on;
- main and support attribution is kept separate;
- a **refused** export leaves no "Exported data" entry in the audit trail, and a permitted one does;
- changing a password **revokes tokens issued before it**;
- exports return valid `.xlsx` / `.pdf` bytes and honour role scoping;
- **a burst of simultaneous submissions all land**, the cap holds exactly under an over-cap burst,
  and a slot claimed by a refused duplicate is handed back;
- a browser with cookies blocked is still accepted, and told no device lock was taken;
- a legacy bcrypt passcode hash still verifies, so upgrading needs no migration;
- no device signature or identity is ever stored on the `Feedback` document.

`src/tests/security.test.js` additionally asserts the security properties
directly, so a refactor cannot quietly remove a defence: NoSQL operators
smuggled through query parameters do not execute, an operator in the login body
is rejected rather than matched, a wrong password and an unknown account are
indistinguishable, a trainer cannot reach any admin endpoint or promote
themselves, a tampered token is refused, anonymous callers get nothing, and
unknown fields are stripped from a create rather than persisted.

> Offline? Point it at a local binary: `MONGOMS_SYSTEM_BINARY=$(which mongod) npm test`

---

## The mentor model

Every `{ class }` entry on a batch carries two rosters:

```js
Batch.classes = [{
  class:           ObjectId,     // the subject
  mainTrainers:    [ObjectId],   // deliver it — at least one, often several
  supportTrainers: [ObjectId],   // assist — zero or more
}]
```

Both are **multi-value** because real schedules are co-taught ("Coding" runs with two mentors
delivering and two assisting). Nobody may hold both roles on the same subject. Both rosters are
**denormalised onto every `Feedback` row** at submission time, so:

- a mentor sees a session if they are in **either** roster;
- their dashboard separates **"as main"** from **"as support"** — a weak score on a class someone
  else delivered must not read as a weak score on their own teaching;
- later restaffing never rewrites history.

**One rating per session, shared by the team.** A student rates the subject once; the mentors on it
share that feedback, split by role. The alternative — rating each mentor separately — would turn a
four-mentor session into 32 stars and four comments, and response rates are the thing that
actually determines whether feedback is useful.

---

## Reading feedback: one subject, divided by cohort

Open a subject and you get **one consolidated view** with the divisions
underneath it, because a single average for a subject is the right headline and
a poor basis for a decision:

```
GenAI                                    126 responses · 4.00 ★ · 3 batches · 2 year groups
┌──────────────┬──────────────────┬─────────────────┐
│ All years    │ Third Year 3.66  │ Final Year 4.57 │   ← toggle
└──────────────┴──────────────────┴─────────────────┘
  ⚠ These cohorts are 0.91 stars apart on the same subject.

  Per parameter, by year group        Third Year   Final Year    Gap
    Pace of the session                  2.70 ⚠      3.60       0.90
    Engagement & interaction             4.05        4.62       0.57
    Quality of materials                 4.11        4.96       0.85

  Third Year   · AI Ready 2028 · Batch-2   3.90   41 resp   AIML, DS, ISE
               · AI Ready 2028 · Batch-1   3.39   38 resp   CSE
  Final Year   · AI Ready 2027 · Batch-1   4.57   47 resp
```

**Subject → year group → batch.** GenAI scores 4.57 with final-year students and
3.66 with third-year ones; the blended 4.00 describes neither. The point of the
view is seeing those side by side, so "All years" leads with the comparison
rather than repeating the headline, and a gap of half a star or more is called
out explicitly. Batch names deep-link into the batch drill-down, so a division
is a route to the detail rather than a dead end.

Deliberate choices:

- **The whole breakdown ships in the subject's single response**, so switching
  tabs is instant, and the total and the parts are computed from the same stars
  server-side — they cannot drift apart.
- **A cohort with no responses is still listed**, with `null` rather than `0.00`.
  "This batch has not answered" is information; a zero would be a false claim
  about their teaching. Response rate sits beside every figure so a low count
  reads as *few answered*, not *badly rated*.
- **Averages are weighted by rating count at every level**, so a batch of 140
  counts more than one of 60 and a year-group figure equals what you would get
  from the underlying stars directly. Averaging the batch averages instead would
  let a tiny batch swing a whole cohort's score.
- **Two aggregations regardless of size.** The alternative — a query per year
  group and per batch — is a dozen round trips to draw one page.
- **Mentor scoping still applies.** A trainer opening the same subject sees only
  the cohorts they are staffed on; the others report zero rather than leaking.

Subjects that run for a single year group (C Programming, Python, DS, JAVA,
Industry Readiness) show that year's batches with a chart instead of a
comparison, since there is nothing to compare.

---

## The two hard requirements

### 1) Batch passcode — recognizable but random, rotated on every unlock

[`utils/passcode.js`](FMS_Backend/src/utils/passcode.js) derives a **stem** from the batch name
(word initials, uppercased, ≤4, ambiguous glyphs folded), then appends cryptographically random
characters from a typo-safe charset (no `0/O/1/l/I`). `"C · Batch-1"` → `CB7@K73X#9WQ4`.

**~46 bits of secrecy.** The stem is *public* (students already know the batch name) so it counts
for nothing; only the random tail does. Only a **keyed HMAC-SHA256** of the passcode is stored —
never the plaintext, which is shown to the admin **once** at unlock. Locking nulls it. (HMAC rather
than bcrypt: see *Capacity* above — for a server-generated random token it is both ~13,000x faster
and stronger against an offline attack on a stolen database.)

### 2) One anonymous feedback per student — hybrid, 3 layers

- **Layer 1 — passcode gate:** the form is unreachable without the current passcode. Verifying
  issues a short-lived session token that **pins the batch, the round, and the exact parameter set
  the student was shown**.
- **Layer 2 — device lock:** on submit,
  `sha256(batchId + round + httpOnly-cookie-token + coarse-fingerprint + serverSalt)` is stored in
  a **separate `DeviceLock`** collection with a unique `{batch, signatureHash}` index. Irreversible
  and kept **out of** the `Feedback` doc → anonymity preserved.
  With cookies blocked the signature collapses to the fingerprint alone, which is **not** unique
  across a lab of identical machines — so the lock is **skipped** there rather than wrongly
  rejecting a real student, and the response reports `deviceLocked: false`.
- **Layer 3 — live cap:** a conditional atomic `$inc` blocks submissions past `expectedCount` and
  can never overshoot, however concurrent.

All writes run in **one MongoDB transaction**, degrading to ordered writes on a standalone.

**Rounds.** Unlocking bumps `Batch.round`, which is mixed into the device signature. A second
collection round on the same cohort therefore starts from a clean namespace instead of silently
rejecting everyone who answered the first — while the old locks remain as a record.
`GET /api/batches/:id/rounds` shows the history.

> This is a **privacy-preserving best-effort** model (no identity is collected, by design). A clean
> extension point for a stricter **"one-time token per seat"** mode is documented at the bottom of
> `publicController.js`.

---

## Capacity — can a whole cohort submit at once?

Yes, and it is measured rather than assumed. `npm run loadtest` drives the real
HTTP endpoints with N independent simulated browsers (own cookie jar, own
fingerprint), then verifies the stored rows, device locks and counter all agree:

```bash
cd FMS_Backend
npm run start:cluster                               # in another terminal
npm run loadtest -- --students=400                  # all 400 at once
npm run loadtest -- --students=400 --concurrency=40 # realistic pacing
```

### The result depends almost entirely on where the database is

Identical code, identical 400 students, 8 workers — only the database moved:

| Database | Throughput | 400 students, all at once | verify p50 | submit p50 |
|---|---|---|---|---|
| **Co-located** (same host/region) | **289/sec** | **1.4 s** | 0.67 s | 0.18 s |
| Remote Atlas, 27 ms away | 18/sec | 22 s | 7.9 s | 12.0 s |

Every run: **400/400 submitted, zero failures, counters exactly consistent.**

The ceiling is *network round-trips to the database*, not CPU and not Node — a
student's submission makes about six of them, so 27ms of latency costs ~160ms
before any work happens. **Deploy the API in the same cloud region as the Atlas
cluster** and a 400-student cohort finishes in well under two seconds. Running
it from a laptop against a distant cluster is what makes it twenty.

At realistic pacing (students trickling in as they finish reading the passcode)
even the remote setup answers in about a second.

### Three failures found by actually running it

Each of these passed every unit test and would have ruined a live session:

1. **Passcode checking froze the server.** `bcryptjs` is pure JavaScript, so a
   cost-10 compare is ~67ms of CPU on the single Node thread — 300 students
   arriving together was **20 seconds** during which the server served nothing
   else. A batch passcode is a server-generated 46-bit random token, not a
   human-chosen password, so a slow KDF buys nothing (there is no dictionary for
   a random token) and a **keyed HMAC** is *stronger* against the attack that
   matters: an attacker holding the database cannot grind it offline without the
   server key. ~0.005ms instead of ~67ms. Legacy bcrypt hashes still verify, so
   upgrading needs no migration.

2. **299 of 300 responses were being lost.** Every submission increments one
   counter on one batch document. Inside a transaction that takes a
   document-level write lock and aborts its rivals with `WriteConflict` (112).
   Measured: **1/300** succeeded; adding retries only reached **25/300**. The
   counter is now claimed with a single atomic `findOneAndUpdate` *outside* the
   transaction, which WiredTiger resolves internally in microseconds. The cap is
   still exact, and if the per-student write then fails the slot is handed back.

3. **A cohort was throttled to 20 students.** The per-device rate limit keys on
   a cookie that is only issued on the first request — so an arriving class is
   briefly cookieless and all of them collapsed onto one IP bucket. The
   per-device budget is now skipped for cookieless requests (the wide per-IP
   backstop covers them), and the device cookie is issued *before* the passcode
   is checked so failed guesses are limited per device too.

---

## Running across every CPU core

Node runs JavaScript on one thread. `npm run start:cluster` forks one worker per
core (capped at 8) and the kernel balances connections across them:

```bash
npm start            # single process — development, or containers where the
                     # orchestrator does the scaling
npm run start:cluster            # one worker per core
WEB_CONCURRENCY=4 npm run start:cluster
```

Clustering is only safe because the shared state was made cluster-aware:

- **Rate limits** live in the primary process, not per worker. Per-process
  counters would have multiplied every limit by the worker count — the control
  weakening by exactly the factor you scaled by, while throughput *looked*
  better. Each limiter also gets its **own namespace**: two of them legitimately
  key on the client IP, and sharing a bucket meant a 400-student burst consumed
  the staff login budget and locked the admin out of the product.
- **The digest scheduler** runs on worker #1 only. Sends are additionally
  claimed atomically in the database, so even a wrong election cannot duplicate
  mail.
- **The connection pool** is divided across workers. `MONGO_MAX_POOL_SIZE` is a
  budget for the whole deployment; 8 workers × 150 would open 1,200 connections
  against an Atlas shared tier that caps the **cluster** at 500 — the app would
  run fine under light load and start refusing connections during exactly the
  burst it was scaled for.
- **A worker that dies is replaced.** Five deaths within 10s of starting is a
  broken build, not a blip, so the process exits with the reason instead of
  spinning forever and burying the real error.
- **SIGTERM drains** in-flight requests before exiting, in every worker.

Two ceilings worth knowing: Atlas shared tiers cap the cluster at 500
connections across *all* app instances, and scaling beyond one host means the
in-primary rate-limit store should be swapped for `rate-limit-redis` (the Store
interface is identical — only the construction changes).

---

## Verifying a deployment

```bash
bash scripts/smoke-test.sh                        # 28 checks against a running stack
API=https://feedback.example.edu bash scripts/smoke-test.sh
```

Checks what unit tests cannot: the process is serving, the database is reachable
*from it*, every surface answers, exports emit real `PK`/`%PDF` bytes, and role
boundaries hold across the wire. Exits non-zero, so a deploy can gate on it.

There is also `GET /api/ready` alongside `/api/health` — liveness says the
process is up, readiness says it can actually serve. An orchestrator routing on
liveness alone will send a cohort's requests to a worker whose database
connection has dropped, and every one of them fails.

---

## Security notes

- **Never commit real credentials.** `.env` is gitignored; `.env.example` is a template and is
  **committed**, so it must only ever hold placeholders. `bash scripts/check-secrets.sh` enforces
  this and runs first in CI. (This guard exists because a live Atlas URI was once committed there.)
- **`DEVICE_SALT` must stay stable.** Every `DeviceLock` row is derived from it; change it and
  every existing lock stops matching, so students who already submitted could submit again on a
  still-open batch.
- **Secrets are validated at boot.** With `NODE_ENV=production` the server refuses to start if
  `JWT_SECRET` or `DEVICE_SALT` is missing, under 32 chars, or a recognisable placeholder.
- **Auth is a JWT in an httpOnly cookie.** The SPA uses the cookie only (same-origin via the
  vite/nginx proxy) and never stores the token in `localStorage`, keeping it out of reach of XSS.
  The login body also returns the token for non-browser clients (tests, curl).
- **Sessions are revocable.** Each JWT carries a generation (`ver`) mirroring `User.tokenVersion`;
  changing a password, resetting one, an admin resetting a mentor's, or "sign out everywhere" all
  bump it, so tokens issued earlier are refused despite still being unexpired.
- **Rate limits are keyed on the device, not the IP.** A classroom of 120 students behind one
  campus NAT is a single IP — an IP budget throttled the legitimate case it was meant to protect.
  Student endpoints are keyed on the first-party device cookie (with a wide per-IP backstop), and
  login is keyed on **email+IP** so one person mistyping their password cannot lock out the campus.
- **Passwords:** minimum 8 characters, with a ban-list and checks against the user's own name and
  email. Login itself does **not** apply the bar, so someone on an older short password can still
  reach the screen where they change it.
- **Query parameters cannot become Mongo operators.** Several handlers place a query value straight
  into a filter, which is safe only while the value is a string. Express 4's default parser (`qs`)
  builds nested objects, so `?action[$ne]=x` was one configuration line away from turning an
  equality match into an operator. The app uses the **simple** query parser (this API has no nested
  parameters), a global middleware guarantees every query value is a plain string regardless of
  parser, and the audit route validates its query with zod. Three independent layers, because the
  first two are configuration and configuration drifts.
- **Known advisories, assessed rather than ignored.** `npm audit` reports `qs` (via Express 4) and
  `uuid` (via ExcelJS). `qs` is no longer used to parse anything an attacker controls — see above.
  ExcelJS calls `uuidv4()` with no arguments, and the advisory is a missing bounds check *when a
  buffer is supplied*, so the vulnerable path is unreachable; the only "fix" npm offers is
  downgrading ExcelJS by a major version, which would break exports for no security gain. On the
  frontend, both react-router advisories are unreachable: every navigation target is a hardcoded
  literal (no user-controlled redirect) and there is no SSR.

---

## Exports (Excel + PDF, everywhere)

Every table and analytics view offers **Export Excel** and **Export PDF**, generated server-side
and reflecting the current filters + role scope.

- **Excel** (ExcelJS): a **Summary** sheet (per-parameter averages, plus the main/support split
  when the report belongs to one mentor) + a **Detail** sheet — one row per submission, carrying
  year group, department, batch, subject, **main mentors**, **support mentors**, every parameter,
  the average and the comment.
- **PDF** (pdfmake): print-clean — centered cells, gridlines, a repeating header row, a page header
  with title + filter context + generated-on, and page numbers. Comments are attributed to their
  batch and subject, because an unattributed comment in a multi-subject batch is unactionable.
- Rows are capped (50,000) and the cap is stated in the file when hit, so one click can never try
  to buffer an unbounded result set.

Endpoints: `GET /api/export/class/:id` · `/batch/:id` · `/trainer/me` · `/dashboard/admin` ·
`/mentors` — each `?format=xlsx|pdf`, plus `role`, `yearGroup`, `dept`, `from`, `to`.

---

## API surface (summary)

```
Auth       POST /api/auth/login · GET /api/auth/me · PATCH /api/auth/me
           PATCH /api/auth/me/digest · GET /api/auth/system
           POST /api/auth/forgot-password · /reset-password
           POST /api/auth/logout · /logout-all
Admin      CRUD /api/trainers · /api/classes · /api/parameters · /api/batches   (paginated)
           POST /api/batches/:id/unlock {expectedCount} → passcode (once), bumps round
           POST /api/batches/:id/lock · /passcode (rotate) · GET /:id/rounds
           PATCH /api/classes/:id/archive · /api/batches/:id/archive
           GET  /api/audit · /api/audit/actions · POST /api/system/digests/run
Analytics  GET  /api/analytics/classes · /class/:id · /batch/:id · /trainer/me
           GET  /api/analytics/trainer/batches · /role-split · /trainers
           GET  /api/analytics/cohorts · /mentor-load · /themes · /comments · /deltas
           all accept ?role=main|support & ?yearGroup= &?dept= &?from= &?to=
Dashboard  GET  /api/dashboard/admin · /api/dashboard/trainer/me
Exports    GET  /api/export/class/:id · /batch/:id · /trainer/me · /dashboard/admin · /mentors
Public     POST /api/public/verify-passcode  (issues device cookie, returns subjects + mentors,
                                              active params, and a session token pinning them)
           POST /api/public/feedback         (transactional write, one row per subject)
```

---

## Run with Docker

```bash
docker compose up --build
```

- Web **http://localhost:8080** · API **http://localhost:5000**
- Mongo runs as a single-node **replica set** (transactions enabled); the API seeds on boot.
- Docker dev admin: `admin@example.com` / `Admin@12345` (from `SEED_ADMIN_PASSWORD` in
  `docker-compose.yml` — **change it for anything real**; the compose file ships demo secrets and
  `COOKIE_SECURE=false` for plain-HTTP local use only).

---

## The 8 default parameters (seeded, admin-editable)

Content clarity · Trainer's subject knowledge · Pace of the session · Engagement & interaction ·
Doubt resolution · Real-world / practical examples · Quality of materials · Overall experience.

---

## Assumptions & decisions

- **ESM** throughout the backend. **Node 20+** (pinned in `engines`).
- **PDF via `pdfmake`** (not Puppeteer) — pure JS, no headless Chromium, so exports are reliable
  in Docker/CI.
- **A subject has no permanent owner.** `Class.trainer` is an optional convenience default used
  to pre-fill a batch's main roster; staffing truth lives on the batch.
- **MongoDB transactions require a replica set.** The API probes support on connect via `hello`
  and uses a real transaction when available, otherwise ordered writes guarded by the unique
  `DeviceLock` index + a conditional atomic counter increment.
- **Live updates use polling (~8s)** — no WebSocket needed.
- **Student answers are drafted to `localStorage`** as they are typed, keyed by batch and round.
  A submission is atomic by design, and a ten-subject batch is 80 stars plus ten comments — a
  dropped connection or an accidental refresh used to destroy all of it. The draft never leaves
  the student's browser and is cleared on success.
- **Soft deletes throughout** (archive classes/batches, deactivate mentors, deactivate parameters)
  so historical feedback is never orphaned. Archiving a subject an open batch is collecting on, or
  deactivating a mentor staffed on one, is refused with the blocking batches named.
- Chart palette validated for both light and dark surfaces; dashboard charts are single-series
  (one brand hue, direct labels, no legend).
