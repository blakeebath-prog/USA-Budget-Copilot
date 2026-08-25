import raw from '../../data/cbo/baseline-2026-02.json';

/**
 * CBO's budget baseline, and the arithmetic for applying its scored scenarios.
 *
 * Everything here sits one rung up from the Treasury readers: these are
 * projections, not measurements. The distinction is carried in the data itself
 * — every year is marked `actual` or `projected` — so a chart can never render
 * the two identically by accident.
 */

export type Basis = 'actual' | 'projected';

export interface BaselineYear {
  fiscalYear: number;
  basis: Basis;
  /** Negative is a deficit, matching CBO's published convention. */
  deficit: number | null;
  debtHeldByPublic: number;
  debtGdpShare: number;
  revenues: number | null;
  outlays: number | null;
  gdp: number;
  /** Borrowing not explained by the deficit — student loan reestimates and the like. */
  otherFinancing?: number;
}

export interface ScenarioDelta {
  fiscalYear: number;
  primaryDeficit: number;
  debtService: number;
}

export interface Scenario {
  id: string;
  name: string;
  summary: string;
  sourceVariables: string[];
  /** Ten-year total, in CBO's scenario convention: positive means a larger deficit. */
  tenYearDeficitEffect: number;
  deltas: ScenarioDelta[];
}

export interface CboBaseline {
  vintage: string;
  generatedAt: string;
  firstProjectedYear: number;
  units: string;
  sources: {
    repository: string;
    license: string;
    projections: { title: string; publicationId: string; url: string };
    history: { title: string; publicationId: string; url: string };
  };
  years: BaselineYear[];
  scenarios: Scenario[];
}

export const baseline = raw as CboBaseline;

export interface OutlookYear {
  fiscalYear: number;
  basis: Basis;
  deficit: number | null;
  debtHeldByPublic: number;
  debtGdpShare: number;
  gdp: number;
  /** True once a selected scenario has moved this year off CBO's published path. */
  changed: boolean;
}

/**
 * Apply a set of CBO's scored scenarios to its own baseline.
 *
 * Three things make this defensible arithmetic rather than a model of our own:
 *
 *  1. CBO publishes each scenario's debt-service effect alongside its primary
 *     deficit effect, so the interest consequences are CBO's estimate and not
 *     an interest-rate assumption invented here.
 *  2. The scenario series use the OPPOSITE sign convention from the baseline —
 *     verified against the feed, `scen_disc_baseline_primary_deficit` is exactly
 *     the negative of `proj_primary_deficit` — so the deltas are subtracted.
 *     Adding them would move every scenario the wrong way while still looking
 *     entirely plausible.
 *  3. Debt is rolled forward with CBO's own identity, which reproduces its
 *     published debt path to the dollar when nothing is selected. That equality
 *     is asserted in the tests, so a change to this function that broke the
 *     reconciliation would fail rather than ship.
 *
 * What is assumed, and stated in the UI: GDP does not respond. These are
 * CBO's non-dynamic scenarios, so holding the denominator fixed is the
 * consistent treatment — but it does mean the debt-to-GDP path answers
 * "what if spending differed", not "what if the economy did".
 */
export function applyScenarios(
  source: CboBaseline = baseline,
  selectedIds: readonly string[] = [],
): OutlookYear[] {
  const selected = source.scenarios.filter((scenario) => selectedIds.includes(scenario.id));

  const deltaByYear = new Map<number, number>();
  for (const scenario of selected) {
    for (const delta of scenario.deltas) {
      const combined = delta.primaryDeficit + delta.debtService;
      deltaByYear.set(delta.fiscalYear, (deltaByYear.get(delta.fiscalYear) ?? 0) + combined);
    }
  }

  const result: OutlookYear[] = [];
  let previousDebt: number | null = null;

  for (const year of source.years) {
    if (year.basis === 'actual') {
      result.push({
        fiscalYear: year.fiscalYear,
        basis: 'actual',
        deficit: year.deficit,
        debtHeldByPublic: year.debtHeldByPublic,
        debtGdpShare: year.debtGdpShare,
        gdp: year.gdp,
        changed: false,
      });
      previousDebt = year.debtHeldByPublic;
      continue;
    }

    const delta = deltaByYear.get(year.fiscalYear) ?? 0;
    const deficit = year.deficit === null ? null : year.deficit - delta;

    // Roll debt forward on CBO's identity. With no scenario selected this
    // returns CBO's published figures unchanged.
    const debt: number =
      previousDebt === null || deficit === null
        ? year.debtHeldByPublic
        : previousDebt - deficit + (year.otherFinancing ?? 0);

    result.push({
      fiscalYear: year.fiscalYear,
      basis: 'projected',
      deficit,
      debtHeldByPublic: debt,
      debtGdpShare: year.gdp > 0 ? (debt / year.gdp) * 100 : year.debtGdpShare,
      gdp: year.gdp,
      changed: delta !== 0,
    });

    previousDebt = debt;
  }

  return result;
}

/**
 * The first projected year in which debt stops growing as a share of GDP.
 *
 * This is the constraint the tool is built around, and it is deliberately not
 * "balance the budget". A deficit can run indefinitely without the debt
 * outgrowing the economy; the ratio is what economists actually argue over, and
 * discovering that the two are different questions is most of the point.
 */
export function stabilizationYear(path: readonly OutlookYear[]): number | null {
  const projected = path.filter((year) => year.basis === 'projected');
  for (let index = 1; index < projected.length; index += 1) {
    const current = projected[index];
    const previous = projected[index - 1];
    if (!current || !previous) continue;
    if (current.debtGdpShare <= previous.debtGdpShare) return current.fiscalYear;
  }
  return null;
}

/** Debt as a share of GDP in the final projected year — the headline the constraint moves. */
export function terminalDebtShare(path: readonly OutlookYear[]): number | null {
  const projected = path.filter((year) => year.basis === 'projected');
  return projected[projected.length - 1]?.debtGdpShare ?? null;
}

/** Combined ten-year deficit effect of a selection, in the plain "less debt is negative" sense. */
export function tenYearEffect(
  source: CboBaseline = baseline,
  selectedIds: readonly string[] = [],
): number {
  return source.scenarios
    .filter((scenario) => selectedIds.includes(scenario.id))
    .reduce((sum, scenario) => sum + scenario.tenYearDeficitEffect, 0);
}
