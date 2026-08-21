import {
  debtRequest,
  fiscalDataPath,
  monthlyFlowsRequest,
  outlaysByDepartmentRequest,
  receiptsBySourceRequest,
  type FiscalDataQuery,
  type UpstreamRequest,
} from '../../../shared/requests.mjs';
import { request, type Fetched } from '../http';
import { fiscalYearOf } from '../fiscalYear';
import {
  readFirstFiniteNumber,
  readNumber,
  readString,
  SchemaMismatchError,
  toNumber,
  type Row,
} from './fieldResolution';

/**
 * Client for the Treasury Fiscal Data API.
 *
 *   base: https://api.fiscaldata.treasury.gov/services/api/fiscal_service
 *   auth: none — no key, no registration, no rate limit published
 *
 * This is the authoritative feed for what the government actually took in and
 * paid out. USAspending is the authoritative feed for where award money went.
 * The two answer different questions and their totals are not meant to match.
 */

interface FiscalDataEnvelope {
  data?: Row[];
  meta?: { count?: number; labels?: Record<string, string>; 'total-count'?: number; 'total-pages'?: number };
  error?: string;
  message?: string;
}

async function fetchRows(descriptor: UpstreamRequest, signal?: AbortSignal): Promise<Fetched<Row[]>> {
  const result = await request<FiscalDataEnvelope>({
    upstream: 'fiscaldata',
    sourceId: descriptor.sourceId,
    path: descriptor.path,
    signal,
  });
  const rows = result.data.data;
  if (!Array.isArray(rows)) {
    throw new Error(
      `Fiscal Data returned no data array for ${descriptor.path}${
        result.data.error || result.data.message ? `: ${result.data.error ?? result.data.message}` : ''
      }`,
    );
  }
  return { data: rows, provenance: result.provenance };
}

/** Re-exported so callers can build ad-hoc Fiscal Data queries against any dataset. */
export function buildQueryPath(query: FiscalDataQuery): string {
  return fiscalDataPath(query);
}

/* ------------------------------------------------------------------ *
 * Monthly Treasury Statement — Table 1: receipts, outlays, deficit
 * ------------------------------------------------------------------ */

const RECEIPTS_FIELDS = [
  'current_month_gross_rcpt_amt',
  'current_month_rcpt_amt',
  'current_month_budget_amt',
] as const;

const OUTLAYS_FIELDS = [
  'current_month_gross_outly_amt',
  'current_month_outly_amt',
  'current_month_budget_amt',
] as const;

const DEFICIT_FIELDS = ['current_month_dfct_sur_amt', 'current_month_budget_amt'] as const;

const FYTD_FIELDS = [
  'current_fytd_gross_rcpt_amt',
  'current_fytd_rcpt_amt',
  'current_fytd_gross_outly_amt',
  'current_fytd_outly_amt',
  'current_fytd_dfct_sur_amt',
  'current_fytd_budget_amt',
] as const;

export interface MonthlyFlow {
  /** Last day of the reported month, ISO. */
  recordDate: string;
  receipts: number;
  outlays: number;
  /** Positive = surplus, negative = deficit. Treasury's own sign convention. */
  surplusOrDeficit: number;
  fiscalYear: number;
}

const CALENDAR_MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

/**
 * Fold the punctuation variations Treasury uses into one comparable form.
 *
 * The same line appears as "Total Receipts", "Total--Receipts", and
 * "Total — Receipts" across these tables. Matching the exact string is how a
 * working chart becomes an empty one after a publication tweak that changed
 * nothing about the data.
 */
export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[\u2012-\u2015]/g, '-')
    .replace(/-+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[:.]$/, '')
    .trim();
}

/**
 * Fold MTS Table 1 into one row per month.
 *
 * Table 1 is not a list of labelled totals — each row is already a whole
 * period, carrying receipts, outlays, and the balance in three columns of the
 * same row. `classification_desc` names the period: a calendar month, or a
 * roll-up like "Year-to-Date" and "FY 2025". Keeping the row whose month
 * matches its own record date takes each statement's current month exactly
 * once and leaves the roll-ups alone, which would otherwise be summed on top
 * of the months they already contain.
 *
 * The balance is always derived as receipts minus outlays rather than read
 * from `current_month_dfct_sur_amt`. That column publishes the deficit as a
 * positive magnitude — October 2024 reports 257.45 against receipts of 326.77
 * and outlays of 584.22 — so taking its sign at face value renders every
 * deficit in the series as a surplus of the same size.
 */
export function foldMonthlyFlows(rows: Row[]): MonthlyFlow[] {
  const flows: MonthlyFlow[] = [];

  for (const row of rows) {
    const recordDate = readString(row, ['record_date'], 'MTS Table 1 record date');
    const label = normalizeLabel(readString(row, ['classification_desc'], 'MTS Table 1 classification'));

    const monthNumber = toNumber(row['record_calendar_month'] ?? recordDate.split('-')[1]);
    const expectedMonth = CALENDAR_MONTH_NAMES[monthNumber - 1];
    if (!expectedMonth || label !== expectedMonth) continue;

    const receipts = readFirstFiniteNumber(row, RECEIPTS_FIELDS, 'MTS Table 1 receipts');
    const outlays = readFirstFiniteNumber(row, OUTLAYS_FIELDS, 'MTS Table 1 outlays');
    if (!Number.isFinite(receipts) || !Number.isFinite(outlays)) continue;

    const fiscalYear = toNumber(row['record_fiscal_year']);

    flows.push({
      recordDate,
      receipts,
      outlays,
      surplusOrDeficit: receipts - outlays,
      fiscalYear: Number.isFinite(fiscalYear) ? fiscalYear : fiscalYearOf(recordDate),
    });
  }

  // Rows came back but no month matched its own record date: the feed changed
  // how it names periods. Returning an empty array would paint an empty chart
  // and call it a day, which is the one failure this app is not allowed to
  // have. Name the labels the feed actually used so the fix is mechanical.
  if (rows.length > 0 && flows.length === 0) {
    const labels = [...new Set(rows.map((row) => String(row['classification_desc'] ?? '')))];
    throw new SchemaMismatchError(
      `MTS Table 1 returned ${rows.length} rows, but none of them is a month matching its own record date. ` +
        `The period labels present are: ${labels.slice(0, 40).join(' | ')}`,
      [...CALENDAR_MONTH_NAMES],
      labels,
    );
  }

  // One statement republishes earlier months of the same fiscal year, so the
  // same month arrives under several record dates. Keep one row per month.
  const byMonth = new Map<string, MonthlyFlow>();
  for (const flow of flows) byMonth.set(flow.recordDate.slice(0, 7), flow);

  return [...byMonth.values()].sort((a, b) => a.recordDate.localeCompare(b.recordDate));
}

export async function fetchMonthlyFlows(
  startDate: string,
  signal?: AbortSignal,
): Promise<Fetched<MonthlyFlow[]>> {
  const result = await fetchRows(monthlyFlowsRequest(startDate), signal);
  return { data: foldMonthlyFlows(result.data), provenance: result.provenance };
}

/** Fiscal-year totals, summed from the monthly series. Only complete years are meaningful. */
export interface FiscalYearFlow {
  fiscalYear: number;
  receipts: number;
  outlays: number;
  surplusOrDeficit: number;
  monthsReported: number;
}

export function foldFiscalYears(flows: MonthlyFlow[]): FiscalYearFlow[] {
  const byYear = new Map<number, FiscalYearFlow>();
  for (const flow of flows) {
    if (!Number.isFinite(flow.fiscalYear)) continue;
    const entry = byYear.get(flow.fiscalYear) ?? {
      fiscalYear: flow.fiscalYear,
      receipts: 0,
      outlays: 0,
      surplusOrDeficit: 0,
      monthsReported: 0,
    };
    if (Number.isFinite(flow.receipts)) entry.receipts += flow.receipts;
    if (Number.isFinite(flow.outlays)) entry.outlays += flow.outlays;
    if (Number.isFinite(flow.surplusOrDeficit)) entry.surplusOrDeficit += flow.surplusOrDeficit;
    entry.monthsReported += 1;
    byYear.set(flow.fiscalYear, entry);
  }
  return [...byYear.values()].sort((a, b) => a.fiscalYear - b.fiscalYear);
}

/* ------------------------------------------------------------------ *
 * MTS Table 4 — receipts by source; Table 5 — outlays by department
 * ------------------------------------------------------------------ */

export interface CategoryAmount {
  label: string;
  /** Fiscal-year-to-date amount as of the record date. */
  amount: number;
  recordDate: string;
}

const FYTD_AMOUNT_FIELDS = [
  'current_fytd_net_rcpt_amt',
  'current_fytd_net_outly_amt',
  'current_fytd_rcpt_amt',
  'current_fytd_outly_amt',
  'current_fytd_gross_rcpt_amt',
  'current_fytd_gross_outly_amt',
  'current_fytd_budget_amt',
  'current_fytd_amt',
] as const;

/** Grand-total and budget-split rows, which are not categories to chart alongside their own parts. */
const GRAND_TOTAL_LABELS = new Set([
  'receipts',
  'outlays',
  'on budget',
  'off budget',
  'budget totals',
  'net budget receipts',
  'net budget outlays',
]);

interface CategoryNode {
  id: string;
  parentId: string;
  label: string;
  amount: number;
}

/** '' for a row Treasury places at the top of the table, otherwise its parent's id. */
function parentIdOf(row: Row): string {
  const parent = row['parent_id'];
  if (parent === undefined || parent === null) return '';
  const text = String(parent).trim();
  return text === '' || text === '0' || text.toLowerCase() === 'null' ? '' : text;
}

/** "Total -- Individual Income Taxes" and "Individual Income Taxes" compare equal. */
function subjectOf(label: string): string {
  return normalizeLabel(label).replace(/^total\s+/, '');
}

export interface CategoryBreakdown {
  categories: CategoryAmount[];
  /** The feed's own published grand total, when the table carries one. */
  publishedTotal: number | null;
  recordDate: string;
}

/**
 * Reduce one MTS detail table to its top-level categories for the latest month.
 *
 * These tables are a tree flattened into rows. A section such as "Individual
 * Income Taxes" is a header carrying no amounts; its components ("Withheld",
 * "Other") are child rows; and the section's actual figure lives in a
 * "Total -- Individual Income Taxes" row beneath it. So the chartable set is
 * neither the top-level rows (mostly empty headers) nor the flat list (which
 * mixes a department with its own constituent accounts, and buries the largest
 * categories under hundreds of line items).
 *
 * Each top-level row is therefore resolved to its own amount when it has one,
 * and otherwise to its matching "Total -- …" child. Grand totals and the
 * on/off-budget split are held back — charting them beside their own components
 * would double every percentage — but the grand total is returned separately so
 * a caller can check the parts against the published whole.
 */
export function foldCategories(rows: Row[], context: string): CategoryBreakdown {
  let latestDate = '';
  for (const row of rows) {
    const recordDate = readString(row, ['record_date'], `${context} record date`);
    if (recordDate > latestDate) latestDate = recordDate;
  }

  const nodes: CategoryNode[] = rows
    .filter((row) => readString(row, ['record_date'], `${context} record date`) === latestDate)
    .map((row) => ({
      id: String(row['classification_id'] ?? ''),
      parentId: parentIdOf(row),
      label: readString(row, ['classification_desc'], `${context} classification`).trim(),
      amount: readFirstFiniteNumber(row, FYTD_AMOUNT_FIELDS, `${context} amount`),
    }))
    .filter((node) => node.label !== '');

  const childrenOf = new Map<string, CategoryNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = childrenOf.get(node.parentId) ?? [];
    siblings.push(node);
    childrenOf.set(node.parentId, siblings);
  }

  const categories: CategoryAmount[] = [];
  let publishedTotal: number | null = null;

  for (const node of nodes) {
    if (node.parentId) continue;

    const subject = subjectOf(node.label);
    if (GRAND_TOTAL_LABELS.has(subject)) {
      if ((subject === 'receipts' || subject === 'outlays') && Number.isFinite(node.amount)) {
        publishedTotal = node.amount;
      }
      continue;
    }

    let amount = node.amount;
    if (!Number.isFinite(amount)) {
      const children = childrenOf.get(node.id) ?? [];
      const totals = children.filter(
        (child) => normalizeLabel(child.label).startsWith('total') && Number.isFinite(child.amount),
      );
      const named = totals.find((child) => subjectOf(child.label) === subject);
      amount = named?.amount ?? totals[0]?.amount ?? Number.NaN;
    }

    if (Number.isFinite(amount)) {
      categories.push({ label: node.label.replace(/:$/, '').trim(), amount, recordDate: latestDate });
    }
  }

  // No hierarchy in this feed, or none of it resolved: fall back to every row
  // that carries a figure, rather than showing an empty panel.
  if (categories.length === 0) {
    for (const node of nodes) {
      if (!Number.isFinite(node.amount)) continue;
      if (GRAND_TOTAL_LABELS.has(subjectOf(node.label))) continue;
      categories.push({ label: node.label.replace(/:$/, '').trim(), amount: node.amount, recordDate: latestDate });
    }
  }

  if (rows.length > 0 && categories.length === 0) {
    const labels = [...new Set(rows.map((row) => String(row['classification_desc'] ?? '')))];
    throw new SchemaMismatchError(
      `${context} returned ${rows.length} rows but none resolved to a chartable category. ` +
        `The classification labels present are: ${labels.slice(0, 40).join(' | ')}`,
      ['classification_desc', 'parent_id', 'classification_id'],
      labels,
    );
  }

  categories.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  return { categories, publishedTotal, recordDate: latestDate };
}

export async function fetchReceiptsBySource(
  fiscalYear: number,
  signal?: AbortSignal,
): Promise<Fetched<CategoryBreakdown>> {
  const result = await fetchRows(receiptsBySourceRequest(fiscalYear), signal);
  return { data: foldCategories(result.data, 'MTS Table 4'), provenance: result.provenance };
}

export async function fetchOutlaysByDepartment(
  fiscalYear: number,
  signal?: AbortSignal,
): Promise<Fetched<CategoryBreakdown>> {
  const result = await fetchRows(outlaysByDepartmentRequest(fiscalYear), signal);
  return { data: foldCategories(result.data, 'MTS Table 5'), provenance: result.provenance };
}

/* ------------------------------------------------------------------ *
 * Debt to the Penny
 * ------------------------------------------------------------------ */

export interface DebtPoint {
  recordDate: string;
  heldByPublic: number;
  intragovernmental: number;
  total: number;
}

export function foldDebt(rows: Row[]): DebtPoint[] {
  return rows
    .map((row) => ({
      recordDate: readString(row, ['record_date'], 'Debt to the Penny record date'),
      heldByPublic: readNumber(row, ['debt_held_public_amt'], 'Debt held by the public'),
      intragovernmental: readNumber(row, ['intragov_hold_amt'], 'Intragovernmental holdings'),
      total: readNumber(row, ['tot_pub_debt_out_amt'], 'Total public debt outstanding'),
    }))
    .sort((a, b) => a.recordDate.localeCompare(b.recordDate));
}

export async function fetchDebt(startDate: string, signal?: AbortSignal): Promise<Fetched<DebtPoint[]>> {
  const result = await fetchRows(debtRequest(startDate), signal);
  return { data: foldDebt(result.data), provenance: result.provenance };
}

export const FISCAL_DATA_FIELD_CANDIDATES = {
  receipts: RECEIPTS_FIELDS,
  outlays: OUTLAYS_FIELDS,
  deficit: DEFICIT_FIELDS,
  fytd: FYTD_FIELDS,
  categoryAmount: FYTD_AMOUNT_FIELDS,
} as const;
