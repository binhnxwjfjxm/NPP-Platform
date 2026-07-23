import type { ReactNode } from "react";

export type DataTableColumn<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
};

type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  emptyMessage?: string;
};

export function DataTable<T>({ columns, rows, getRowKey, emptyMessage = "Chua co du lieu" }: DataTableProps<T>) {
  if (rows.length === 0) {
    return <div className="empty-inline">{emptyMessage}</div>;
  }

  return (
    <>
      <div className="table-wrap desktop-table">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th className={column.align ? `align-${column.align}` : undefined} key={column.key}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={getRowKey(row)}>
                {columns.map((column) => (
                  <td className={column.align ? `align-${column.align}` : undefined} key={column.key}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mobile-table-cards">
        {rows.map((row) => (
          <article className="mobile-row-card" key={getRowKey(row)}>
            {columns.map((column, index) => (
              <div className={index === 0 ? "mobile-row-field primary" : "mobile-row-field"} key={column.key}>
                <span>{column.header}</span>
                <strong>{column.render(row)}</strong>
              </div>
            ))}
          </article>
        ))}
      </div>
    </>
  );
}
