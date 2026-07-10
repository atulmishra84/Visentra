import { type ReactNode, useMemo, useState } from "react";

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
};

type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  getRowKey?: (row: T, index: number) => string;
};

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  loading,
  emptyMessage = "No records found.",
  onRowClick,
  getRowKey
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [direction, setDirection] = useState<"asc" | "desc">("asc");

  const sortedRows = useMemo(() => {
    if (!sortKey) {
      return rows;
    }

    const column = columns.find((candidate) => candidate.key === sortKey);
    if (!column?.sortValue) {
      return rows;
    }

    return [...rows].sort((left, right) => {
      const leftValue = column.sortValue?.(left) ?? "";
      const rightValue = column.sortValue?.(right) ?? "";
      const compare =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue));
      return direction === "asc" ? compare : -compare;
    });
  }, [columns, direction, rows, sortKey]);

  if (loading) {
    return <div className="loading-state">Loading live visibility data...</div>;
  }

  if (!rows.length) {
    return <div className="empty-state">{emptyMessage}</div>;
  }

  const handleSort = (column: Column<T>) => {
    if (!column.sortValue) {
      return;
    }

    if (sortKey === column.key) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(column.key);
      setDirection("asc");
    }
  };

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>
                <button
                  className="button ghost"
                  disabled={!column.sortValue}
                  type="button"
                  onClick={() => handleSort(column)}
                >
                  {column.header}
                  {sortKey === column.key ? (direction === "asc" ? "↑" : "↓") : null}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, index) => (
            <tr
              key={getRowKey?.(row, index) ?? String(row.id ?? index)}
              onClick={() => onRowClick?.(row)}
              style={{ cursor: onRowClick ? "pointer" : "default" }}
            >
              {columns.map((column) => (
                <td key={column.key}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
