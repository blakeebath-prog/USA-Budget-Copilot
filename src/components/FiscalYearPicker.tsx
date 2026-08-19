import type { ReactNode } from 'react';

/**
 * Filters sit in one row above the charts they scope, never inside a chart card.
 */
export function FilterRow({ children }: { children: ReactNode }): ReactNode {
  return <div className="filters">{children}</div>;
}

export function FiscalYearPicker({
  label = 'Fiscal year',
  value,
  years,
  onChange,
  hint,
}: {
  label?: string;
  value: number;
  years: readonly number[];
  onChange: (year: number) => void;
  hint?: string;
}): ReactNode {
  const id = `fy-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <select id={id} value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {years.map((year) => (
          <option key={year} value={year}>
            FY{year}
          </option>
        ))}
      </select>
      {hint ? <span className="field__label">{hint}</span> : null}
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}): ReactNode {
  const id = `select-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
