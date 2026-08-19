import { useMemo, type ReactNode } from 'react';
import { Panel } from '../components/Panel';
import { StatTile } from '../components/StatTile';
import { DataTable } from '../components/DataTable';
import { LineChart } from '../components/charts/LineChart';
import { ColumnChart } from '../components/charts/ColumnChart';
import { useAsyncData } from '../hooks/useAsyncData';
import { fetchDebt, fetchMonthlyFlows, foldFiscalYears } from '../lib/api/fiscalData';
import { compactUsd, deltaDirection, fullUsd, monthLabel, signedPercent } from '../lib/format';
import { currentFiscalYear, fiscalMonthName } from '../lib/fiscalYear';
import { summariseFiscalYearToDate } from '../lib/fiscalSummary';

const HISTORY_START = '2015-10-01';

/**
 * The headline view: what the government took in, what it paid out, and the gap.
 *
 * Everything here is Treasury's Monthly Treasury Statement — actual cash, not
 * appropriations and not award data. That distinction is the single most common
 * way federal budget charts mislead, so the view says so on its face.
 */
export function OverviewView(): ReactNode {
  const flows = useAsyncData((signal) => fetchMonthlyFlows(HISTORY_START, signal), [HISTORY_START]);
  const debt = useAsyncData((signal) => fetchDebt(HISTORY_START, signal), [HISTORY_START]);

  const monthly = flows.data ?? [];
  const years = useMemo(() => foldFiscalYears(monthly), [monthly]);

  const latestMonth = monthly[monthly.length - 1] ?? null;
  const activeFy = latestMonth ? latestMonth.fiscalYear : currentFiscalYear();

  const ytd = useMemo(() => summariseFiscalYearToDate(monthly, activeFy), [monthly, activeFy]);
  const priorYtd = useMemo(
    () => summariseFiscalYearToDate(monthly, activeFy - 1, ytd?.monthsReported),
    [monthly, activeFy, ytd?.monthsReported],
  );

  const completeYears = years.filter((year) => year.monthsReported === 12);
  const latestDebt = debt.data?.[debt.data.length - 1] ?? null;

  const monthlyPoints = monthly.map((flow) => ({
    x: flow.recordDate,
    label: monthLabel(flow.recordDate),
    values: { receipts: flow.receipts, outlays: flow.outlays },
  }));

  const deficitColumns = completeYears.map((year) => ({
    key: String(year.fiscalYear),
    label: `FY${String(year.fiscalYear).slice(2)}`,
    value: year.surplusOrDeficit,
    note:
      year.surplusOrDeficit < 0
        ? `Receipts ${compactUsd(year.receipts)} · outlays ${compactUsd(year.outlays)}`
        : 'A surplus year',
  }));

  const changeVsPrior = (current: number | undefined, prior: number | undefined): number =>
    current === undefined || prior === undefined || prior === 0 ? Number.NaN : (current - prior) / Math.abs(prior);

  return (
    <>
      <p className="view__intro">
        These are actual cash receipts and outlays reported by the U.S. Treasury, not enacted appropriations and
        not award data. A fiscal year runs October 1 through September 30 and is named for the year it ends in.
      </p>

      <div className="statrow">
        <StatTile
          hero
          label={ytd ? `FY${activeFy} deficit through ${fiscalMonthName(ytd.monthsReported)}` : 'Fiscal year to date'}
          value={ytd ? compactUsd(Math.abs(ytd.surplusOrDeficit)) : '—'}
          delta={
            ytd && priorYtd && Number.isFinite(changeVsPrior(ytd.surplusOrDeficit, priorYtd.surplusOrDeficit))
              ? {
                  text: `${signedPercent(
                    changeVsPrior(Math.abs(ytd.surplusOrDeficit), Math.abs(priorYtd.surplusOrDeficit)),
                  )} vs the same point in FY${activeFy - 1}`,
                  direction: deltaDirection(
                    changeVsPrior(Math.abs(ytd.surplusOrDeficit), Math.abs(priorYtd.surplusOrDeficit)),
                  ),
                  upIsGood: false,
                }
              : undefined
          }
          footnote={
            ytd
              ? `${ytd.monthsReported} of 12 months reported. ${
                  ytd.surplusOrDeficit < 0 ? 'Spending exceeds receipts.' : 'Receipts exceed spending.'
                }`
              : undefined
          }
        />
        <StatTile
          label={`FY${activeFy} receipts to date`}
          value={ytd ? compactUsd(ytd.receipts) : '—'}
          trend={completeYears.slice(-12).map((year) => year.receipts)}
        />
        <StatTile
          label={`FY${activeFy} outlays to date`}
          value={ytd ? compactUsd(ytd.outlays) : '—'}
          trend={completeYears.slice(-12).map((year) => year.outlays)}
        />
        <StatTile
          label="Total public debt outstanding"
          value={latestDebt ? compactUsd(latestDebt.total) : '—'}
          footnote={
            latestDebt
              ? `${compactUsd(latestDebt.heldByPublic)} held by the public, ${compactUsd(
                  latestDebt.intragovernmental,
                )} owed to government trust funds.`
              : undefined
          }
        />
      </div>

      <div className="grid">
        <Panel
          wide
          title="Receipts and outlays, month by month"
          subtitle="Monthly cash flows since FY2016. The sawtooth is real: April is a receipts spike from filing season, and outlays jump when a payment date shifts across a weekend."
          provenance={flows.provenance}
          loading={flows.loading}
          error={flows.error}
          onRetry={flows.reload}
          legend={[
            { key: 'receipts', label: 'Receipts', color: 'var(--series-1)', markType: 'line' },
            { key: 'outlays', label: 'Outlays', color: 'var(--series-2)', markType: 'line' },
          ]}
          table={
            <DataTable
              rows={[...monthly].reverse()}
              rowKey={(row) => row.recordDate}
              columns={[
                { key: 'month', header: 'Month', render: (row) => monthLabel(row.recordDate) },
                { key: 'receipts', header: 'Receipts', align: 'right', render: (row) => fullUsd(row.receipts) },
                { key: 'outlays', header: 'Outlays', align: 'right', render: (row) => fullUsd(row.outlays) },
                {
                  key: 'deficit',
                  header: 'Surplus / deficit',
                  align: 'right',
                  render: (row) => fullUsd(row.surplusOrDeficit),
                },
              ]}
            />
          }
        >
          {monthlyPoints.length ? (
            <LineChart
              points={monthlyPoints}
              series={[
                { key: 'receipts', label: 'Receipts', color: 'var(--series-1)' },
                { key: 'outlays', label: 'Outlays', color: 'var(--series-2)' },
              ]}
              formatValue={compactUsd}
              height={320}
            />
          ) : (
            <div className="empty">No monthly figures returned for this range.</div>
          )}
        </Panel>

        <Panel
          wide
          title="Surplus or deficit by fiscal year"
          subtitle="Complete fiscal years only. Bars below the line are deficits; a bar above the line is a surplus, which last happened in FY2001."
          provenance={flows.provenance}
          loading={flows.loading}
          error={flows.error}
          onRetry={flows.reload}
          table={
            <DataTable
              rows={[...completeYears].reverse()}
              rowKey={(row) => String(row.fiscalYear)}
              columns={[
                { key: 'fy', header: 'Fiscal year', render: (row) => `FY${row.fiscalYear}` },
                { key: 'receipts', header: 'Receipts', align: 'right', render: (row) => fullUsd(row.receipts) },
                { key: 'outlays', header: 'Outlays', align: 'right', render: (row) => fullUsd(row.outlays) },
                {
                  key: 'balance',
                  header: 'Surplus / deficit',
                  align: 'right',
                  render: (row) => fullUsd(row.surplusOrDeficit),
                },
              ]}
            />
          }
        >
          {deficitColumns.length ? (
            <ColumnChart columns={deficitColumns} formatValue={compactUsd} height={300} diverging />
          ) : (
            <div className="empty">No complete fiscal years in the loaded range yet.</div>
          )}
        </Panel>
      </div>
    </>
  );
}
