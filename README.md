# Feedback Management System (FMS)

A production-quality **MERN** app for collecting **anonymous**, one-per-student feedback on training classes across **8 admin-configurable star parameters + one mandatory comment**, gated by a per-batch passcode.

- **Admin** — manages trainers, classes, parameters and batches; unlocks/locks batches (generating/rotating passcodes); sees all feedback with filters; exports Excel/PDF.
- **Trainer** — sees analytics for **only their own** classes (enforced server-side); exports their own data.
- **Student** — anonymous, no login: enter a batch passcode → rate every parameter → write one comment → submit once.

```
FMS/
  FMS_Backend/    Node + Express + Mongoose API  (JWT httpOnly cookies, ExcelJS, pdfmake)
  FMS_Frontend/   React + Vite + Tailwind + framer-motion + Recharts
  docker-compose.yml   mongo (replica set) + api + web
```

See [`../ARCHITECTURE.md`](../ARCHITECTURE.md) for the full design (passcode algorithm §3, hybrid anti-duplicate model §4, data models §5, API surface §6).

---

## Quick start (local)

**Prerequisites:** Node 18+ and a running MongoDB.
> For the transactional feedback write, run Mongo as a **replica set**. A standalone also works — the API detects it and falls back to ordered writes guarded by the `DeviceLock` unique index. To enable transactions locally:
> ```bash
> mongod --replSet rs0 --dbpath /your/data/dir
> mongosh --eval 'rs.initiate()'
> ```

### 1) Backend

```bash
cd FMS_Backend
cp .env.example .env          # then edit secrets / MONGO_URI as needed
npm install
npm run seed                  # creates admin@example.com + 8 parameters, PRINTS the admin password ONCE
npm start                     # http://localhost:5000
```

The seed prints something like:

```
 Admin email    : admin@example.com
 Admin password : <a strong random password>   ← copy this
```

(Set `SEED_ADMIN_PASSWORD` in `.env` to choose your own instead of a random one.)

### 2) Frontend

```bash
cd FMS_Frontend
cp .env.example .env          # VITE_API_PROXY defaults to http://localhost:5000
npm install
npm run dev                   # http://localhost:5173
```

Open **http://localhost:5173**, sign in as the admin, then:
1. **Trainers** → add a trainer.
2. **Classes** → add a class, assign the trainer.
3. **Batches** → add a batch, **Unlock** it (set the expected class size) → copy the **passcode** + **student link** (shown once).
4. Open the student link (`/feedback/:batchId`) on a phone/incognito, enter the passcode, rate & comment.
5. Watch the **Dashboard** — live `submitted / expected`, charts, comments — and **Export Excel / PDF**.

---

## Run with Docker

```bash
cd FMS
docker compose up --build
```

- Web: **http://localhost:8080**  ·  API: **http://localhost:5000**
- Mongo runs as a single-node **replica set** (transactions enabled); the API container seeds on boot.
- Docker dev admin: **admin@example.com** / **`Admin@12345`** (from `SEED_ADMIN_PASSWORD` in `docker-compose.yml` — change for anything real).

---

## Tests

```bash
cd FMS_Backend
npm test
```

Jest + Supertest spin up an **in-memory Mongo replica set** (so the transaction path is exercised) and prove the hard requirements:

- duplicate device is rejected (`DEVICE_LOCKED`);
- the live cap is enforced (`CAP_REACHED`);
- the comment is mandatory and every active parameter must be rated;
- a valid passcode session is required to submit;
- **a trainer cannot read or export another trainer's data** (403);
- exports return valid `.xlsx` / `.pdf` bytes and honour role scoping;
- no device signature / identity is ever stored on the `Feedback` document.

> First `npm test` may download a Mongo binary for `mongodb-memory-server`. Offline? Point it at a local binary: `MONGOMS_SYSTEM_BINARY=$(which mongod) npm test`.

---

## The two hard requirements (where they live)

### 1) Batch passcode — recognizable but random, rotated on every unlock
[`FMS_Backend/src/utils/passcode.js`](FMS_Backend/src/utils/passcode.js) — derives a **stem** from the batch name (word initials / leading chars, uppercased, ≤4), then interleaves it with `crypto.randomInt` entropy from a **typo-safe charset** (no `0/O/1/l/I`, URL/DB-safe symbols). Example: `"Full Stack Aug 2025"` → stem `FSA` → `FSA@K73X#9`. Only `bcrypt(passcode)` is stored; the plaintext is shown to the admin **once** at unlock and re-rotated on demand. Locking nulls the passcode.

### 2) One anonymous feedback per student — hybrid, 3 layers
- **Layer 1 – Passcode gate:** the form is unreachable without the current passcode ([`publicController.verifyPasscode`](FMS_Backend/src/controllers/publicController.js)).
- **Layer 2 – Device lock:** on submit, `sha256(batchId + httpOnly-cookie-token + lightweight-fingerprint + serverSalt)` is stored in a **separate `DeviceLock`** collection with a unique `{batch, signatureHash}` index. Irreversible and kept **out of** the `Feedback` doc → anonymity preserved. ([`utils/deviceSignature.js`](FMS_Backend/src/utils/deviceSignature.js), [`models/DeviceLock.js`](FMS_Backend/src/models/DeviceLock.js))
- **Layer 3 – Live cap + counter:** admin sets `expectedCount` at unlock; a conditional atomic `$inc` blocks submissions past the cap; the dashboard shows `submitted / expected` live.
- **Feedback + DeviceLock + counter increment run in one MongoDB transaction** ([`publicController.submitFeedback`](FMS_Backend/src/controllers/publicController.js)), degrading to ordered writes on a standalone.

> This is a **privacy-preserving best-effort** model (no identity is collected, by design). A clean extension point for a stricter **"one-time token per seat"** mode is documented at the bottom of `publicController.js`.

---

## Exports (Excel + PDF, everywhere)

Every table/analytics view offers **Export Excel** and **Export PDF**, generated server-side and reflecting the current filters + role scope.

- **Excel** ([`export/excelBuilder.js`](FMS_Backend/src/export/excelBuilder.js), ExcelJS): a **Summary** sheet (averages per parameter) + a **Detail** sheet (one row per submission), bold frozen headers, sensible widths, typed numeric columns.
- **PDF** ([`export/pdfBuilder.js`](FMS_Backend/src/export/pdfBuilder.js), pdfmake): print-clean — **cells centered**, visible gridlines, consistent padding, a **repeating header row**, a page header with **title + filter context + generated-on** timestamp, and **page numbers** in the footer. Numbers formatted to 2 decimals.

Endpoints: `GET /api/export/class/:id`, `/api/export/batch/:id`, `/api/export/trainer/me`, `/api/export/dashboard/admin` — each `?format=xlsx|pdf`, same scoping as analytics.

---

## The 8 default parameters (seeded, admin-editable)
Content clarity · Trainer's subject knowledge · Pace of the session · Engagement & interaction · Doubt resolution · Real-world / practical examples · Quality of materials · Overall experience.

---

## Assumptions & decisions (chosen defaults)

- **ESM** throughout the backend (matches the architecture's `import` snippets).
- **PDF via `pdfmake`** (not Puppeteer) — pure JS, no headless Chromium to install/run, so exports are reliable in Docker/CI while still meeting every print-clean requirement. Data tables are single-line so cells are truly vertically centered; long comments wrap in a dedicated Comments table.
- **One trainer per class** (architecture default).
- **MongoDB transactions require a replica set.** The API probes support on connect (via the `hello` command) and uses a real transaction when available, otherwise ordered writes guarded by the unique `DeviceLock` index + a conditional atomic counter increment (the cap can never be overshot either way).
- **Auth:** JWT in an httpOnly cookie. The **SPA uses the cookie only** (same-origin via the vite/nginx proxy) and never stores the token in `localStorage`, keeping it out of reach of XSS. The API *also* returns the token in the login body and accepts a `Bearer` header, but that path is purely for non-browser clients (tests, mobile webviews, curl). Secrets (`JWT_SECRET`, `DEVICE_SALT`) are validated at boot and the server refuses to start in production with missing/weak values.
- **Device fingerprint** is deliberately coarse (UA + screen + timezone) — a soft signal combined server-side with a secret salt, never a tracking-grade fingerprint, never stored in plaintext.
- **Passcode re-fetch** is implemented as a **rotate** (`GET /api/batches/:id/passcode` generates a fresh code) because plaintext is never persisted.
- **Live updates** use polling (~8s), which the spec permits — no WebSocket needed.
- Chart palette validated with the `dataviz` skill's checker for both light and dark surfaces; dashboard charts are single-series (one brand hue, direct labels, no legend).

---

## API surface (summary)

```
Auth      POST /api/auth/login · GET /api/auth/me · POST /api/auth/logout
Admin     CRUD /api/trainers · /api/classes · /api/parameters · /api/batches
          POST /api/batches/:id/unlock {expectedCount} → passcode (once)
          POST /api/batches/:id/lock   ·  POST /api/batches/:id/passcode (rotate)
Analytics GET  /api/analytics/class/:id · /api/analytics/batch/:id · /api/analytics/trainer/me
Dashboard GET  /api/dashboard/admin · /api/dashboard/trainer/me
Exports   GET  /api/export/class/:id · /batch/:id · /trainer/me · /dashboard/admin   (?format=xlsx|pdf)
Public    POST /api/public/verify-passcode  (issues device cookie, returns active params + session token)
          POST /api/public/feedback         (7 server-side validations, transactional write)
```
