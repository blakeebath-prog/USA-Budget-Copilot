import { useMemo, useState, type ReactNode } from 'react';
import { Panel } from '../components/Panel';
import { StatTile } from '../components/StatTile';
import { DataTable } from '../components/DataTable';
import { LineChart } from '../components/charts/LineChart';
import {
  applyScenarios,
  baseline,
  stabilizationYear,
  tenYearEffect,
  terminalDebtShare,
} from '../lib/cbo/baseline';
import { compactUsd, fullUsd } from '../lib/format';

/**
 * The ten-year outlook, and what CBO's own alternative paths do to it.
 *
 * This is the app's first view built on projections rather than measurements,
 * so it carries the whole measured/modeled distinction on its face: history is
 * drawn solid, projection dashed, the boundary marked, and every figure traced
 * to the CBO vintage it came from.
 *
 * The question it is organised around is deliberately not "balance the budget".
 * It is whether debt stops outgrowing the economy — the thing that actually
 * determines whether a debt load is sustainable, and a target a reader can
 * reach without eliminating the deficit.
 */

const HISTORY_FROM = 1990;

export function OutlookView(): ReactNode {
  const [selected, setSelected] = useState<string[]>([]);
  const [horizon, setHorizon] = useState<number>(HISTORY_FROM);

  const basePath = useMemo(() => applyScenarios(baseline, []), []);
  const yourPath = useMemo(() => applyScenarios(baseline, selected), [selected]);

  const todayShare = useMemo(() => {
    const lastActual = [...basePath].reverse().find((year) => year.basis === 'actual');
    return lastActual?.debtGdpShare ?? null;
  }, [basePath]);

  const lastActualYear = useMemo(
    () => [...basePath].reverse().find((year) => year.basis === 'actual')?.fiscalYear ?? null,
    [basePath],
  );

  const baseTerminal = terminalDebtShare(basePath);
  const yourTerminal = terminalDebtShare(yourPath);
  const finalYear = basePath[basePath.length - 1]?.fiscalYear ?? null;
  const effect = tenYearEffect(baseline, selected);
  const stabilizes = stabilizationYear(yourPath);

  const visible = useMemo(
    () => basePath.filter((year) => year.fiscalYear >= horizon),
    [basePath, horizon],
  );

  const points = useMemo(() => {
    const yourByYear = new Map(yourPath.map((year) => [year.fiscalYear, year]));
    return visible.map((year) => {
      const values: Record<string, number> = { baseline: year.debtGdpShare };
      // The counterfactual line exists only over the projection. Drawing it
      // across the measured years too would paint history in the colour of a
      // choice the reader just made — implying the past moved.
      if (selected.length && year.basis === 'projected') {
        values['yours'] = yourByYear.get(year.fiscalYear)?.debtGdpShare ?? Number.NaN;
      }
      return { x: String(year.fiscalYear), label: `FY${year.fiscalYear}`, values };
    });
  }, [visible, yourPath, selected.length]);

  const series = selected.length
    ? [
        { key: 'baseline', label: 'CBO baseline', color: 'var(--series-1)' },
        { key: 'yours', label: 'With your choices', color: 'var(--series-2)' },
      ]
    : [{ key: 'baseline', label: 'CBO baseline', color: 'var(--series-1)' }];

  const toggle = (id: string) =>
    setSelected((previous) =>
      previous.includes(id) ? previous.filter((entry) => entry !== id) : [...previous, id],
    );

  const projectedFrom = String(baseline.firstProjectedYear);

  return (
    <>
      <div className="banner">
        <strong>Everything below the dashed line is a projection, not a measurement.</strong> History comes from
        CBO's record of past budgets; the forecast is CBO's {baseline.vintage} baseline, which assumes current law
        stays in place. The alternatives are CBO's own scored scenarios — this app applies them, it does not
        estimate them.
      </div>

      <div className="statrow">
        <StatTile
          hero
          label={
            finalYear
              ? `Debt held by the public in FY${finalYear}, as a share of the economy`
              : 'Debt as a share of the economy'
          }
          value={yourTerminal === null ? '—' : `${yourTerminal.toFixed(0)}%`}
          delta={
            selected.length && baseTerminal !== null && yourTerminal !== null
              ? {
                  text: `${(yourTerminal - baseTerminal).toFixed(1)} points vs the baseline`,
                  direction: yourTerminal > baseTerminal ? 'up' : yourTerminal < baseTerminal ? 'down' : 'flat',
                  upIsGood: false,
                }
              : undefined
          }
          footnote={
            todayShare !== null && lastActualYear !== null
              ? `It was ${todayShare.toFixed(0)}% in FY${lastActualYear}, the last completed year.`
              : undefined
          }
        />
        <StatTile
          label="Does the debt stop outgrowing the economy?"
          value={stabilizes ? `Yes, by FY${stabilizes}` : 'Not within the window'}
          footnote={
            stabilizes
              ? 'The ratio stops rising in that year — the deficit need not reach zero for that to happen.'
              : 'The ratio rises in every projected year. Closing it takes more than discretionary spending.'
          }
        />
        <StatTile
          label="Ten-year effect of your choices"
          value={
            selected.length === 0
              ? 'Nothing selected'
              : `${compactUsd(Math.abs(effect) * 1e9)} ${effect < 0 ? 'less' : 'more'}`
          }
          footnote={
            selected.length === 0
              ? 'Select a scenario below to change the path.'
              : effect < 0
                ? 'Less borrowing over ten years than the baseline.'
                : 'More borrowing over ten years than the baseline.'
          }
        />
      </div>

      <div className="filters">
        <div className="field">
          <span className="field__label">Show history from</span>
          <div className="panel__views" role="group" aria-label="History range">
            {[1962, 1990, 2010].map((year) => (
              <button
                key={year}
                type="button"
                className={horizon === year ? 'toggle is-active' : 'toggle'}
                aria-pressed={horizon === year}
                onClick={() => setHorizon(year)}
              >
                {year}
              </button>
            ))}
          </div>
        </div>
        {selected.length ? (
          <button type="button" className="button" onClick={() => setSelected([])}>
            Clear {selected.length} {selected.length === 1 ? 'choice' : 'choices'}
          </button>
        ) : null}
      </div>

      <div className="grid">
        <Panel
          wide
          title="Debt held by the public, as a share of GDP"
          subtitle={`Solid to FY${baseline.firstProjectedYear - 1} is what happened. Dashed after it is CBO's projection under current law.`}
          legend={series.map((entry) => ({
            key: entry.key,
            label: entry.label,
            color: entry.color,
            markType: 'line' as const,
          }))}
          table={
            <DataTable
              rows={visible.filter((year) => year.fiscalYear >= (lastActualYear ?? 0) - 5)}
              rowKey={(row) => String(row.fiscalYear)}
              columns={[
                { key: 'fy', header: 'Fiscal year', render: (row) => `FY${row.fiscalYear}` },
                {
                  key: 'basis',
                  header: 'Basis',
                  render: (row) => (row.basis === 'actual' ? 'Actual' : 'Projected'),
                },
                {
                  key: 'share',
                  header: 'Baseline debt / GDP',
                  align: 'right',
                  render: (row) => `${row.debtGdpShare.toFixed(1)}%`,
                },
                {
                  key: 'yours',
                  header: 'With your choices',
                  align: 'right',
                  render: (row) => {
                    const match = yourPath.find((year) => year.fiscalYear === row.fiscalYear);
                    return match ? `${match.debtGdpShare.toFixed(1)}%` : '—';
                  },
                },
                {
                  key: 'deficit',
                  header: 'Deficit',
                  align: 'right',
                  render: (row) => (row.deficit === null ? '—' : fullUsd(row.deficit * 1e9)),
                },
              ]}
              caption="Recent actual years and the full projection window."
            />
          }
        >
          {points.length ? (
            <LineChart
              points={points}
              series={series}
              formatValue={(value) => `${value.toFixed(1)}%`}
              formatTick={(value) => `${value.toFixed(0)}%`}
              height={340}
              projectedFrom={projectedFrom}
              {...(todayShare !== null && lastActualYear !== null
                ? { referenceLine: { value: todayShare, label: `FY${lastActualYear} level` } }
                : {})}
            />
          ) : (
            <div className="empty">No years in this range.</div>
          )}
        </Panel>

        <Panel
          wide
          title="CBO's alternative paths"
          subtitle="Four ways discretionary funding could differ from the baseline, each scored by CBO — including the interest cost or saving. Toggle any combination."
        >
          <div className="scenariolist">
            {baseline.scenarios.map((scenario) => {
              const active = selected.includes(scenario.id);
              const reducesDeficit = scenario.tenYearDeficitEffect < 0;
              return (
                <button
                  key={scenario.id}
                  type="button"
                  className={active ? 'scenario is-active' : 'scenario'}
                  aria-pressed={active}
                  onClick={() => toggle(scenario.id)}
                >
                  <span className="scenario__head">
                    <span className="scenario__name">{scenario.name}</span>
                    <span
                      className={
                        reducesDeficit ? 'scenario__effect is-down' : 'scenario__effect is-up'
                      }
                    >
                      {compactUsd(Math.abs(scenario.tenYearDeficitEffect) * 1e9)}
                      <span className="scenario__effectlabel">
                        {reducesDeficit ? ' less borrowing' : ' more borrowing'}
                      </span>
                    </span>
                  </span>
                  <span className="scenario__summary">{scenario.summary}</span>
                  <span className="scenario__source">
                    CBO series{' '}
                    {scenario.sourceVariables.map((name, index) => (
                      <span key={name}>
                        {index > 0 ? ', ' : ''}
                        <code>{name}</code>
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel wide title="What this does and does not account for">
          <div className="assumptions">
            <p>
              <strong>The scenarios are CBO's, including their interest effects.</strong> Each one is published
              with both a change in the primary deficit and the resulting debt-service cost or saving, so nothing
              here depends on an interest-rate assumption of this app's own.
            </p>
            <p>
              <strong>The economy does not respond.</strong> These are non-dynamic scenarios: GDP is held at CBO's
              baseline projection whichever options you pick. So the ratio answers "what if spending differed",
              not "what if the economy did". Analysts disagree, sometimes sharply, about how much that second
              question would change the answer.
            </p>
            <p>
              <strong>Only discretionary spending is on the table here.</strong> That is roughly a quarter of
              federal spending. If the ratio will not stabilise no matter what you select, that is not a flaw in
              the tool — it is the finding.
            </p>
            <p>
              <strong>The baseline assumes current law.</strong> It is not a forecast of what Congress will do;
              it is what happens if nothing changes, which is the standard against which changes are measured.
            </p>
          </div>
        </Panel>
      </div>

      <p className="view__intro" style={{ marginTop: 18 }}>
        Source: {baseline.sources.projections.title} (CBO publication {baseline.sources.projections.publicationId})
        and {baseline.sources.history.title}, vintage {baseline.vintage}, via{' '}
        <a href={baseline.sources.repository} target="_blank" rel="noreferrer noopener">
          CBO's open data repository
        </a>
        . {baseline.sources.license}. {baseline.units}
      </p>
    </>
  );
}
