#!/usr/bin/env node
/**
 * Extract CBO's budget options catalogue from the workbook that reproduces
 * the tables in "Options for Reducing the Deficit: 2025 to 2034" (publication
 * 60557, December 2024).
 *
 *   npm run ingest:options -- --file /path/to/60557budgetoptions.xlsx
 *
 * The workbook reproduces a printed report rather than exposing a tidy table,
 * so this reads it structurally: find each "Option N" block, read that block's
 * OWN year header, then pull the rows beneath it. Four things about the file
 * make a naive read produce wrong numbers that still look plausible:
 *
 *  1. The Discretionary sheet's year columns are NOT in order — it runs
 *     2029, 2031, 2030, 2032. Assuming sequence swaps two years' values.
 *     Every block's header is therefore parsed for itself.
 *  2. The sheets have different column counts, so fixed offsets do not
 *     transfer between them.
 *  3. Discretionary options publish both budget authority and outlays. Only
 *     outlays hit the deficit; budget authority is larger and would overstate
 *     the effect (option 28: -1,118 against -959).
 *  4. Many options carry several alternatives, sometimes with a combined total
 *     that is deliberately not their sum because the alternatives interact.
 *
 * Every extracted line is checked against the workbook's own published
 * ten-year total before it is emitted. A line whose annual figures do not sum
 * to the printed total is dropped and reported, never shipped.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, '..', 'src', 'data', 'cbo');

const CATEGORY_BY_SHEET = {
  Mandatory: 'mandatory',
  Discretionary: 'discretionary',
  Revenues: 'revenue',
};

/** Rounded to a tenth of a billion, ten of them, so allow a little slack. */
const TOTAL_TOLERANCE = 0.6;

function parseArgs(argv) {
  const args = { file: null };
  for (let i = 0; i < argv.length; i += 1) {
    if ((argv[i] === '--file' || argv[i] === '-f') && argv[i + 1]) args.file = argv[++i];
  }
  return args;
}

/** '*' means "rounds to zero", not "missing". Footnote letters are not values. */
function toNumber(cell) {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  if (typeof cell !== 'string') return null;
  const text = cell.trim();
  if (text === '') return null;
  if (text === '*' || text === '**') return 0;
  const parsed = Number(text.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

const asText = (cell) => (cell === null || cell === undefined ? '' : String(cell).trim());

/**
 * Map a block's year header to column indices, reading the labels rather than
 * assuming they ascend — see trap 1 above.
 */
function readYearHeader(row) {
  const years = new Map();
  let totalColumn = null;
  let fiveYearColumn = null;

  row.forEach((cell, index) => {
    const text = asText(cell).replace(/[‒-―]/g, '-');
    if (/^\d{4}$/.test(text)) {
      years.set(Number(text), index);
      return;
    }
    const span = text.match(/^(\d{4})-(\d{4})$/);
    if (!span) return;
    const width = Number(span[2]) - Number(span[1]);
    if (width >= 8) totalColumn = index;
    else if (width >= 3) fiveYearColumn = index;
  });

  return years.size >= 8 && totalColumn !== null ? { years, totalColumn, fiveYearColumn } : null;
}

/**
 * Strip a footnote marker, conservatively.
 *
 * CBO appends footnote letters directly to a label, so "Change in outlays"
 * with footnote a arrives as "Change in outlaysa". Stripping any trailing
 * lowercase letter would eat the real last character of every other label —
 * turning "Outlays" into "Outlay" and "Total" into "Tota". Requiring an "s"
 * before the marker matches the plural nouns CBO actually footnotes here and
 * leaves ordinary labels alone. The raw text is kept either way.
 */
function withoutFootnote(label) {
  return /s[a-f]$/.test(label) ? label.slice(0, -1) : label;
}

/**
 * Which quantity a line reports — and therefore which way its sign runs.
 *
 * CBO states the rule in the workbook's own notes: "negative numbers for
 * outlays and positive numbers for revenues reduce the deficit". So a line is
 * not interpretable from its number alone, and the category is not enough
 * either: revenue options carry a mix of revenue lines, deficit lines, and
 * mandatory-outlay lines, each running a different direction. Classifying by
 * the label is what keeps a tax increase from being rendered as a tax cut.
 */
function classifyMeasure(label, section) {
  const own = label.toLowerCase();
  const text = `${section} ${label}`.toLowerCase();
  if (/budget authority/.test(own)) return 'budget-authority';
  // "deficit" wins over "revenue": a line reading "Decrease (-) in the deficit
  // from changes in mandatory spending and revenues" is already a deficit
  // figure, and flipping it for the word "revenues" would invert it.
  if (/deficit/.test(own)) return 'deficit';
  if (/revenue/.test(own)) return 'revenues';
  if (/deficit/.test(text)) return 'deficit';
  if (/outlay|spending/.test(text)) return 'outlays';
  return 'other';
}

/**
 * Convert a reported figure into a deficit effect, negative meaning the
 * deficit falls. Revenues are the one series that flips.
 */
const DEFICIT_SIGN = {
  deficit: 1,
  outlays: 1,
  revenues: -1,
  'budget-authority': 1,
  other: 1,
};

/** Text that introduces a section rather than carrying data. */
const SECTION_HEADING = /^(change in|decrease|increase|effect on|net (change|effect))/i;
const NOISE = /^(back to table of contents|data source|this option would|note[s]?:|memorandum)/i;

/**
 * Discretionary options publish budget authority and outlays. Outlays are what
 * reach the deficit; budget authority is the appropriation behind them.
 */
function extractSheet(sheet, category, rows) {
  const options = [];
  let current = null;
  let header = null;
  let pendingSection = '';

  const flush = () => {
    if (current && current.lines.length) options.push(current);
    current = null;
    header = null;
    pendingSection = '';
  };

  for (const row of rows) {
    const cells = row.map(asText);
    const joined = cells.join(' ').trim();
    if (joined === '') continue;

    const optionMatch = cells[0]?.match(/^Option (\d+)$/);
    if (optionMatch) {
      flush();
      current = {
        number: Number(optionMatch[1]),
        category,
        sheet,
        title: '',
        budgetFunction: null,
        lines: [],
      };
      continue;
    }

    if (!current) continue;

    if (current.title === '') {
      current.title = cells[0] ?? '';
      const fn = cells.find((cell) => /^Function\s+\d+/i.test(cell));
      if (fn) current.budgetFunction = fn.replace(/^Function\s+/i, '').trim();
      continue;
    }

    const maybeHeader = readYearHeader(row);
    if (maybeHeader) {
      header = maybeHeader;
      continue;
    }

    if (!header) continue;
    if (NOISE.test(cells[0] ?? '') || NOISE.test(joined)) continue;

    const values = [];
    for (const [year, column] of header.years) {
      const value = toNumber(row[column]);
      if (value !== null) values.push([year, value]);
    }
    const publishedTotal = toNumber(row[header.totalColumn]);

    // A row with no figures is a section heading; remember it to qualify the
    // lines beneath, since "Outlays" alone is meaningless out of context.
    if (values.length === 0 || publishedTotal === null) {
      const label = cells.find((cell) => cell !== '') ?? '';
      if (label && SECTION_HEADING.test(label)) pendingSection = withoutFootnote(label).trim();
      continue;
    }

    const label = cells.slice(0, header.years.size ? Math.min(...header.years.values()) : 3).find(
      (cell) => cell !== '' && !/^\d{4}$/.test(cell),
    );
    const rawLabel = (label ?? '').trim();
    const displayLabel = withoutFootnote(rawLabel);
    const measure = classifyMeasure(displayLabel, pendingSection);
    const sign = DEFICIT_SIGN[measure] ?? 1;

    values.sort((a, b) => a[0] - b[0]);
    const summed = values.reduce((sum, [, value]) => sum + value, 0);

    current.lines.push({
      label: displayLabel,
      rawLabel,
      section: pendingSection,
      measure,
      /** +1 where the reported figure is already a deficit effect, -1 for revenues. */
      deficitSign: sign,
      deficitByYear: Object.fromEntries(values.map(([year, value]) => [year, value * sign])),
      deficitTenYearTotal: Number((publishedTotal * sign).toFixed(3)),
      // Budget authority is the appropriation behind the outlays, not a second
      // saving — selecting it alongside outlays would double count.
      affectsDeficit: measure === 'deficit' || measure === 'outlays' || measure === 'revenues',
      byYear: Object.fromEntries(values),
      publishedTenYearTotal: publishedTotal,
      summedTenYearTotal: Number(summed.toFixed(3)),
      reconciles: Math.abs(summed - publishedTotal) <= TOTAL_TOLERANCE,
    });
  }

  flush();
  return options;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error('Usage: npm run ingest:options -- --file <60557budgetoptions.xlsx>');
    process.exitCode = 1;
    return;
  }

  let openpyxlLike;
  try {
    openpyxlLike = require('xlsx');
  } catch {
    console.error('This script needs the "xlsx" package: npm install --no-save xlsx');
    process.exitCode = 1;
    return;
  }

  const workbook = openpyxlLike.readFile(args.file);
  const catalogue = [];
  const rejected = [];

  for (const [sheetName, category] of Object.entries(CATEGORY_BY_SHEET)) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      console.warn(`  sheet "${sheetName}" not found — skipping`);
      continue;
    }
    const rows = openpyxlLike.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
    const options = extractSheet(sheetName, category, rows);
    console.log(`  ${sheetName}: ${options.length} options`);

    for (const option of options) {
      const good = option.lines.filter((line) => line.reconciles);
      const bad = option.lines.filter((line) => !line.reconciles);
      for (const line of bad) {
        rejected.push({
          option: option.number,
          title: option.title,
          label: line.label,
          published: line.publishedTenYearTotal,
          summed: line.summedTenYearTotal,
        });
      }
      if (good.length) catalogue.push({ ...option, lines: good });
    }
  }

  catalogue.sort((a, b) => a.number - b.number);

  const payload = {
    generatedAt: new Date().toISOString(),
    source: {
      title: 'Options for Reducing the Deficit: 2025 to 2034',
      publicationId: '60557',
      url: 'https://www.cbo.gov/publication/60557',
      published: '2024-12',
      license: 'Public domain, 17 U.S.C. § 105',
    },
    conventions: {
      units: 'Billions of current dollars.',
      sign: 'deficitTenYearTotal and deficitByYear are normalised so negative always means the deficit falls. CBO reports revenues the other way round — positive revenue reduces the deficit — so those lines carry deficitSign -1 against their published figures.',
      window: 'Scored over fiscal years 2025 through 2034.',
      excludes:
        'Debt-service effects are not included in these tables, so combining options understates the interest saved.',
    },
    optionCount: catalogue.length,
    lineCount: catalogue.reduce((sum, option) => sum + option.lines.length, 0),
    options: catalogue,
  };

  await mkdir(OUT_DIR, { recursive: true });
  const target = path.join(OUT_DIR, 'options-60557.json');
  await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(`\nWrote ${path.relative(process.cwd(), target)}`);
  console.log(`  ${payload.optionCount} options, ${payload.lineCount} scored lines`);
  if (rejected.length) {
    console.log(`\n  ${rejected.length} line(s) dropped — annual figures did not sum to the printed total:`);
    for (const entry of rejected.slice(0, 25)) {
      console.log(
        `    Option ${entry.option} "${entry.label}": printed ${entry.published}, summed ${entry.summed}`,
      );
    }
    if (rejected.length > 25) console.log(`    …and ${rejected.length - 25} more`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
