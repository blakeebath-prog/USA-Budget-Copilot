/**
 * The registry of primary sources this tool draws on.
 *
 * Every number rendered anywhere in the app traces back to one of these entries
 * via `SourceNote`. Nothing is modelled, estimated, or interpolated by this app;
 * if a figure is not in one of these feeds, it is not shown.
 */
export type Upstream = 'usaspending' | 'fiscaldata';

export interface SourceDefinition {
  id: string;
  upstream: Upstream;
  /** Human-facing name of the specific dataset, not the publisher. */
  name: string;
  publisher: string;
  /** Landing page a reader can open to check the numbers themselves. */
  homepage: string;
  /** What this feed is authoritative for. */
  covers: string;
  updateCadence: string;
  /** Anything that would make a reader misread the numbers. */
  caveats: string[];
}

export const SOURCES: Record<string, SourceDefinition> = {
  'mts-summary': {
    id: 'mts-summary',
    upstream: 'fiscaldata',
    name: 'Monthly Treasury Statement, Table 1 — Summary of Receipts, Outlays, and the Deficit/Surplus',
    publisher: 'U.S. Department of the Treasury, Bureau of the Fiscal Service',
    homepage: 'https://fiscaldata.treasury.gov/datasets/monthly-treasury-statement/',
    covers: 'Actual federal receipts, outlays, and the resulting deficit or surplus, monthly and fiscal-year-to-date.',
    updateCadence: 'Monthly, roughly the 8th business day after month end.',
    caveats: [
      'Cash basis, not accrual: timing shifts when a payment date falls on a weekend or holiday move outlays between months.',
      'Fiscal years run October 1 – September 30, so FY-to-date figures are not calendar-year figures.',
      'The most recent month is preliminary and is routinely revised in the following statement.',
    ],
  },
  'mts-receipts': {
    id: 'mts-receipts',
    upstream: 'fiscaldata',
    name: 'Monthly Treasury Statement, Table 4 — Receipts by Source',
    publisher: 'U.S. Department of the Treasury, Bureau of the Fiscal Service',
    homepage: 'https://fiscaldata.treasury.gov/datasets/monthly-treasury-statement/',
    covers: 'Where federal money comes from: individual income taxes, payroll taxes, corporate taxes, customs, excise, and other receipts.',
    updateCadence: 'Monthly.',
    caveats: [
      'Receipts are net of refunds, so a heavy refund month can push a category negative.',
      'Payroll taxes appear as employment/social insurance receipts, split across several lines.',
    ],
  },
  'mts-outlays': {
    id: 'mts-outlays',
    upstream: 'fiscaldata',
    name: 'Monthly Treasury Statement, Table 5 — Outlays by Department',
    publisher: 'U.S. Department of the Treasury, Bureau of the Fiscal Service',
    homepage: 'https://fiscaldata.treasury.gov/datasets/monthly-treasury-statement/',
    covers: 'Actual money out the door, by federal department and major agency.',
    updateCadence: 'Monthly.',
    caveats: [
      'Outlays are net of offsetting collections, so agencies with large fee income can show small or negative net outlays.',
      'Department totals here are cash outlays and will not equal the budget authority an agency was appropriated.',
    ],
  },
  'debt-to-penny': {
    id: 'debt-to-penny',
    upstream: 'fiscaldata',
    name: 'Debt to the Penny',
    publisher: 'U.S. Department of the Treasury, Bureau of the Fiscal Service',
    homepage: 'https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/',
    covers: 'Total public debt outstanding, split into debt held by the public and intragovernmental holdings.',
    updateCadence: 'Every federal business day.',
    caveats: [
      'Debt held by the public is the measure most economists use; the headline total also counts money the government owes itself (mostly trust funds).',
      'Debt is a stock at a point in time; the deficit is a flow over a period. They do not move in lockstep.',
    ],
  },
  'usaspending-agencies': {
    id: 'usaspending-agencies',
    upstream: 'usaspending',
    name: 'Agency budgetary resources and obligations',
    publisher: 'U.S. Department of the Treasury, Bureau of the Fiscal Service (USAspending.gov)',
    homepage: 'https://api.usaspending.gov/api/v2/references/toptier_agencies/',
    covers: 'Per-agency total budgetary resources, obligations, and outlays as reported in agency financial submissions.',
    updateCadence: 'Quarterly submissions, with monthly updates for most agencies.',
    caveats: [
      'Budgetary resources include unobligated balances carried in from prior years, so they exceed the current-year appropriation.',
      'Obligations are commitments to spend, not cash paid; obligations lead outlays, often by years.',
      'Agency reporting lags: the newest fiscal quarter is incomplete until every agency submits.',
    ],
  },
  'usaspending-budget-function': {
    id: 'usaspending-budget-function',
    upstream: 'usaspending',
    name: 'Spending Explorer — budget function and subfunction',
    publisher: 'USAspending.gov',
    homepage: 'https://api.usaspending.gov/api/v2/spending/',
    covers: 'Obligations grouped by what the money is for (national defense, health, income security, net interest, and so on) rather than who spends it.',
    updateCadence: 'Quarterly, following agency submission deadlines.',
    caveats: [
      'Budget function is the standard cross-agency view of purpose; one agency can span many functions.',
      'Figures are obligations for the selected fiscal year, not enacted appropriations and not outlays.',
    ],
  },
  'usaspending-awards': {
    id: 'usaspending-awards',
    upstream: 'usaspending',
    name: 'Award search — spending by category and over time',
    publisher: 'USAspending.gov',
    homepage: 'https://api.usaspending.gov/api/v2/search/spending_by_category/',
    covers: 'Contract, grant, loan, and direct-payment awards, aggregated by recipient, state, agency, or industry.',
    updateCadence: 'Daily for contracts; twice monthly for financial assistance.',
    caveats: [
      'Awards are only part of federal spending. Most mandatory spending — Social Security, Medicare benefits, interest on the debt — is not an award and never appears here.',
      'Amounts are obligations on award transactions, so modifications and de-obligations move historical totals.',
      'Recipient names are self-reported and a single parent company can appear under several names.',
    ],
  },
};

export function getSource(id: string): SourceDefinition {
  const source = SOURCES[id];
  if (!source) throw new Error(`Unknown source id: ${id}`);
  return source;
}
