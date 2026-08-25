#!/usr/bin/env node
/**
 * Turn CBO's open-data CSVs into one vintage-stamped JSON the app can import.
 *
 * Unlike the Treasury and USAspending feeds, this data is not fetched at
 * runtime. CBO's baseline is a *vintage* — a dated snapshot published a couple
 * of times a year — not a live series, so pinning it in the repo is the honest
 * representation. Every chart built on it can then say which baseline it used,
 * and re-running this script against a newer vintage is a reviewable diff
 * rather than a silent change under the reader's feet.
 *
 * Source: https://github.com/US-CBO/cbo-data — CBO's own machine-readable
 * repository, public domain under 17 U.S.C. § 105.
 *
 *   git clone --depth 1 https://github.com/US-CBO/cbo-data /tmp/cbo-data
 *   npm run ingest:cbo -- --repo /tmp/cbo-data
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, '..', 'src', 'data', 'cbo');

function parseArgs(argv) {
  const args = { repo: '/tmp/cbo-data', vintage: '2026-02' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repo' && argv[i + 1]) args.repo = argv[++i];
    else if (argv[i] === '--vintage' && argv[i + 1]) args.vintage = argv[++i];
  }
  return args;
}

/** CBO's long format: date,variable,value. */
async function readLongCsv(file) {
  const text = await readFile(file, 'utf8');
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const header = (lines.shift() ?? '').split(',');
  const dateAt = header.indexOf('date');
  const varAt = header.indexOf('variable');
  const valAt = header.indexOf('value');
  if (dateAt < 0 || varAt < 0 || valAt < 0) {
    throw new Error(`${file} is not in CBO's date,variable,value long format (header: ${header.join(',')})`);
  }

  const byVariable = new Map();
  for (const line of lines) {
    const cells = line.split(',');
    const variable = cells[varAt];
    const value = Number(cells[valAt]);
    if (!variable || !Number.isFinite(value)) continue;
    const series = byVariable.get(variable) ?? new Map();
    series.set(cells[dateAt], value);
    byVariable.set(variable, series);
  }
  return byVariable;
}

const fiscalYearOf = (label) => Number(String(label).replace(/^FY/, ''));

function pick(byVariable, name, { required = true } = {}) {
  const series = byVariable.get(name);
  if (!series && required) {
    throw new Error(
      `CBO data is missing the variable "${name}". Available names starting similarly: ` +
        [...byVariable.keys()].filter((k) => k.slice(0, 8) === name.slice(0, 8)).join(', '),
    );
  }
  return series ?? new Map();
}

/**
 * GDP is not published directly in these two datasets, but both publish a
 * dollar level and its share of GDP, so the denominator falls out exactly.
 * Deriving it here — rather than pulling a third dataset with its own vintage —
 * keeps every figure on a chart internally consistent.
 */
function impliedGdp(level, share) {
  return share === 0 ? Number.NaN : (level / share) * 100;
}

/**
 * The four alternative paths CBO scores alongside its baseline. Each is
 * published as two components — the change in the primary deficit and the
 * resulting debt-service effect — so applying one needs no interest model of
 * our own.
 *
 * These deltas use the OPPOSITE sign convention from `proj_deficit_total`:
 * verified against the feed, `scen_disc_baseline_primary_deficit` is exactly
 * the negative of `proj_primary_deficit`, so here a positive delta means a
 * LARGER deficit. Adding rather than subtracting one would move every scenario
 * the wrong way while still looking entirely plausible.
 */
const SCENARIOS = [
  {
    id: 'freeze',
    name: 'Freeze discretionary funding',
    summary:
      'Annual appropriations stay at their current dollar level instead of rising with inflation — a real-terms cut that grows each year.',
    primary: 'scen_disc_freeze_primary_deficit',
    debtService: 'scen_disc_freeze_debt_service',
  },
  {
    id: 'gdp-growth',
    name: 'Grow discretionary with the economy',
    summary:
      'Annual appropriations rise with GDP rather than with inflation, holding their share of the economy roughly constant.',
    primary: 'scen_disc_gdp_growth_primary_deficit',
    debtService: 'scen_disc_gdp_growth_debt_service',
  },
  {
    id: 'no-iija-bsca',
    name: 'End IIJA and BSCA funding',
    summary:
      'Supplemental funding from the infrastructure law and the Bipartisan Safer Communities Act is not continued past its scheduled end.',
    primary: 'scen_disc_no_iija_bsca_primary_deficit',
    debtService: 'scen_disc_no_iija_bsca_debt_service',
  },
  {
    id: 'emergency',
    name: 'Continue emergency funding',
    summary:
      'Recent emergency appropriations continue at their current level rather than expiring, and grow with inflation.',
    primary: 'scen_disc_emergency_primary_deficit',
    debtService: 'scen_disc_emergency_debt_service',
  },
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const budget = path.join(args.repo, 'data', 'budget');

  const projFile = path.join(budget, 'ten_year_budget', `annual_fy_${args.vintage}.csv`);
  const histFile = path.join(budget, 'historical_budget', `annual_fy_${args.vintage}.csv`);

  console.log(`Reading CBO vintage ${args.vintage} from ${args.repo}`);
  const proj = await readLongCsv(projFile);
  const hist = await readLongCsv(histFile);
  const projSchema = JSON.parse(
    await readFile(path.join(budget, 'ten_year_budget', 'schema.json'), 'utf8'),
  );
  const histSchema = JSON.parse(
    await readFile(path.join(budget, 'historical_budget', 'schema.json'), 'utf8'),
  );

  // ---- history: measured actuals -----------------------------------------
  const histDeficit = pick(hist, 'deficit_total');
  const histDebt = pick(hist, 'debt_held_by_public');
  const histDebtShare = pick(hist, 'debt_held_by_public_gdp_share');
  const histRevenues = pick(hist, 'revenues');
  const histOutlays = pick(hist, 'outlays');

  const years = [];
  for (const label of [...histDebt.keys()].sort()) {
    const debt = histDebt.get(label);
    const share = histDebtShare.get(label);
    if (debt === undefined || share === undefined) continue;
    years.push({
      fiscalYear: fiscalYearOf(label),
      basis: 'actual',
      deficit: histDeficit.get(label) ?? null,
      debtHeldByPublic: debt,
      debtGdpShare: share,
      revenues: histRevenues.get(label) ?? null,
      outlays: histOutlays.get(label) ?? null,
      gdp: impliedGdp(debt, share),
    });
  }

  // ---- projection: CBO's baseline ----------------------------------------
  const projDeficit = pick(proj, 'proj_deficit_total');
  const projDebt = pick(proj, 'proj_debt_held_by_public_end');
  const projDebtShare = pick(proj, 'proj_debt_held_by_public_gdp_share');
  const projRevenues = pick(proj, 'proj_rev_total');
  const projOutlays = pick(proj, 'proj_outlays_total');
  const otherFinancing = pick(proj, 'proj_debt_change_other_financing');

  const lastActual = years.length ? years[years.length - 1].fiscalYear : 0;

  for (const label of [...projDebt.keys()].sort()) {
    const fiscalYear = fiscalYearOf(label);
    // The first projection year overlaps the last actual year in some
    // vintages; the measured figure wins.
    if (fiscalYear <= lastActual) continue;
    const debt = projDebt.get(label);
    const share = projDebtShare.get(label);
    if (debt === undefined || share === undefined) continue;
    years.push({
      fiscalYear,
      basis: 'projected',
      deficit: projDeficit.get(label) ?? null,
      debtHeldByPublic: debt,
      debtGdpShare: share,
      revenues: projRevenues.get(label) ?? null,
      outlays: projOutlays.get(label) ?? null,
      gdp: impliedGdp(debt, share),
      otherFinancing: otherFinancing.get(label) ?? 0,
    });
  }

  const firstProjectedYear = years.find((y) => y.basis === 'projected')?.fiscalYear ?? null;

  // ---- scenarios ----------------------------------------------------------
  const scenarios = [];
  for (const spec of SCENARIOS) {
    const primary = pick(proj, spec.primary, { required: false });
    const debtService = pick(proj, spec.debtService, { required: false });
    if (primary.size === 0) {
      console.warn(`  skipping "${spec.id}" — ${spec.primary} not in this vintage`);
      continue;
    }
    const deltas = [...primary.keys()]
      .sort()
      .map((label) => ({
        fiscalYear: fiscalYearOf(label),
        primaryDeficit: primary.get(label) ?? 0,
        debtService: debtService.get(label) ?? 0,
      }))
      .filter((d) => firstProjectedYear === null || d.fiscalYear >= firstProjectedYear);

    scenarios.push({
      id: spec.id,
      name: spec.name,
      summary: spec.summary,
      sourceVariables: [spec.primary, spec.debtService],
      tenYearDeficitEffect: deltas.reduce((sum, d) => sum + d.primaryDeficit + d.debtService, 0),
      deltas,
    });
    console.log(`  scenario ${spec.id}: ${deltas.length} years`);
  }

  const payload = {
    vintage: args.vintage,
    generatedAt: new Date().toISOString(),
    firstProjectedYear,
    units: 'Billions of current dollars; shares in percent of GDP.',
    sources: {
      repository: 'https://github.com/US-CBO/cbo-data',
      license: 'Public domain, 17 U.S.C. § 105',
      projections: {
        title: projSchema.title,
        publicationId: projSchema.publication_id,
        url: projSchema.source_url,
      },
      history: {
        title: histSchema.title,
        publicationId: histSchema.publication_id,
        url: histSchema.source_url,
      },
    },
    years,
    scenarios,
  };

  await mkdir(OUT_DIR, { recursive: true });
  const target = path.join(OUT_DIR, `baseline-${args.vintage}.json`);
  await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const actuals = years.filter((y) => y.basis === 'actual').length;
  const projected = years.length - actuals;
  console.log(
    `\nWrote ${path.relative(process.cwd(), target)}\n` +
      `  ${actuals} actual years, ${projected} projected, first projected FY${firstProjectedYear}\n` +
      `  ${scenarios.length} scenarios`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
