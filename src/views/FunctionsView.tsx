import { useMemo, useState, type ReactNode } from 'react';
import { Panel } from '../components/Panel';
import { DataTable } from '../components/DataTable';
import { BarChart } from '../components/charts/BarChart';
import { CompositionBar } from '../components/charts/CompositionBar';
import { FilterRow, FiscalYearPicker, SelectField } from '../components/FiscalYearPicker';
import { useAsyncData } from '../hooks/useAsyncData';
import { fetchSpendingExplorer } from '../lib/api/usaspending';
import { compactUsd, fullUsd, percent } from '../lib/format';
import { fiscalYearRange, latestCompleteFiscalYear } from '../lib/fiscalYear';
import { OTHER_COLOR, OTHER_LABEL, SERIES_SLOTS } from '../components/charts/chartTheme';

const QUARTERS = [
  { value: '4', label: 'Through Q4 (full year)' },
  { value: '3', label: 'Through Q3' },
  { value: '2', label: 'Through Q2' },
  { value: '1', label: 'Through Q1' },
] as const;

const COMPOSITION_N = 6;

/**
 * Budget function — what the money is FOR, rather than who spends it.
 *
 * This is the only cross-agency view of purpose in the federal data: national
 * defense, health, income security, net interest. One agency spans many
 * functions and one function spans many agencies, so this answers a question
 * the agency view structurally cannot.
 */
export function FunctionsView(): ReactNode {
  const years = useMemo(() => fiscalYearRange(9, latestCompleteFiscalYear() + 1), []);
  const [fiscalYear, setFiscalYear] = useState(latestCompleteFiscalYear());
  const [quarter, setQuarter] = useState<(typeof QUARTERS)[number]['value']>('4');
  const [drilldown, setDrilldown] = useState<{ code: string; name: string } | null>(null);

  const functions = useAsyncData(
    (signal) =>
      fetchSpendingExplorer({ type: 'budget_function', fiscalYear, quarter: Number(quarter) }, signal),
    [fiscalYear, quarter],
  );

  const subfunctions = useAsyncData(
    (signal) =>
      drilldown
        ? fetchSpendingExplorer(
            {
              type: 'budget_subfunction',
              fiscalYear,
              quarter: Number(quarter),
              budgetFunction: drilldown.code,
            },
            signal,
          )
        : Promise.resolve({
            data: { total: 0, endDate: null, nodes: [] },
            provenance: {
              sourceId: 'usaspending-budget-function',
              url: 'https://api.usaspending.gov/api/v2/spending/',
              method: 'POST' as const,
              retrievedAt: new Date().toISOString(),
              origin: 'memory-cache' as const,
            },
          }),
    [drilldown?.code ?? '', fiscalYear, quarter],
  );

  const nodes = functions.data?.nodes ?? [];
  const total = functions.data?.total ?? 0;

  const composition = (() => {
    const head = nodes.slice(0, COMPOSITION_N);
    const tailTotal = nodes.slice(COMPOSITION_N).reduce((sum, node) => sum + Math.max(0, node.amount), 0);
    const segments = head.map((node, index) => ({
      key: node.name,
      label: node.name,
      value: Math.max(0, node.amount),
      color: SERIES_SLOTS[index] ?? OTHER_COLOR,
    }));
    if (tailTotal > 0) {
      segments.push({
        key: OTHER_LABEL,
        label: `${OTHER_LABEL} (${nodes.length - COMPOSITION_N} functions)`,
        value: tailTotal,
        color: OTHER_COLOR,
      });
    }
    return segments;
  })();

  return (
    <>
      <p className="view__intro">
        Obligations grouped by budget function for the selected fiscal year. These are obligations reported through
        USAspending, not enacted appropriations and not cash outlays — the Overview holds the cash figures. Select a
        function to break it into subfunctions.
      </p>

      <FilterRow>
        <FiscalYearPicker value={fiscalYear} years={years} onChange={setFiscalYear} />
        <SelectField
          label="Period"
          value={quarter}
          options={QUARTERS.map((entry) => ({ value: entry.value, label: entry.label }))}
          onChange={setQuarter}
        />
        {drilldown ? (
          <button type="button" className="button" onClick={() => setDrilldown(null)}>
            Clear “{drilldown.name}”
          </button>
        ) : null}
      </FilterRow>

      <div className="grid">
        <Panel
          wide
          title="Obligations by budget function"
          subtitle={
            functions.data?.endDate
              ? `Reported through ${functions.data.endDate}. Select a bar to break it down.`
              : 'Select a bar to break it down.'
          }
          provenance={functions.provenance}
          loading={functions.loading}
          error={functions.error}
          onRetry={functions.reload}
          legend={composition.map((segment) => ({
            key: segment.key,
            label: segment.label,
            color: segment.color,
            markType: 'rect' as const,
          }))}
          table={
            <DataTable
              rows={nodes}
              rowKey={(row) => row.name}
              columns={[
                { key: 'name', header: 'Budget function', render: (row) => row.name },
                { key: 'code', header: 'Code', render: (row) => row.code ?? '—' },
                { key: 'amount', header: 'Obligations', align: 'right', render: (row) => fullUsd(row.amount) },
                {
                  key: 'share',
                  header: 'Share',
                  align: 'right',
                  render: (row) => (total > 0 ? percent(Math.max(0, row.amount) / total) : '—'),
                },
              ]}
            />
          }
        >
          {nodes.length ? (
            <>
              <CompositionBar segments={composition} formatValue={compactUsd} />
              <BarChart
                bars={nodes.map((node) => ({
                  key: node.code ?? node.name,
                  label: node.name,
                  value: node.amount,
                  note: total > 0 ? `${percent(Math.max(0, node.amount) / total)} of all obligations` : undefined,
                }))}
                formatValue={compactUsd}
                labelWidth={250}
                onSelect={(bar) =>
                  setDrilldown(
                    drilldown?.code === bar.key ? null : { code: bar.key, name: bar.label },
                  )
                }
                selectedKey={drilldown?.code ?? null}
              />
            </>
          ) : (
            <div className="empty">
              {functions.loading
                ? 'Loading budget functions…'
                : 'No obligations reported for this year and period yet. Agency submissions land a quarter behind.'}
            </div>
          )}
        </Panel>

        {drilldown ? (
          <Panel
            wide
            title={`${drilldown.name}: subfunctions`}
            subtitle="The same obligations, one level deeper."
            provenance={subfunctions.provenance}
            loading={subfunctions.loading}
            error={subfunctions.error}
            onRetry={subfunctions.reload}
            table={
              <DataTable
                rows={subfunctions.data?.nodes ?? []}
                rowKey={(row) => row.name}
                columns={[
                  { key: 'name', header: 'Subfunction', render: (row) => row.name },
                  { key: 'amount', header: 'Obligations', align: 'right', render: (row) => fullUsd(row.amount) },
                ]}
              />
            }
          >
            {subfunctions.data?.nodes.length ? (
              <BarChart
                bars={subfunctions.data.nodes.map((node) => ({
                  key: node.code ?? node.name,
                  label: node.name,
                  value: node.amount,
                }))}
                formatValue={compactUsd}
                labelWidth={250}
              />
            ) : (
              <div className="empty">
                {subfunctions.loading ? 'Loading subfunctions…' : 'No subfunction detail reported.'}
              </div>
            )}
          </Panel>
        ) : null}
      </div>
    </>
  );
}
