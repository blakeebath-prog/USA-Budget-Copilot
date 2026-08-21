import { useMemo, useState, type ReactNode } from 'react';
import { Panel } from '../components/Panel';
import { DataTable } from '../components/DataTable';
import { BarChart } from '../components/charts/BarChart';
import { CompositionBar } from '../components/charts/CompositionBar';
import { FilterRow, FiscalYearPicker } from '../components/FiscalYearPicker';
import { useAsyncData } from '../hooks/useAsyncData';
import {
  fetchOutlaysByDepartment,
  fetchReceiptsBySource,
  type CategoryBreakdown,
} from '../lib/api/fiscalData';
import { compactUsd, fullUsd, percent } from '../lib/format';
import { currentFiscalYear, fiscalYearRange } from '../lib/fiscalYear';
import { SERIES_SLOTS, OTHER_COLOR, OTHER_LABEL } from '../components/charts/chartTheme';

const TOP_N = 12;
const COMPOSITION_N = 6;

/**
 * Where federal money comes from and where it goes, for one fiscal year.
 *
 * Both halves are Treasury cash figures, so they are directly comparable with
 * each other — which the agency and award views are not.
 */
export function MoneyFlowView(): ReactNode {
  const years = useMemo(() => fiscalYearRange(11, currentFiscalYear()), []);
  const [fiscalYear, setFiscalYear] = useState(currentFiscalYear());

  const receipts = useAsyncData((signal) => fetchReceiptsBySource(fiscalYear, signal), [fiscalYear]);
  const outlays = useAsyncData((signal) => fetchOutlaysByDepartment(fiscalYear, signal), [fiscalYear]);

  return (
    <>
      <p className="view__intro">
        Fiscal-year-to-date totals as of the most recent Monthly Treasury Statement in the selected year. Receipts
        are net of refunds and outlays are net of offsetting collections, which is why a category can go negative.
      </p>

      <FilterRow>
        <FiscalYearPicker
          value={fiscalYear}
          years={years}
          onChange={setFiscalYear}
          hint="The current year is partial until September."
        />
      </FilterRow>

      <div className="grid">
        <FlowPanel
          title="Where the money comes from"
          subtitle="Receipts by source, fiscal year to date."
          state={receipts}
          emptyMessage="Treasury has not published receipt detail for this year yet."
        />
        <FlowPanel
          title="Where the money goes"
          subtitle="Outlays by department, fiscal year to date."
          state={outlays}
          emptyMessage="Treasury has not published outlay detail for this year yet."
        />
      </div>
    </>
  );
}

interface FlowPanelProps {
  title: string;
  subtitle: string;
  state: {
    data: CategoryBreakdown | null;
    provenance: import('../lib/http').Provenance | null;
    loading: boolean;
    error: Error | null;
    reload: () => void;
  };
  emptyMessage: string;
}

function FlowPanel({ title, subtitle, state, emptyMessage }: FlowPanelProps): ReactNode {
  const rows = state.data?.categories ?? [];
  const publishedTotal = state.data?.publishedTotal ?? null;

  // Shares are taken against Treasury's own published total wherever it gives
  // one, not against the sum of the categories on screen. Those two differ
  // whenever a category is missed, and dividing by the on-screen sum would
  // hide exactly that — every share would still add to a tidy 100%.
  const categorySum = rows.reduce((sum, row) => sum + Math.max(0, row.amount), 0);
  const total = publishedTotal ?? categorySum;
  const coverage = publishedTotal && publishedTotal !== 0 ? categorySum / publishedTotal : null;
  const coverageIsOff = coverage !== null && Math.abs(coverage - 1) > 0.02;

  const bars = rows.slice(0, TOP_N).map((row) => ({
    key: row.label,
    label: row.label,
    value: row.amount,
    note: total > 0 ? `${percent(Math.abs(row.amount) / total)} of the year-to-date total` : undefined,
  }));

  // Part-to-whole caps at six named slices plus a folded tail, so the reader is
  // never asked to tell nine hues apart.
  const composition = (() => {
    const head = rows.slice(0, COMPOSITION_N);
    const tailTotal = rows.slice(COMPOSITION_N).reduce((sum, row) => sum + Math.max(0, row.amount), 0);
    const segments = head.map((row, index) => ({
      key: row.label,
      label: row.label,
      value: Math.max(0, row.amount),
      color: SERIES_SLOTS[index] ?? OTHER_COLOR,
    }));
    if (tailTotal > 0) {
      segments.push({ key: OTHER_LABEL, label: `${OTHER_LABEL} (${rows.length - COMPOSITION_N} categories)`, value: tailTotal, color: OTHER_COLOR });
    }
    return segments;
  })();

  return (
    <Panel
      title={title}
      subtitle={subtitle}
      provenance={state.provenance}
      loading={state.loading}
      error={state.error}
      onRetry={state.reload}
      legend={composition.map((segment) => ({
        key: segment.key,
        label: segment.label,
        color: segment.color,
        markType: 'rect' as const,
      }))}
      table={
        <DataTable
          rows={rows}
          rowKey={(row) => row.label}
          columns={[
            { key: 'label', header: 'Category', render: (row) => row.label },
            { key: 'amount', header: 'Fiscal year to date', align: 'right', render: (row) => fullUsd(row.amount) },
            {
              key: 'share',
              header: 'Share',
              align: 'right',
              render: (row) => (total > 0 ? percent(Math.abs(row.amount) / total) : '—'),
            },
          ]}
        />
      }
    >
      {rows.length ? (
        <>
          {coverageIsOff ? (
            <p className="panel__subtitle" role="note">
              <strong>These categories cover {percent(coverage ?? 0, 0)} of Treasury's published total</strong> of{' '}
              {compactUsd(publishedTotal ?? 0)}. The remainder is in lines this breakdown does not resolve, so read
              the shares below as approximate.
            </p>
          ) : null}
          <CompositionBar segments={composition} formatValue={compactUsd} />
          <BarChart bars={bars} formatValue={compactUsd} labelWidth={230} />
        </>
      ) : (
        <div className="empty">{state.loading ? 'Loading…' : emptyMessage}</div>
      )}
    </Panel>
  );
}
