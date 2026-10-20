import type { ReactNode } from "react";
import { Empty } from "./Empty";

function renderCell(cell: ReactNode): ReactNode {
  if (cell === null || cell === undefined) return "—";
  if (typeof cell === "number" && !Number.isFinite(cell)) return "—";
  return cell;
}

export function DataTable({
  headers,
  rows,
  className = "",
  emptyText = "未找到符合条件的记录"
}: {
  headers: string[];
  rows: ReactNode[][];
  className?: string;
  emptyText?: string;
}) {
  return (
    <div className="table-wrap">
      <table className={className}>
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th key={`${header}-${index}`}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{renderCell(cell)}</td>
              ))}
            </tr>
          )) : (
            <tr>
              <td colSpan={Math.max(headers.length, 1)}>
                <Empty text={emptyText} />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
