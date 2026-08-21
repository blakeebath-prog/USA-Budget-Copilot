import { useMemo, useState, type ReactNode } from 'react';
import { Panel } from '../components/Panel';
import { DataTable } from '../components/DataTable';
import { BarChart } from '../components/charts/BarChart';
import { ColumnChart } from '../components/charts/ColumnChart';
import { FilterRow, FiscalYearPicker, SelectField } from '../components/FiscalYearPicker';
import { useAsyncData } from '../hooks/useAsyncData';
import {
  fetchSpendingByCategory,
  fetchSpendingOverTime,
  isAggregateBucket,
  type SpendingCategory,
} from '../lib/api/usaspending';
import { compactUsd, fullUsd, percent } from '../lib/format';
import { fiscalYearBounds, fiscalYearRange, latestCompleteFiscalYear } from '../lib/fiscalYear';

const CATEGORIES: { value: SpendingCategory; label: string }[] = [
  { value: 'recipient', label: 'Recipient' },
  { value: 'awarding_agency', label: 'Awarding agency' },
  { value: 'awarding_subagency', label: 'Awarding sub-agency' },
  { value: 'state_territory', label: 'State or territory' },
  { value: 'federal_account', label: 'Federal account' },
  { value: 'naics', label: 'Industry (NAICS)' },
  { value: 'psc', label: 'Product or service code' },
  { value: 'cfda', label: 'Assistance listing (CFDA)' },
];

const HISTORY_YEARS = 10;

/**
 * Awards: contracts, grants, loans, and direct payments.
 *
 * The banner is not decoration. Award data is the most-quoted and most-misread
 * federal spending source, because it excludes most of what the government
 * actually spends — Social Security benefits, Medicare, interest on the debt.
 */
export function AwardsView(): ReactNode {
  const years = useMemo(() => fiscalYearRange(9, latestCompleteFiscalYear() + 1), []);
  const [fiscalYear, setFiscalYear] = useState(latestCompleteFiscalYear());
  const [category, setCategory] = useState<SpendingCategory>('recipient');

  const bounds = fiscalYearBounds(fiscalYear);
  const historyStart = fiscalYearBounds(latestCompleteFiscalYear() - HISTORY_YEARS + 1).start;
  const historyEnd = fiscalYearBounds(latestCompleteFiscalYear()).end;

  const byCategory = useAsyncData(
    (signal) =>
      fetchSpendingByCategory(category, { startDate: bounds.start, endDate: bounds.end }, 15, signal),
    [category, bounds.start, bounds.end],
  );

  const overTime = useAsyncData(
    (signal) => fetchSpendingOverTime('fiscal_year', { startDate: historyStart, endDate: historyEnd }, signal),
    [historyStart, historyEnd],
  );

  const returned = byCategory.data ?? [];
  const aggregates = returned.filter(isAggregateBucket);
  const rows = returned.filter((row) => !isAggregateBucket(row));
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.amount), 0);
  const categoryLabel = CATEGORIES.find((entry) => entry.value === category)?.label ?? 'Category';

  return (
    <>
      <div className="banner">
        <strong>Awards are not the whole budget, and not the same measure.</strong> USAspending tracks contracts,
        grants, loans, and direct payments at the award level. Direct payments do include large benefit programs,
        so this is not simply "the discretionary part" — but interest on the debt and other spending never appear
        as awards, and these are obligations rather than cash paid. The totals here and the outlays on the
        Overview are different quantities, not two sizes of the same one.
      </div>

      <FilterRow>
        <FiscalYearPicker value={fiscalYear} years={years} onChange={setFiscalYear} />
        <SelectField label="Break down by" value={category} options={CATEGORIES} onChange={setCategory} />
      </FilterRow>

      <div className="grid">
        <Panel
          wide
          title={`Top 15 by ${categoryLabel.toLowerCase()}, FY${fiscalYear}`}
          subtitle={
            aggregates.length
              ? `Award obligations within the fiscal year. ${aggregates
                  .map((row) => `${row.name} (${compactUsd(row.amount)})`)
                  .join(', ')} is excluded: it is the API's bucket for money not attributable to one recipient, and it dwarfs every named one.`
              : 'Award obligations within the fiscal year. Modifications and de-obligations move these totals after the fact.'
          }
          provenance={byCategory.provenance}
          loading={byCategory.loading}
          error={byCategory.error}
          onRetry={byCategory.reload}
          table={
            <DataTable
              rows={rows}
              rowKey={(row, index) => `${row.name}-${index}`}
              columns={[
                { key: 'name', header: categoryLabel, render: (row) => row.name },
                { key: 'code', header: 'Code', render: (row) => row.code ?? '—' },
                { key: 'amount', header: 'Obligations', align: 'right', render: (row) => fullUsd(row.amount) },
                {
                  key: 'share',
                  header: 'Share of top 15',
                  align: 'right',
                  render: (row) => (total > 0 ? percent(Math.max(0, row.amount) / total) : '—'),
                },
              ]}
            />
          }
        >
          {rows.length ? (
            <BarChart
              bars={rows.map((row, index) => ({
                key: `${row.name}-${index}`,
                label: row.name,
                value: row.amount,
                note: total > 0 ? `${percent(Math.max(0, row.amount) / total)} of the top 15 shown` : undefined,
              }))}
              formatValue={compactUsd}
              labelWidth={300}
            />
          ) : (
            <div className="empty">
              {byCategory.loading ? 'Loading award totals…' : 'No award records for this year and breakdown.'}
            </div>
          )}
        </Panel>

        <Panel
          wide
          title="Award obligations by fiscal year"
          subtitle={`All award types, FY${latestCompleteFiscalYear() - HISTORY_YEARS + 1}–FY${latestCompleteFiscalYear()}. The pandemic years are a genuine spike, not a data error.`}
          provenance={overTime.provenance}
          loading={overTime.loading}
          error={overTime.error}
          onRetry={overTime.reload}
          table={
            <DataTable
              rows={overTime.data ?? []}
              rowKey={(row) => row.label}
              columns={[
                { key: 'period', header: 'Fiscal year', render: (row) => row.label },
                { key: 'amount', header: 'Obligations', align: 'right', render: (row) => fullUsd(row.amount) },
              ]}
            />
          }
        >
          {overTime.data?.length ? (
            <ColumnChart
              columns={overTime.data.map((point) => ({
                key: point.label,
                label: point.label.replace('FY', 'FY'),
                value: point.amount,
              }))}
              formatValue={compactUsd}
              height={280}
            />
          ) : (
            <div className="empty">{overTime.loading ? 'Loading history…' : 'No award history returned.'}</div>
          )}
        </Panel>
      </div>
    </>
  );
}
