/**
 * Placeholder rows in the shape of the grid that is loading. A table waiting on its rows keeps
 * its height and its columns instead of collapsing to one line of grey text, which reads as an
 * empty — or broken — page rather than a working one.
 */
export function TableSkeleton({ columns, rows, label }: { columns: number; rows: number; label: string }) {
  return (
    <div>
      {/* What the placeholders below mean, for anyone who cannot see them. */}
      <p role="status" className="sr-only">{label}</p>
      <div aria-hidden className="overflow-hidden rounded-md border border-gray-200">
        <table className="w-full table-fixed">
          <tbody>
            {Array.from({ length: rows }, (_, row) => (
              <tr key={row} data-skeleton-row className="border-b border-gray-100 last:border-b-0">
                {Array.from({ length: columns }, (_, column) => (
                  <td key={column} data-skeleton-cell className="px-4 py-3">
                    <span className="block h-4 animate-pulse rounded bg-gray-200" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
