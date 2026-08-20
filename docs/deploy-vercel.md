# Deploying to Vercel

The app is a static bundle plus two optional serverless functions. Vercel needs
no configuration beyond what is already in [`vercel.json`](../vercel.json).

## Deploy

**From the dashboard.** Import the GitHub repo at
[vercel.com/new](https://vercel.com/new). Vercel reads `vercel.json` and picks up
the Vite framework preset, the `npm run build` command, and the `dist` output
directory. Pick the branch you want (`claude/us-budget-visualization-b73cyx`
until it merges) and deploy. Nothing else to fill in — there are no API keys.

**Or from the CLI:**

```bash
npm i -g vercel
vercel          # preview deployment
vercel --prod   # production
```

## How data flows in production

A production build defaults to **direct mode**: the browser calls
`api.usaspending.gov` and `api.fiscaldata.treasury.gov` itself. No serverless
invocations, no added latency, no bandwidth through your account.

That depends on both APIs sending permissive CORS headers. They are both
public, browser-facing APIs and both are expected to — USAspending's own site
calls its API cross-origin — but this was not verifiable from the machine the
app was built on, so treat it as the first thing to confirm.

**How to tell within ten seconds of opening the deployment:** if the charts fill
in, direct mode works and you are done. If every panel shows a red error box,
open the browser console. A message mentioning *CORS policy* or *Access-Control-
Allow-Origin* means direct mode is blocked. Anything else is a different
problem — the error box names the endpoint and the app distinguishes a schema
mismatch from a network failure.

## Diagnosing a deployment

```bash
npm run check:deployment https://your-app.vercel.app
```

One pass over everything that decides whether a deployment works: whether the
site serves the built bundle, which data mode it was built with, whether the
proxy functions are deployed and reaching upstream, and whether the live APIs
still return every field the app reads.

The last part is the valuable one — in proxy mode it runs the full endpoint
contract *through the deployment*, which is the same path a visitor's browser
takes. A pass there means the deployment genuinely works, not merely that the
government APIs happen to be up.

The one thing it cannot test is CORS in direct mode: CORS is a browser rule and
this script is Node, so a request that a browser would refuse will succeed here.
For that case the script says so and points at the browser console.

## If CORS blocks direct mode

Switch to proxy mode. The serverless functions in [`api/`](../api) are already
deployed and idle; one environment variable turns them on.

1. In the Vercel dashboard: **Settings → Environment Variables**
2. Add `VITE_DATA_MODE` = `proxy` for the Production environment
3. **Deployments → ⋯ → Redeploy** (this is a build-time variable, so it only
   takes effect on a rebuild)

Requests then go to `/api/usaspending/...` and `/api/fiscaldata/...` on your own
origin, which the functions forward upstream. CORS stops applying because the
browser is talking to your domain.

The same variable set to `direct` switches back.

## What the proxy functions do and do not do

They are intentionally narrow, because a proxy that forwards anywhere is an open
relay that someone else will eventually find:

- the upstream host is fixed per route and never read from the request
- only `GET` and `POST` are accepted
- only `accept` and `content-type` are forwarded upstream, so cookies and
  `Authorization` headers never reach a government API
- request bodies are capped at 256 KB
- `Set-Cookie` and other upstream response headers are dropped

They also restore the trailing slash on USAspending paths. Without it the API
answers `301`, and a redirected `POST` becomes a `GET` with no body — the
request silently turns into a different request.

## Cost

In direct mode: static hosting only, which is free on a Hobby plan.

In proxy mode: one function invocation per API request. A page view runs a
handful, so a personal deployment stays inside the free tier comfortably.
Responses carry the upstream `Cache-Control`, and the app also caches in memory
for 30 minutes per request, so navigating between views does not re-fetch.

## Pinning the data instead of fetching it

For a deployment that must not depend on a government API being up — a demo, or
a figure you want stable — build against snapshots:

```bash
npm run ingest                                  # writes public/data/*.json
VITE_DATA_MODE=snapshot npm run build
```

`public/data/*.json` is gitignored, so to ship snapshots you either commit them
deliberately (drop that line from `.gitignore`) or run `npm run ingest` as part
of the build. Snapshot mode makes no network requests at all, and every source
note in the UI says the figure came from a snapshot rather than live.

## Custom domain

**Settings → Domains** in the project. Nothing in the app hardcodes an origin —
proxy paths are relative — so a domain change needs no rebuild.
