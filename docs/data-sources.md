# Federal budget data sources

An evaluation of what is actually available, what each source is authoritative
for, and why this tool reads the two it reads.

## The short answer

**USAspending.gov does have a real API** — a well-documented, versioned, key-free
REST API at `https://api.usaspending.gov`, browsable at that same URL. It is not
a scraping target; it is the interface USAspending's own website is built on.

But USAspending alone will not give you a picture of the federal budget, and
this is the trap most budget dashboards fall into. USAspending is authoritative
for **award-level and account-level detail** — which agency, which account, which
contractor. It is *not* where the headline numbers live. Total receipts, total
outlays, and the deficit come from Treasury's **Monthly Treasury Statement**,
published through the **Treasury Fiscal Data API**, which is also key-free and is
the better primary source for the top-line figures.

So: use both. They answer different questions, and their totals are not supposed
to match.

## The two feeds this tool reads

### 1. Treasury Fiscal Data API

```
https://api.fiscaldata.treasury.gov/services/api/fiscal_service
```

No key, no registration. Returns JSON, supports `filter`, `sort`, `fields`, and
`page[size]` / `page[number]` parameters.

| Dataset | Endpoint | What it answers |
|---|---|---|
| MTS Table 1 | `/v1/accounting/mts/mts_table_1` | Receipts, outlays, deficit — monthly and fiscal-year-to-date |
| MTS Table 4 | `/v1/accounting/mts/mts_table_4` | Receipts by source (income tax, payroll tax, customs…) |
| MTS Table 5 | `/v1/accounting/mts/mts_table_5` | Outlays by department |
| Debt to the Penny | `/v2/accounting/od/debt_to_penny` | Total debt outstanding, every business day |

**Why it is the right top-line source.** These are the actual cash numbers, on
the government's own books, published on a fixed monthly schedule. They are what
"the deficit was $X" means when a news story says it.

**What will bite you.** Amounts arrive as *strings*. Missing values arrive as the
literal strings `null` and `(*)`, which parse to `0` if you are careless — that
is a silent wrong answer, not an error, so this tool routes every read through
[`fieldResolution.ts`](../src/lib/api/fieldResolution.ts) and treats those
markers as missing. The tables also mix parent roll-up rows in with their
children; charting both double-counts.

### 2. USAspending.gov API v2

```
https://api.usaspending.gov
```

No key, no registration. Mixed `GET` and `POST`; the search endpoints take a
JSON filter object.

| Endpoint | Method | What it answers |
|---|---|---|
| `/api/v2/references/toptier_agencies/` | GET | Every agency's budgetary resources, obligations, outlays |
| `/api/v2/agency/{code}/budgetary_resources/` | GET | One agency, year by year |
| `/api/v2/spending/` | POST | The Spending Explorer: obligations by budget function, subfunction, federal account, object class |
| `/api/v2/search/spending_by_category/{category}/` | POST | Top recipients, states, agencies, industries |
| `/api/v2/search/spending_over_time/` | POST | Award obligations grouped by year, quarter, or month |

**Why it earns its place.** It is the only source with cross-agency *purpose*
(budget function) and *recipient* detail, and it is updated far more often than
the annual budget documents.

**What will bite you.** Three different measures get casually called "spending"
and they are not interchangeable:

- **Budgetary resources** — what an agency may legally obligate, including
  balances carried in from prior years. Bigger than the year's appropriation.
- **Obligations** — money legally committed. Leads cash by months or years.
- **Outlays** — cash actually paid. This is the one that ties to Treasury.

And the biggest one: **award data is not the budget.** Social Security benefits,
Medicare benefits, and interest on the debt are most of federal spending and
none of them are awards. A "top recipients" chart is a chart of contractors and
grantees, not of where the money goes.

## Evaluated and deliberately not wired in

| Source | Verdict |
|---|---|
| [OMB Public Budget Database](https://www.whitehouse.gov/omb/budget/) & Historical Tables | **The** source for enacted and proposed budget *authority*, account-level, back to 1962. Ships as XLSX once a year — belongs in a scheduled ingest, not a live call. This is the real gap in the current build. |
| [CBO budget and economic data](https://www.cbo.gov/data/budget-economic-data) | The source for ten-year projections. Excel workbooks, no JSON API; CBO also publishes standardized CSV extracts on GitHub. Nothing in this tool is a forecast, so it is out of scope by design rather than by difficulty. |
| [BEA API](https://apps.bea.gov/API/signup/) | Needed to express spending as a share of GDP, which is the only honest way to compare 1985 with 2026. Proper JSON API, but requires a free key — so it is not a hard dependency of the default build. The most valuable thing to add next. |
| [FRED](https://fred.stlouisfed.org/docs/api/fred/) | Excellent API, long histories — but it republishes Treasury/BEA/CBO. For a tool whose premise is primary sources it is a fallback, not an origin. Requires a key. |
| [GovInfo](https://www.govinfo.gov/app/collection/budget) | The Budget of the U.S. Government as published, including the Appendix. Authoritative *documents*; the tables inside are PDFs. A citation source, not a data feed. Requires a key. |
| [Data.gov](https://data.gov) | A catalog, not a feed. Useful for discovery; the datasets it points at are the ones above. |

## Things no feed will tell you

Worth stating plainly, because a polished dashboard implies more than it knows:

- **Nominal dollars only.** Nothing here is inflation-adjusted. Comparing 2005
  and 2026 at face value overstates growth.
- **No GDP denominator** until BEA is wired in.
- **Revisions are routine.** The newest month of MTS data is preliminary, and
  award obligations move retroactively as modifications are filed.
- **Agency submissions lag.** The current fiscal quarter is incomplete until
  every agency reports, which is why fiscal-year pickers here default to the
  last complete year.
- **Nothing measures whether the spending worked.** These are amounts and
  recipients, not outcomes.

## Keeping the app honest about schema drift

Government feeds occasionally rename a column. Run:

```bash
npm run verify:sources
```

It calls every endpoint the app depends on and prints, per endpoint, which field
names resolved and which did not — plus the full list of fields the feed
actually returned. A rename becomes a one-command diagnosis instead of a chart
quietly full of zeros.
