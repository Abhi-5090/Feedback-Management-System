# Deploying to Render + Vercel

**API → Render. SPA → Vercel. Database → your existing Atlas cluster.**

```
  browser ──► your-app.vercel.app ──┬─► static SPA (dist/)
                                    │
                                    └─► /api/*  ──rewrite──►  fms-api.onrender.com
                                                                      │
                                                                      ▼
                                                            Atlas cluster0.sthl35a
```

The `/api` rewrite is the important part, and the reason is in
[`FMS_Frontend/VERCEL.md`](FMS_Frontend/VERCEL.md). In one line: this app
authenticates with a **first-party httpOnly cookie**, deliberately never
`localStorage`, and that only works while the browser sees the API as
same-origin with the app. Point the browser straight at Render instead and
sign-in breaks on Safari, and the students' anti-duplicate device lock quietly
stops working with it.

---

## Before you start

- [ ] **Rotate the Atlas password** if you have not. It was on screen during our
      session. Atlas → Database Access → Edit → Edit Password.
- [ ] **Allow Render to reach Atlas.** Atlas → Network Access. Render's free and
      Starter plans do not give static outbound IPs, so you need `0.0.0.0/0`
      ("allow from anywhere"). That is guarded only by the password, which is why
      rotating it matters. Render's paid plans offer static outbound IPs you can
      allowlist properly — worth it once this is real.
- [ ] **Generate two secrets** and keep them somewhere safe:
      ```bash
      openssl rand -hex 32     # JWT_SECRET
      openssl rand -hex 32     # DEVICE_SALT
      ```
      **`DEVICE_SALT` must never change after go-live.** Every `DeviceLock` row
      is derived from it, so rotating it makes every existing lock stop matching
      and students who already answered could answer again on an open batch.
      `JWT_SECRET` is safe to rotate; it just signs everyone out.

Your Atlas data is already seeded — 24 mentors, 7 subjects, 14 batches — so
there is nothing to import after deploying.

---

## 1. Backend on Render

`render.yaml` in the repo root is a Blueprint. Either:

**Blueprint (recommended)** — Render → *New* → *Blueprint* → pick this repo.
It reads `render.yaml` and prompts for the secrets. Or:

**By hand** — Render → *New* → *Web Service* → pick this repo, then:

| Setting | Value |
|---|---|
| Root Directory | `FMS_Backend` |
| Runtime | Node |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path | `/api/ready` |

Use `/api/ready`, not `/api/health`. Health only says the process is alive;
ready also proves the database answers, so Render will not send traffic to an
instance whose Atlas connection has dropped.

### Environment variables

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `20` |
| `MONGO_URI` | your Atlas SRV string, with the **rotated** password |
| `JWT_SECRET` | the 64-char hex you generated |
| `DEVICE_SALT` | the other one — **never change it** |
| `COOKIE_SECURE` | `true` |
| `COOKIE_SAMESITE` | `lax` |
| `CLIENT_ORIGINS` | `https://your-app.vercel.app` |
| `APP_URL` | `https://your-app.vercel.app` |
| `APP_NAME` | `Torii Training Feedback` |
| `MONGO_MAX_POOL_SIZE` | `60` |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | see §4 |

You will not know the Vercel URL yet. Deploy Render first with a placeholder,
then come back and set `CLIENT_ORIGINS` and `APP_URL` properly in §3.

`NODE_ENV=production` activates the boot guard: the service **refuses to start**
if `JWT_SECRET` or `DEVICE_SALT` is missing, under 32 characters, or a
recognisable placeholder. A failed deploy with that error means the guard did
its job.

Leave the start command as `npm start`. `npm run start:cluster` only helps on an
instance with several CPUs; on the smaller Render plans forking costs memory and
contention for no throughput. If you move to a multi-CPU instance, switch it and
set `WEB_CONCURRENCY` to the core count.

**Check it:** open `https://your-service.onrender.com/api/ready`. You want
`{"ok":true,"database":"reachable"}`. If it says the database is unreachable,
it is the Atlas Network Access list.

---

## 2. Frontend on Vercel

Vercel → *Add New* → *Project* → pick this repo.

| Setting | Value |
|---|---|
| Root Directory | `FMS_Frontend` |
| Framework Preset | Vite |
| Build Command | `npm run build` (default) |
| Output Directory | `dist` (default) |

**Edit `FMS_Frontend/vercel.json` and put your real Render URL in:**

```json
{ "source": "/api/:path*",
  "destination": "https://YOUR-SERVICE.onrender.com/api/:path*" }
```

Commit and push that — Vercel deploys from the repo.

**Do not set `VITE_API_URL`.** Leave it unset so the app calls a relative
`/api`, which is what the rewrite expects. Setting it sends the browser straight
to Render and reintroduces every cookie problem the rewrite exists to avoid.

---

## 3. Point them at each other

Back on Render, set the two values you could not know earlier:

```
CLIENT_ORIGINS = https://your-app.vercel.app
APP_URL        = https://your-app.vercel.app
```

`CLIENT_ORIGINS` is the CORS allowlist. `APP_URL` builds the links inside
password-reset emails, so it must be the address a person can actually open —
the Vercel one, not the Render one. Save; Render redeploys.

If you add a custom domain later, add it to `CLIENT_ORIGINS` (comma-separated)
and update `APP_URL`.

---

## 4. Email

Password reset is the one feature that silently does nothing when unconfigured:
with no SMTP the mailer only writes to the Render log, while `/forgot-password`
still answers *"a link is on its way"* — it has to, or it becomes a way to
discover which addresses are registered.

```
SMTP_HOST = smtp.gmail.com
SMTP_PORT = 587
SMTP_USER = your-address@ncetmail.com
SMTP_PASS = <16-character app password, not the account password>
SMTP_FROM = Torii Training Feedback <your-address@ncetmail.com>
```

Gmail needs an App Password with 2FA enabled. Then sign in as admin →
**Settings** → **Send test**. It tells you whether the message was *delivered*
or merely *logged*, and shows the SMTP error verbatim when credentials are
wrong.

Until it works, an admin can still unblock anyone: **Mentors** → **Reset link**
gives a single-use link to pass on directly.

---

## 5. Verify the deployment

```bash
API=https://your-service.onrender.com \
WEB=https://your-app.vercel.app \
ADMIN_EMAIL=fms@admin.com \
ADMIN_PASSWORD='FMS@Admin' \
bash scripts/smoke-test.sh
```

26 checks: the process is serving, the database is reachable *from it*, every
surface answers, exports emit real `PK`/`%PDF` bytes, and role boundaries hold.
Exits non-zero on failure, so you can gate a deploy on it.

Then in a browser, confirm the part no script covers:

- [ ] Sign in as admin. **Refresh the page** — you should stay signed in. If you
      are thrown back to the login screen, the cookie is not sticking: check the
      `/api` rewrite destination and that `VITE_API_URL` is unset.
- [ ] Open a client-side route directly, e.g. `/admin/batches`. A 404 means the
      SPA fallback rewrite is missing.
- [ ] Unlock a batch, open the student link **on a phone**, and submit.
- [ ] Change the admin password from the seeded `FMS@Admin`.

---

## Things that will surprise you

**Render free instances sleep.** After ~15 minutes idle they take roughly 50
seconds to wake. For a feedback session that is the difference between "slow"
and "broken" for whoever arrives first — and a class of 300 arrives at once. Use
a paid instance for any session that matters, or open the app a few minutes
beforehand to warm it.

**Throughput is bound by database latency, not CPU.** Measured: 289 students/sec
with the API co-located with its database, 18/sec with 27ms between them. Pick
the Render region nearest your Atlas cluster — it is worth more than any
instance upgrade.

**Every "answered %" is derived from feedback rows**, not from the stored
counter, so deleting responses in Atlas cannot leave phantom percentages. If the
stored counter itself drifts (it is the cap guard), run `npm run reconcile`
against production — `--dry-run` first.

**The repo is public.** `CLIENT_ORIGINS`, `MONGO_URI` and both secrets live only
in Render's environment, never in the repo. The CI secret scan enforces that on
every push.

---

## Redeploying

Both platforms deploy on push to `main`. Render rebuilds the API, Vercel
rebuilds the SPA. CI runs the same checks on the commit either way — if it goes
red, the deploy that just went out is the one to look at.
