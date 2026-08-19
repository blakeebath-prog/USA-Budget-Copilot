import { type ReactNode } from 'react';
import { Panel } from '../components/Panel';
import { StatTile } from '../components/StatTile';
import { DataTable } from '../components/DataTable';
import { LineChart } from '../components/charts/LineChart';
import { useAsyncData } from '../hooks/useAsyncData';
import { fetchDebt } from '../lib/api/fiscalData';
import { compactUsd, dayLabel, deltaDirection, fullUsd, monthLabel, signedPercent } from '../lib/format';

const START = '2010-01-01';

/**
 * Debt outstanding, updated every business day.
 *
 * The two components are kept separate rather than stacked into one headline,
 * because they mean different things: intragovernmental holdings are money the
 * government owes its own trust funds, and debt held by the public is what it
 * owes everyone else.
 */
export function DebtView(): ReactNode {
  const debt = useAsyncData((signal) => fetchDebt(START, signal), [START]);
  const series = debt.data ?? [];

  // The feed is daily; a decade of business days is more marks than pixels, so
  // the chart plots month-ends and the table keeps every published day.
  const monthEnds = series.filter((point, index) => {
    const next = series[index + 1];
    return !next || next.recordDate.slice(0, 7) !== point.recordDate.slice(0, 7);
  });

  const latest = series[series.length - 1] ?? null;
  const yearAgo = series.find((point) => latest && point.recordDate >= shiftYear(latest.recordDate, -1)) ?? null;

  const points = monthEnds.map((point) => ({
    x: point.recordDate,
    label: monthLabel(point.recordDate),
    values: { public: point.heldByPublic, intragov: point.intragovernmental },
  }));

  return (
    <>
      <p className="view__intro">
        Total public debt outstanding, published every federal business day. Debt is a stock measured at a moment;
        the deficit on the Overview is a flow over a period. They move together but they are not the same quantity.
      </p>

      <div className="statrow">
        <StatTile
          hero
          label={latest ? `Total debt outstanding, ${dayLabel(latest.recordDate)}` : 'Total debt outstanding'}
          value={latest ? compactUsd(latest.total) : '—'}
          delta={
            latest && yearAgo && yearAgo.total > 0
              ? {
                  text: `${signedPercent((latest.total - yearAgo.total) / yearAgo.total)} over the past year`,
                  direction: deltaDirection((latest.total - yearAgo.total) / yearAgo.total),
                  upIsGood: false,
                }
              : undefined
          }
        />
        <StatTile
          label="Held by the public"
          value={latest ? compactUsd(latest.heldByPublic) : '—'}
          footnote="Owed to investors: households, funds, banks, foreign governments, and the Federal Reserve."
        />
        <StatTile
          label="Intragovernmental holdings"
          value={latest ? compactUsd(latest.intragovernmental) : '—'}
          footnote="Owed by the government to its own trust funds, chiefly Social Security and Medicare."
        />
      </div>

      <div className="grid">
        <Panel
          wide
          title="Debt outstanding by component"
          subtitle="Month-end values since 2010. The table view carries every published business day."
          provenance={debt.provenance}
          loading={debt.loading}
          error={debt.error}
          onRetry={debt.reload}
          legend={[
            { key: 'public', label: 'Held by the public', color: 'var(--series-1)', markType: 'line' },
            { key: 'intragov', label: 'Intragovernmental holdings', color: 'var(--series-2)', markType: 'line' },
          ]}
          table={
            <DataTable
              rows={[...series].reverse().slice(0, 400)}
              rowKey={(row) => row.recordDate}
              columns={[
                { key: 'date', header: 'Date', render: (row) => dayLabel(row.recordDate) },
                { key: 'public', header: 'Held by the public', align: 'right', render: (row) => fullUsd(row.heldByPublic) },
                {
                  key: 'intragov',
                  header: 'Intragovernmental',
                  align: 'right',
                  render: (row) => fullUsd(row.intragovernmental),
                },
                { key: 'total', header: 'Total', align: 'right', render: (row) => fullUsd(row.total) },
              ]}
              caption="Most recent 400 published business days."
            />
          }
        >
          {points.length ? (
            <LineChart
              points={points}
              series={[
                { key: 'public', label: 'Held by the public', color: 'var(--series-1)' },
                { key: 'intragov', label: 'Intragovernmental holdings', color: 'var(--series-2)' },
              ]}
              formatValue={compactUsd}
              height={320}
            />
          ) : (
            <div className="empty">{debt.loading ? 'Loading debt history…' : 'No debt records returned.'}</div>
          )}
        </Panel>
      </div>
    </>
  );
}

function shiftYear(isoDate: string, years: number): string {
  const [year, rest] = [isoDate.slice(0, 4), isoDate.slice(4)];
  return `${Number(year) + years}${rest}`;
}
