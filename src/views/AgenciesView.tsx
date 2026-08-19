import { useMemo, useState, type ReactNode } from 'react';
import { Panel } from '../components/Panel';
import { DataTable } from '../components/DataTable';
import { BarChart } from '../components/charts/BarChart';
import { LineChart } from '../components/charts/LineChart';
import { FilterRow, SelectField } from '../components/FiscalYearPicker';
import { useAsyncData } from '../hooks/useAsyncData';
import { fetchAgencyBudgetaryResources, fetchToptierAgencies } from '../lib/api/usaspending';
import { compactUsd, fullUsd, percent } from '../lib/format';

type Measure = 'budgetAuthority' | 'obligated' | 'outlay';

const MEASURES: { value: Measure; label: string; explanation: string }[] = [
  {
    value: 'budgetAuthority',
    label: 'Budgetary resources',
    explanation:
      'Everything an agency is legally allowed to obligate this year, including balances carried in from prior years. It is larger than the year’s appropriation.',
  },
  {
    value: 'obligated',
    label: 'Obligations',
    explanation:
      'Money the agency has legally committed — a signed contract or an awarded grant. Obligations lead cash out the door, sometimes by years.',
  },
  {
    value: 'outlay',
    label: 'Outlays',
    explanation: 'Cash actually paid out. This is the measure that lines up with the Treasury statement.',
  },
];

const TOP_N = 15;

/**
 * Agencies, ranked by whichever measure the reader picks.
 *
 * The measure switch is the point of this view: the same agency looks very
 * different under budgetary resources, obligations, and outlays, and treating
 * them as interchangeable is the most common mistake in agency-level charts.
 */
export function AgenciesView(): ReactNode {
  const [measure, setMeasure] = useState<Measure>('budgetAuthority');
  const [selected, setSelected] = useState<string | null>(null);

  const agencies = useAsyncData((signal) => fetchToptierAgencies(signal), []);
  const rows = agencies.data ?? [];

  const selectedAgency = rows.find((agency) => agency.toptierCode === selected) ?? null;

  const history = useAsyncData(
    (signal) =>
      selectedAgency
        ? fetchAgencyBudgetaryResources(selectedAgency.toptierCode, signal)
        : Promise.resolve({
            data: [],
            provenance: {
              sourceId: 'usaspending-agencies',
              url: 'https://api.usaspending.gov/api/v2/agency/{code}/budgetary_resources/',
              method: 'GET' as const,
              retrievedAt: new Date().toISOString(),
              origin: 'memory-cache' as const,
            },
          }),
    [selectedAgency?.toptierCode ?? ''],
  );

  const ranked = useMemo(
    () => [...rows].sort((a, b) => b[measure] - a[measure]).slice(0, TOP_N),
    [rows, measure],
  );

  const total = rows.reduce((sum, agency) => sum + Math.max(0, agency[measure]), 0);
  const activeMeasure = MEASURES.find((entry) => entry.value === measure);
  const reportingFy = rows[0]?.activeFy ?? '';

  const historyPoints = (history.data ?? []).map((year) => ({
    x: String(year.fiscalYear),
    label: `FY${String(year.fiscalYear).slice(2)}`,
    values: { resources: year.budgetaryResources, obligated: year.obligated },
  }));

  return (
    <>
      <p className="view__intro">
        Agency-level figures come from the financial data agencies submit to USAspending, not from the Treasury
        statement. They will not add up to the Treasury totals on the Overview: these are budgetary resources and
        obligations, reported on a different basis and a different schedule.
      </p>

      <FilterRow>
        <SelectField
          label="Measure"
          value={measure}
          options={MEASURES.map((entry) => ({ value: entry.value, label: entry.label }))}
          onChange={setMeasure}
        />
        <p className="field__label" style={{ maxWidth: '58ch' }}>
          {activeMeasure?.explanation}
        </p>
      </FilterRow>

      <div className="grid">
        <Panel
          wide
          title={`Top agencies by ${activeMeasure?.label.toLowerCase() ?? 'measure'}`}
          subtitle={
            reportingFy
              ? `Most recent agency submissions, reporting fiscal year ${reportingFy}. Select an agency to see its history.`
              : 'Most recent agency submissions. Select an agency to see its history.'
          }
          provenance={agencies.provenance}
          loading={agencies.loading}
          error={agencies.error}
          onRetry={agencies.reload}
          table={
            <DataTable
              rows={[...rows].sort((a, b) => b[measure] - a[measure])}
              rowKey={(row) => row.toptierCode}
              columns={[
                { key: 'name', header: 'Agency', render: (row) => row.name },
                { key: 'abbr', header: 'Code', render: (row) => row.abbreviation || row.toptierCode },
                {
                  key: 'ba',
                  header: 'Budgetary resources',
                  align: 'right',
                  render: (row) => fullUsd(row.budgetAuthority),
                },
                { key: 'obl', header: 'Obligations', align: 'right', render: (row) => fullUsd(row.obligated) },
                { key: 'out', header: 'Outlays', align: 'right', render: (row) => fullUsd(row.outlay) },
              ]}
            />
          }
        >
          {ranked.length ? (
            <BarChart
              bars={ranked.map((agency) => ({
                key: agency.toptierCode,
                label: agency.name,
                value: agency[measure],
                note:
                  total > 0
                    ? `${percent(Math.max(0, agency[measure]) / total)} of the government-wide total`
                    : undefined,
              }))}
              formatValue={compactUsd}
              labelWidth={260}
              onSelect={(bar) => setSelected(bar.key)}
              selectedKey={selected}
            />
          ) : (
            <div className="empty">{agencies.loading ? 'Loading agencies…' : 'No agencies returned.'}</div>
          )}
        </Panel>

        {selectedAgency ? (
          <Panel
            wide
            title={`${selectedAgency.name} over time`}
            subtitle="Budgetary resources against obligations, by fiscal year. A widening gap means resources were available but not committed."
            provenance={history.provenance}
            loading={history.loading}
            error={history.error}
            onRetry={history.reload}
            legend={[
              { key: 'resources', label: 'Budgetary resources', color: 'var(--series-1)', markType: 'line' },
              { key: 'obligated', label: 'Obligations', color: 'var(--series-2)', markType: 'line' },
            ]}
            table={
              <DataTable
                rows={history.data ?? []}
                rowKey={(row) => String(row.fiscalYear)}
                columns={[
                  { key: 'fy', header: 'Fiscal year', render: (row) => `FY${row.fiscalYear}` },
                  {
                    key: 'res',
                    header: 'Budgetary resources',
                    align: 'right',
                    render: (row) => fullUsd(row.budgetaryResources),
                  },
                  { key: 'obl', header: 'Obligations', align: 'right', render: (row) => fullUsd(row.obligated) },
                ]}
              />
            }
          >
            {historyPoints.length ? (
              <LineChart
                points={historyPoints}
                series={[
                  { key: 'resources', label: 'Budgetary resources', color: 'var(--series-1)' },
                  { key: 'obligated', label: 'Obligations', color: 'var(--series-2)' },
                ]}
                formatValue={compactUsd}
                height={260}
              />
            ) : (
              <div className="empty">
                {history.loading ? 'Loading history…' : 'No year-by-year history reported for this agency.'}
              </div>
            )}
          </Panel>
        ) : null}
      </div>
    </>
  );
}
