import type { ReactNode } from 'react';

export interface TableColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
}

/**
 * The table view every chart can fall back to.
 *
 * This is not a nicety: several light-mode series colors sit below 3:1 against
 * the surface, and the rule there is that the values stay reachable without
 * relying on the color. The table is how they stay reachable.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  caption,
}: {
  rows: readonly T[];
  columns: readonly TableColumn<T>[];
  rowKey: (row: T, index: number) => string;
  caption?: string;
}): ReactNode {
  return (
    <div className="tablewrap">
      <table className="datatable">
        {caption ? <caption className="datatable__caption">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.align === 'right' ? 'is-right' : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)}>
              {columns.map((column) => (
                <td key={column.key} className={column.align === 'right' ? 'is-right' : undefined}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
