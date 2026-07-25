# Feedback Management System — Architecture

**Stack:** React (Vite) · Node.js + Express · MongoDB (Mongoose) — the "MERN" stack.
**Author's intent:** Collect anonymous, one-per-student feedback on training classes across 8 admin-configurable star parameters plus a mandatory comment, gated by a batch passcode that is unlocked per-session by the admin.

---

## 1. System Overview

There are **two authenticated roles** (Admin, Trainer) and **one anonymous flow** (Student feedback). Students are never asked to log in or reveal identity.

```
                    ┌──────────────────────────────────────────────┐
                    │                 React SPA                     │
                    │  /admin   /trainer   /feedback/:batchLink     │
                    └───────────────┬──────────────────────────────┘
                                    │  HTTPS / JSON (JWT for admin+trainer)
                    ┌───────────────▼──────────────────────────────┐
                    │            Express REST API                   │
                    │  auth · batches · classes · parameters ·      │
                    │  feedback · analytics                         │
                    └───────────────┬──────────────────────────────┘
                                    │  Mongoose ODM
                    ┌───────────────▼──────────────────────────────┐
                    │                 MongoDB                       │
                    │  Users · Trainers · Classes · Batches ·       │
                    │  Parameters · Feedback · DeviceLocks          │
                    └──────────────────────────────────────────────┘
```

### Roles at a glance

| Capability | Admin | Trainer | Student (anon) |
|---|---|---|---|
| Create/manage trainers | ✅ | ❌ | ❌ |
| Create classes & assign to trainers | ✅ | ❌ | ❌ |
| Configure the 8 rating parameters | ✅ | ❌ | ❌ |
| Unlock / lock a batch (generate passcode) | ✅ | ❌ | ❌ |
| See ALL feedback, filter by class/batch/trainer | ✅ | ❌ | ❌ |
| See feedback ONLY for their assigned classes | ❌ | ✅ | ❌ |
| Submit feedback (once) | ❌ | ❌ | ✅ |

---

## 2. Core Domain Concepts

- **Class** — a named training session/subject (e.g., "React Fundamentals"). Assigned by the admin to exactly one Trainer (or many, if you allow co-trainers — default: one).
- **Batch** — a cohort of students taking a Class in a time window (e.g., "FSD-Aug-2025"). A Class can have many Batches over time. **The passcode lives on the Batch**, not the Class, so each cohort's feedback is isolated.
- **Parameter** — one of the (default 8) admin-editable rating dimensions. Rated 1–5 stars.
- **Feedback** — one anonymous submission: a rating per active parameter + one mandatory comment, tied to a Batch.
- **Window** — a batch is only open for submissions while the admin has "unlocked" it. Unlocking (re)generates the passcode; locking closes the window and invalidates the passcode.

---

## 3. The Batch Passcode Algorithm (the tricky requirement)

**Goal:** a passcode that *looks like it belongs to the batch* (recognizable identity) but is **random and unguessable**, regenerated every time the batch is unlocked so old codes die.

### Design
1. **Derive a stem from the batch name** — strip whitespace, take up to the first 4 alphanumeric "signal" characters (prefer initials of words / leading consonants), uppercase them. `"Full Stack Aug 2025"` → `FSAU` (or `FS25` if you weight digits).
2. **Inject entropy** — append a cryptographically random block: 3 random digits + 2 random letters + 1 symbol from a safe set `! @ # $ % & * ?` (avoid `< > " ' / \` to keep it URL/DB safe).
3. **Interleave** so it reads as an identity, not two glued halves: `FS25` + `@` + `k7X` + `#3` → `FS25@k7X#3`.
4. **Length** 8–12 chars. **Charset** excludes ambiguous glyphs (`0/O`, `1/l/I`) to reduce student typos.
5. **Regenerate on every unlock.** Store only a **hash** of the passcode (bcrypt) plus a short **display copy shown once to the admin** at generation time — never store plaintext long-term.

### Reference implementation (Node)
```js
import crypto from 'crypto';

const SYMBOLS = '!@#$%&*?';
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I, O, L
const DIGITS  = '23456789';                // no 0, 1

const pick = (set) => set[crypto.randomInt(set.length)];
const randChars = (set, n) => Array.from({ length: n }, () => pick(set)).join('');

function stemFromName(name) {
  const words = name.replace(/[^A-Za-z0-9 ]/g, '').trim().split(/\s+/);
  let stem = words.length > 1
    ? words.map(w => w[0]).join('')            // initials of each word
    : name.replace(/[^A-Za-z0-9]/g, '');       // single word → leading chars
  return stem.toUpperCase().slice(0, 4).padEnd(2, 'X');
}

export function generateBatchPasscode(batchName) {
  const stem = stemFromName(batchName);        // e.g. "FSA"
  const body = randChars(LETTERS, 2) + randChars(DIGITS, 2); // "K7X3" -> mixed below
  const mixed = randChars(LETTERS, 1) + randChars(DIGITS, 2) + randChars(LETTERS, 1);
  return `${stem}${pick(SYMBOLS)}${mixed}${pick(SYMBOLS)}${randChars(DIGITS,1)}`;
  // e.g. "FSA@K73X#9"  — recognizable + unguessable
}
```
> Store `passcodeHash = bcrypt.hash(passcode)`. Compare on student entry. Rotate on every unlock.

---

## 4. Anonymous "One Feedback Per Student" — Hybrid Model (chosen)

Because **no student identity is collected**, uniqueness is enforced by three independent layers. Each is imperfect alone; together they make duplicate submission hard and visible.

**Layer 1 — Batch passcode gate.** Student cannot even see the form without the current, unlocked batch passcode. This scopes who can submit to "people physically in that session right now."

**Layer 2 — Device lock (soft identity).** On submit, the server records a **hashed device signature** = `sha256(batchId + cookieToken + fingerprint + serverSalt)`, where `cookieToken` is a first-party httpOnly token (24 random bytes, issued on first form load — the strongest of the signals) and `fingerprint` is a **deliberately coarse, non-tracking** client hint: `userAgent + screen + timezone + language`. **No canvas hash and no FingerprintJS** — a canvas fingerprint is a tracking-grade signal that contradicts the anonymity goal, so it is intentionally omitted; the cookie token carries the weight. A repeat signature for the same batch is rejected with *"Feedback already recorded for this device."* This stops the casual double-submit. It is **hashed and un-reversible**, so it is *not* PII and cannot be traced back to a student. *(Impl: `utils/deviceSignature.js`, `lib/fingerprint.js`.)*

**Layer 3 — Live submission counter + cap.** The admin sets `expectedCount` (class size) when unlocking. The dashboard shows `submitted / expected` in real time (WebSocket or polling). Submissions beyond the cap are blocked, and the admin can watch for anomalies. This catches the case where someone clears their browser to re-submit — the count would exceed the roster and the admin sees it.

> **Honesty about limits:** none of these collect identity, so a determined student on a second device *could* submit twice. The hybrid makes it (a) require effort, (b) bounded by the cap, and (c) visible to the admin. This is the correct privacy/accuracy tradeoff for anonymous feedback. If you ever need hard guarantees, switch to the "one-time token per seat" model (issue N single-use sub-codes) — the schema below leaves room for that upgrade.

---

## 5. Data Models (Mongoose)

```js
// User (admin + trainer share this collection, discriminated by role)
User {
  _id, name, email (unique), passwordHash,
  role: 'admin' | 'trainer',
  isActive: Boolean,
  createdAt, updatedAt
}

// Class
Class {
  _id, name, description,
  trainer: ObjectId → User(role:'trainer'),
  isActive: Boolean,
  createdAt, updatedAt
}

// Batch  (a cohort of a Class; owns the passcode + window)
Batch {
  _id,
  class: ObjectId → Class,
  name,                         // e.g. "FSD-Aug-2025"
  passcodeHash,                 // bcrypt, null when locked
  // NOTE: no plaintext passcode field is persisted. The plaintext is returned
  // in the unlock/rotate HTTP response ONCE and never written to a document.
  status: 'locked' | 'open',
  expectedCount: Number,        // class size (cap)
  submittedCount: Number,       // denormalized live counter
  openedAt, closedAt,
  createdAt, updatedAt
}

// Parameter  (admin-configurable, the "8" defaults seeded)
Parameter {
  _id, label, description,
  order: Number,
  isActive: Boolean,
  createdAt, updatedAt
}

// Feedback  (anonymous)
Feedback {
  _id,
  batch: ObjectId → Batch,
  class: ObjectId → Class,      // denormalized for fast trainer/admin queries
  ratings: [ { parameter: ObjectId → Parameter, stars: 1..5 } ],
  comment: String (required, trimmed, min length e.g. 10),
  createdAt                     // NO ip, NO student id, NO device sig stored here
}

// DeviceLock  (separate collection so Feedback stays clean/anonymous)
DeviceLock {
  _id,
  batch: ObjectId → Batch,
  signatureHash: String,        // sha256(batch+cookieToken+fingerprint+salt), UNIQUE per batch
  createdAt
}
// Unique compound index: { batch, signatureHash }
```

**Key indexes**
- `Feedback`: `{ batch: 1 }`, `{ class: 1 }`
- `DeviceLock`: unique `{ batch: 1, signatureHash: 1 }`
- `Batch`: `{ class: 1, status: 1 }`
- `User`: unique `{ email: 1 }`

> The **device signature is stored in `DeviceLock`, never in `Feedback`** — so even the admin/DB cannot correlate a comment with a device. This is a deliberate anonymity guarantee.

### Default 8 seeded parameters
Content clarity · Trainer's subject knowledge · Pace of the session · Engagement & interaction · Doubt resolution · Real-world / practical examples · Quality of materials · Overall experience. *(All editable in the admin panel.)*

---

## 6. REST API Surface

**Auth (admin + trainer)**
```
POST   /api/auth/login              → { token, role }
GET    /api/auth/me
POST   /api/auth/logout
```

**Admin — trainers, classes, parameters, batches**
```
POST   /api/trainers                 create trainer
GET    /api/trainers
PATCH  /api/trainers/:id             activate/deactivate/edit

POST   /api/classes                  create + assign trainer
GET    /api/classes
PATCH  /api/classes/:id

GET    /api/parameters
POST   /api/parameters               add
PATCH  /api/parameters/:id           rename/reorder/toggle
DELETE /api/parameters/:id           (soft delete)

POST   /api/batches                  create batch under a class
POST   /api/batches/:id/unlock       {expectedCount} → generates passcode, returns plaintext ONCE
POST   /api/batches/:id/lock         closes window, nulls passcode
POST   /api/batches/:id/passcode     ROTATE: regenerate + re-hash, return new plaintext ONCE
                                     (POST, not GET — it mutates state; plaintext is never stored)
```

**Analytics**
```
GET    /api/analytics/class/:classId       admin: aggregates for a class (avg per param, count, comments)
GET    /api/analytics/batch/:batchId        admin: per-batch breakdown
GET    /api/analytics/trainer/me            trainer: only their assigned classes/batches
```

**Dashboard summaries (premium dashboards)**
```
GET    /api/dashboard/admin          KPIs + chart series for the whole system
GET    /api/dashboard/trainer/me     KPIs + chart series scoped to the trainer
```

**Exports — Excel + PDF (everywhere)**
```
GET    /api/export/class/:id?format=xlsx|pdf     class feedback export
GET    /api/export/batch/:id?format=xlsx|pdf     batch feedback export
GET    /api/export/trainer/me?format=xlsx|pdf    trainer's own data (scoped)
GET    /api/export/dashboard/admin?format=xlsx|pdf
```
Every export honors the same role scoping + active filters as its analytics counterpart. See §11 for format rules.

**Public — student flow (no auth)**
```
POST   /api/public/verify-passcode   { batchLink or batchId, passcode } → { ok, batchId, parameters[] }
                                       also issues httpOnly device cookie
POST   /api/public/feedback          { batchId, ratings[], comment }
                                       → validates: window open, device not locked, cap not exceeded
                                       → writes Feedback + DeviceLock atomically (transaction)
```

**Server-side validation on `POST /api/public/feedback`:**
1. Batch exists and `status === 'open'`.
2. Passcode session token (from verify step) is valid.
3. `ratings` has a star (1–5) for **every active parameter**.
4. `comment` present and ≥ min length (mandatory box).
5. Device signature not already in `DeviceLock` for this batch.
6. `submittedCount < expectedCount` (an `expectedCount` of 0 means "uncapped").
7. On success: insert Feedback + DeviceLock + increment `submittedCount`. When Mongo
   supports transactions (replica set / mongos) these run in **one transaction**;
   on a standalone the API **degrades gracefully to ordered writes** made safe by
   the unique `DeviceLock` index + a conditional atomic `$inc` (the cap can never be
   overshot either way). The cap is enforced authoritatively by that conditional
   `$inc`, not just the pre-check in step 6.

---

## 7. Frontend Structure (React + Vite)

```
src/
  main.jsx, App.jsx           // routes live inline in App.jsx (no separate router.jsx)
  api/            client.js (axios, withCredentials — cookie is the sole auth transport,
                  no token in localStorage), endpoints.js
  auth/           AuthContext (also exports useAuth), ProtectedRoute (role-aware, UX-only)
  components/     StarRating, Card, Modal, Toast, EmptyState, StatTile,
                  ExportButtons (Excel+PDF), charts/ (Recharts), InfoTooltip
  export/         (server-side, in FMS_Backend) excelBuilder.js (ExcelJS), pdfBuilder.js (pdfmake)
  lib/            fingerprint.js (coarse, non-tracking device hint)
  layouts/        AdminLayout, TrainerLayout, AppShell
                  (no PublicLayout — the student flow is self-contained in StudentFlow.jsx)
  pages/
    public/
      StudentFlow.jsx          // orchestrates the 3 steps as a state machine
      EnterPasscode.jsx        // step 1: batch passcode entry
      FeedbackForm.jsx         // step 2: one star row per active parameter + mandatory comment
      ThankYou.jsx             // step 3: success, no resubmission
    admin/
      Dashboard.jsx            // KPIs, filters by class/batch/trainer
      Trainers.jsx  Classes.jsx  Parameters.jsx
      Batches.jsx              // unlock/lock, live submitted/expected counter, copy passcode
      ClassFeedback.jsx        // drill-down: avg stars per param + comment list
    trainer/
      Dashboard.jsx            // only their classes
      ClassFeedback.jsx
  hooks/          usePolling (live submitted/expected via ~8s polling)
  theme/          ThemeContext (class-based light/dark, persisted)
```

**Student UX (attractiveness matters):** three calm steps, big tappable 5-star rows with labels, an animated progress bar, a warm confirmation screen, mobile-first (students submit on phones). Comment box shows a live character counter and can't submit empty. Use a friendly accent color, generous spacing, subtle micro-animations (framer-motion) on star select and on submit success. Fully responsive.

---

## 7.1 Premium Dashboards (Admin & Trainer)

Both roles land on a **premium, self-documenting dashboard** after login. Design goal: *a newcomer understands the entire application just by reading the dashboard* — what data exists, how sections connect, and what each metric means.

**Admin dashboard — whole-system view**
- **KPI tiles:** total trainers, classes, batches, open batches, total feedback collected, overall average rating.
- **Structure/overview panel:** a plain-language map of the app flow — *Classes → assigned Trainers → Batches (passcode-gated window) → anonymous Student feedback → analytics* — so anyone grasps the model instantly.
- **Charts (Recharts):** average stars per parameter (bar), rating trend over time (line), feedback volume per class (bar).
- **Live open-batches panel:** each open batch with its `submitted / expected` counter and passcode status.
- **Filters** (class / batch / trainer) that drive every widget; a recent-feedback feed with comments.

**Trainer dashboard — their data only (same premium quality)**
- KPI tiles scoped to the trainer (my classes, my batches, feedback received, my overall average).
- The same explanatory overview framed around their role; charts for their per-parameter averages, trend, and per-batch breakdown; their students' comments.
- **All series are server-side scoped** to `class.trainer === req.user.id`.

**Self-documenting requirement:** every section and metric carries a short label/tooltip explaining what it represents (what a "batch" is, what "device lock" prevents, what the passcode does). Charts follow the `dataviz` principles (consistent palette, readable axes/legends/tooltips, light/dark accessible). Card-based, consistently spaced, responsive, subtle motion.

## 7.2 Exports — Excel + PDF (everywhere)

Every table/analytics view (admin dashboard, trainer dashboard, class drill-down, batch breakdown, comment lists) shows **two buttons: "Export Excel" and "Export PDF"**, reflecting the currently applied filters, generated **server-side**.

- **Excel (.xlsx) — ExcelJS:** typed columns, bold frozen header row, sensible/auto column widths, a **summary sheet** (averages per parameter) + a **detail sheet** (individual feedback rows).
- **PDF — print-clean (Puppeteer HTML→PDF, or pdfmake):**
  - **Every cell value centered both horizontally and vertically.**
  - Consistent cell padding, even column spacing, visible borders/gridlines.
  - Repeating header row on every page; header shows title + active-filter context + generated-on timestamp; footer shows page numbers.
  - Numbers formatted consistently (averages to 1–2 decimals); no clipped or misaligned columns — it must read as a polished report.
- Exports reuse the analytics role scoping — a trainer can only export their own data.

## 8. Security & Integrity

- **JWT auth for admin/trainer, delivered as an httpOnly cookie** — the browser SPA
  never stores the token in JS-readable storage (no `localStorage`), so it is out of
  reach of XSS. The frontend is served same-origin with the API (vite proxy in dev,
  nginx reverse-proxy in the container), so the first-party cookie needs only
  `sameSite=lax` (which also blunts CSRF). The API *additionally* accepts an
  `Authorization: Bearer` header and returns the token in the login body — purely for
  non-browser clients (tests, mobile, curl); the SPA does not use it. Role checked in
  middleware per route.
- **Secrets fail fast in production.** `JWT_SECRET` and `DEVICE_SALT` are validated at
  startup: with `NODE_ENV=production` the server refuses to boot on a missing, too-short,
  or placeholder value — never a silent insecure default. Cookie `Secure` flag is
  env-driven (`COOKIE_SECURE`, default on in prod).
- **Passwords**: bcrypt. **Passcodes**: bcrypt hash, plaintext shown to admin once.
- **Rate limiting** on `/api/public/*` + login (express-rate-limit) to blunt scripted duplicate/brute-force attempts.
- **Helmet, CORS allowlist, input validation** (zod) on every route.
- **Transactional feedback write** so Feedback + DeviceLock + counter stay consistent when
  Mongo supports transactions; a standalone degrades to ordered writes guarded by the unique
  `DeviceLock` index + conditional atomic `$inc` (see §6).
- **No PII** in Feedback. Device signatures are salted hashes in a separate collection.
- **Trainer isolation** enforced server-side (never trust the client to filter) — a trainer's queries are always scoped to `class.trainer === req.user.id`.

---

## 9. Suggested Repo Layout & Tooling

```
FMS/
  FMS_Backend/    Express, Mongoose, routes, controllers, middleware, seed script, .env.example
  FMS_Frontend/   Vite React app, tailwind, framer-motion
  README.md  docker-compose.yml (mongo + api + web)  .github/workflows/ci.yml
```
Extras worth building in: `.env.example`, a `seed.js` that creates one admin + the 8 default parameters, Jest/Supertest API tests for the anti-duplicate logic, and a Postman/Thunder collection.

---

## 10. Build Order (what Claude Code should do, in sequence)
1. Scaffold `FMS/` root with `FMS_Frontend/` and `FMS_Backend/`, install deps, wire `.env`.
2. Mongoose models + indexes + seed script (admin + 8 parameters).
3. Auth (login, JWT middleware, role guards).
4. Admin CRUD: trainers → classes → parameters → batches (with passcode gen + lock/unlock).
5. Public flow: verify-passcode → feedback submit (with hybrid anti-duplicate + transaction).
6. Analytics + dashboard-summary endpoints (admin all + trainer-scoped).
7. Export endpoints — Excel (ExcelJS) + PDF (centered cells, print-clean), role-scoped.
8. React: auth, layouts, the premium admin & trainer dashboards, admin pages, trainer pages, the 3-step student flow; wire Export Excel/PDF buttons on every table/analytics view.
9. Styling pass for the student flow (mobile-first, animated, attractive) + polish pass on both dashboards (self-documenting labels/tooltips, premium design).
10. Tests for anti-duplicate + validation + export scoping; seed & smoke-test end-to-end.
11. README with run instructions + docker-compose.
