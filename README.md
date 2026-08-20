# USA Budget Copilot

A visual explorer for the United States federal budget, built entirely on
primary U.S. government data feeds. Nothing here is modelled, estimated, or
projected: every figure is something the government published, and every chart
carries the endpoint it came from, when it was fetched, and the caveats that
would make a reader misread it.

## What it shows

| View | Question it answers | Source |
|---|---|---|
| **Overview** | What did the government take in and pay out, and how big is the gap? | Treasury MTS Table 1 |
| **In and out** | Where does the money come from, and which departments spend it? | Treasury MTS Tables 4 and 5 |
| **What it buys** | What is the money *for* — defense, health, interest — across agencies? | USAspending Spending Explorer |
| **Agencies** | Which agencies are largest, under which measure, and how have they changed? | USAspending agency financials |
| **Awards** | Which contractors, states, and industries receive award money? | USAspending award search |
| **Debt** | What is outstanding, and how much is owed to the public vs. to trust funds? | Treasury Debt to the Penny |
| **Sources** | Where every number came from, and what this tool cannot tell you | — |

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

The dev server proxies both government APIs, so the browser makes no
cross-origin request and CORS never enters into it.

```bash
npm run build        # typecheck + production bundle
npm test             # transform and geometry tests
npm run verify:sources                    # call every endpoint, report what it returns
npm run check:deployment <url>            # diagnose a deployed instance end to end
```

## Data sources

Two feeds, both key-free, both federal:

- **[Treasury Fiscal Data API](https://fiscaldata.treasury.gov/api-documentation/)**
  — the Monthly Treasury Statement and Debt to the Penny. This is where the
  headline receipts, outlays, and deficit come from.
- **[USAspending.gov API v2](https://api.usaspending.gov/)** — agency financials,
  budget functions, and award-level detail.

They answer different questions and **their totals are not meant to match.**
Treasury reports cash; USAspending reports budgetary resources, obligations, and
awards. The app says so on the face of each view rather than leaving the reader
to discover it.

[`docs/data-sources.md`](docs/data-sources.md) has the full evaluation: every
endpoint used, the traps in each feed, and why OMB, CBO, BEA, FRED, and GovInfo
were considered and left out (short version: OMB is the real gap — it is the
only authoritative source for what was *appropriated*, and it ships as annual
spreadsheets rather than an API).

## How data gets to the browser

Set `VITE_DATA_MODE` (see [`.env.example`](.env.example)):

| Mode | Behavior | Use when |
|---|---|---|
| `proxy` | Requests go through this app's own origin — the Vite dev server locally, the serverless functions in `api/` on Vercel. **Default in dev.** | Normal development; production if CORS blocks direct |
| `direct` | The browser calls the government APIs itself. **Default in a production build.** | Deployed static hosting |
| `snapshot` | Reads pre-fetched JSON from `/data`, no network at all. | Offline, locked-down networks, reproducible demos |

For snapshot mode:

```bash
npm run ingest                       # writes public/data/*.json
VITE_DATA_MODE=snapshot npm run dev
```

Snapshot files are named by a hash of the request that produced them, computed
by [`shared/cacheKey.mjs`](shared/cacheKey.mjs) — the *same* module the browser
uses — so a snapshot can only ever be served for the exact request it was
captured for. `public/data/*.json` is gitignored; snapshots are yours, not the
repo's.

## Deploy

```bash
npm i -g vercel && vercel --prod
```

Or import the repo at [vercel.com/new](https://vercel.com/new) — `vercel.json`
carries the build config and there are no API keys to set.

A production build defaults to **direct mode**, so the browser calls the
government APIs itself: static hosting only, no serverless invocations. If that
turns out to be blocked by CORS, the proxy functions in [`api/`](api) are already
deployed and idle — set `VITE_DATA_MODE=proxy` in the Vercel dashboard and
redeploy to route through your own origin instead.

[`docs/deploy-vercel.md`](docs/deploy-vercel.md) covers how to tell which case
you are in, what the proxy functions will and will not forward, and how to pin a
deployment to snapshot data.

## Design notes

**Every chart cites itself.** The footer of each panel expands into the exact
endpoint and request body, the retrieval timestamp, the publisher's update
cadence, and the specific ways that feed can mislead. A budget figure without a
traceable source is an opinion.

**Failures are specific.** A schema mismatch (a feed renamed a column) and a
network failure need completely different fixes, so they are reported
differently and each names the next step. Nothing renders a zero where it means
"unknown".

**Charts follow one system.** Colors come from a CVD-validated categorical
palette assigned in fixed slot order, so filtering never repaints a series and a
ninth series folds into "Other" rather than inventing a hue. Diverging color is
opt-in and used only where the sign is the story (surplus vs. deficit) — a
category that nets negative because of refunds is not a polarity. Every chart
has a table view, a legend for two or more series, keyboard-reachable marks, and
a dark mode stepped for the dark surface rather than flipped.

## Architecture

```
shared/          request builders + cache key — shared by the browser and Node
  requests.mjs   every endpoint URL and POST body, defined once
  cacheKey.mjs   deterministic request → snapshot filename
src/lib/
  http.ts        fetch with timeout, bounded retry, dedupe, cache, provenance
  api/           typed clients; tolerant field resolution over both feeds
  format.ts      money, percent, and date formatting
  fiscalYear.ts  federal fiscal-year arithmetic (Oct 1 – Sep 30)
src/components/
  charts/        hand-built SVG primitives — line, bar, column, composition
  Panel.tsx      chart frame: legend, chart/table toggle, source note, errors
src/views/       one file per view
api/             optional Vercel proxy functions, one per upstream
scripts/
  ingest.mjs         snapshot writer
  verify-sources.mjs live schema check against every endpoint
```

## Status and known gaps

Built and verified here: typecheck, production build, 85 unit tests over the
data transforms, chart geometry, and proxy path handling, plus a full render
pass of every view in both light and dark mode (layout checked against synthetic
fixtures, since the machine this was built on has no egress to `.gov` hosts).

**Not yet verified against the live APIs.** The endpoint paths and response
shapes are as documented, and the field readers accept several candidate names
per value, but the first thing to run on a networked machine is:

```bash
npm run verify:sources
```

If a field name has drifted, that command prints the name the feed uses today
and where to add it. Every panel also fails loudly rather than silently, so a
mismatch shows up as a labelled error rather than a plausible-looking zero.

**CORS in direct mode is likewise unconfirmed** for the same reason. Both APIs
are public and browser-facing and are expected to allow it; if a deployment
shows CORS errors, switching to proxy mode is one environment variable.

Other gaps, in the order worth closing:

1. **OMB Public Budget Database** — appropriations vs. actual spending is the
   single most useful missing comparison.
2. **BEA GDP** — spending as a share of GDP, so figures across decades are
   comparable.
3. **Inflation adjustment** — everything is nominal dollars today.
