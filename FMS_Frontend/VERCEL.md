# Why `vercel.json` proxies `/api`

The rewrite is not a convenience — it is what keeps authentication working.

## The problem it solves

This app's entire auth model is a **first-party httpOnly cookie**. The JWT is
deliberately never placed in `localStorage`, which is what keeps it out of reach
of XSS. That design depends on the browser treating the API as *same-origin*
with the app.

Deploy the SPA to `your-app.vercel.app` and the API to
`your-api.onrender.com`, and let the browser talk to Render directly, and those
are two different sites. The consequences are not subtle:

- `SameSite=Lax` cookies are **not sent** on cross-site requests, so sign-in
  appears to succeed and every request afterwards returns 401.
- Setting `SameSite=None` to work around that turns it into a **third-party
  cookie**, which Safari blocks by default and Chrome is restricting. Sign-in
  then fails for those users with no error message at all.
- For students it is worse. The anti-duplicate device lock is seeded by its own
  cookie; if that cookie cannot be set, `hasReliableDeviceToken` is false and
  the lock is skipped by design, so one person can submit repeatedly from the
  same phone. A large share of students are on iOS Safari.
- `SameSite=None` also forfeits the CSRF protection `Lax` was providing.

## What the rewrite does

`/api/*` is proxied by Vercel to the Render service, so the browser only ever
talks to `your-app.vercel.app`. The cookie is set on that host, stays
first-party, keeps `SameSite=Lax`, and nothing in the application code has to
change.

## Setting it up

The destination is already set to this deployment's API:

```json
{ "source": "/api/:path*",
  "destination": "https://fms-api-dzuv.onrender.com/api/:path*" }
```

Change it if the Render service is ever renamed or replaced.

Leave `VITE_API_URL` **unset** in Vercel's environment variables. The axios
client falls back to a relative `/api`, which is exactly what the rewrite
expects. Setting it would send the browser straight to Render and reintroduce
every problem above.

## The trade-off, stated honestly

Every API call takes one extra hop through Vercel's edge — tens of milliseconds.
Worth it for the security property, and small next to the database round trips.

If you later find Vercel's proxy limits get in the way of large Excel or PDF
exports, the fix is to fetch **only those two endpoints** directly from Render
(they are plain authenticated GETs and can carry a `Bearer` token instead of a
cookie), rather than moving the whole API cross-origin.

## SPA routing

The second rewrite sends everything else to `index.html` so client-side routes
like `/admin/batches` and `/feedback/:batchId` work on a hard refresh. Vercel
matches real static files first, so assets are unaffected. Order matters: the
`/api` rule must come first.
