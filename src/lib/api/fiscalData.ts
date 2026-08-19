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
import { readNumber, readString, toNumber, type Row } from './fieldResolution';

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

const RECEIPT_ROW_LABELS = ['total receipts', 'total -- receipts'];
const OUTLAY_ROW_LABELS = ['total outlays', 'total -- outlays'];
const DEFICIT_ROW_LABELS = [
  'total surplus (+) or deficit (-)',
  'surplus (+) or deficit (-)',
  'total -- surplus (+) or deficit (-)',
];

function classify(label: string): 'receipts' | 'outlays' | 'deficit' | null {
  const normalized = label.trim().toLowerCase();
  if (RECEIPT_ROW_LABELS.includes(normalized)) return 'receipts';
  if (OUTLAY_ROW_LABELS.includes(normalized)) return 'outlays';
  if (DEFICIT_ROW_LABELS.includes(normalized)) return 'deficit';
  return null;
}

/**
 * Fold MTS Table 1 into one row per month.
 *
 * The table arrives long — one row per classification line per month — and the
 * three lines this app needs are the summary totals. Exported for tests.
 */
export function foldMonthlyFlows(rows: Row[]): MonthlyFlow[] {
  const byDate = new Map<string, MonthlyFlow>();

  for (const row of rows) {
    const label = readString(row, ['classification_desc'], 'MTS Table 1 classification');
    const kind = classify(label);
    if (!kind) continue;

    const recordDate = readString(row, ['record_date'], 'MTS Table 1 record date');
    const fiscalYear = toNumber(row['record_fiscal_year']);
    const existing = byDate.get(recordDate) ?? {
      recordDate,
      receipts: Number.NaN,
      outlays: Number.NaN,
      surplusOrDeficit: Number.NaN,
      fiscalYear: Number.isFinite(fiscalYear) ? fiscalYear : Number.NaN,
    };

    if (kind === 'receipts') existing.receipts = readNumber(row, RECEIPTS_FIELDS, 'MTS Table 1 receipts');
    if (kind === 'outlays') existing.outlays = readNumber(row, OUTLAYS_FIELDS, 'MTS Table 1 outlays');
    if (kind === 'deficit') existing.surplusOrDeficit = readNumber(row, DEFICIT_FIELDS, 'MTS Table 1 deficit');

    byDate.set(recordDate, existing);
  }

  // Treasury reports the deficit line already signed. Where it is missing but
  // both flows are present, derive it rather than dropping the month.
  for (const flow of byDate.values()) {
    if (!Number.isFinite(flow.surplusOrDeficit) && Number.isFinite(flow.receipts) && Number.isFinite(flow.outlays)) {
      flow.surplusOrDeficit = flow.receipts - flow.outlays;
    }
  }

  return [...byDate.values()].sort((a, b) => a.recordDate.localeCompare(b.recordDate));
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

/** Rows Treasury includes as roll-ups; charting them alongside their children double-counts. */
const TOTAL_ROW_PATTERN = /^total\b|^total$|^net budget|^subtotal/i;

export function foldCategories(rows: Row[], context: string): CategoryAmount[] {
  const byLabel = new Map<string, CategoryAmount>();
  let latestDate = '';

  for (const row of rows) {
    const recordDate = readString(row, ['record_date'], `${context} record date`);
    if (recordDate > latestDate) latestDate = recordDate;
  }

  for (const row of rows) {
    const recordDate = readString(row, ['record_date'], `${context} record date`);
    if (recordDate !== latestDate) continue;

    const label = readString(row, ['classification_desc'], `${context} classification`).trim();
    if (!label || TOTAL_ROW_PATTERN.test(label)) continue;

    const amount = readNumber(row, FYTD_AMOUNT_FIELDS, `${context} amount`);
    if (!Number.isFinite(amount)) continue;

    // Treasury repeats some labels across parent/child lines; keep the largest,
    // which is the parent, and let the detail live in the source table.
    const existing = byLabel.get(label);
    if (!existing || Math.abs(amount) > Math.abs(existing.amount)) {
      byLabel.set(label, { label, amount, recordDate });
    }
  }

  return [...byLabel.values()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

export async function fetchReceiptsBySource(
  fiscalYear: number,
  signal?: AbortSignal,
): Promise<Fetched<CategoryAmount[]>> {
  const result = await fetchRows(receiptsBySourceRequest(fiscalYear), signal);
  return { data: foldCategories(result.data, 'MTS Table 4'), provenance: result.provenance };
}

export async function fetchOutlaysByDepartment(
  fiscalYear: number,
  signal?: AbortSignal,
): Promise<Fetched<CategoryAmount[]>> {
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
