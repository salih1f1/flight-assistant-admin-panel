import { formatUtcDay } from '@/lib/formatUtc'
import { cn } from '@/lib/utils'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** A bucket's name: "Sep 8" for a day, "Sep 8 17:00" for an hour. */
const bucketLabel = (start: Date, bucket: string) =>
  bucket === 'hour' ? `${formatUtcDay(start)} ${start.toISOString().slice(11, 16)}` : formatUtcDay(start)

/**
 * A stat tile's trend: one column per bucket of rows added, oldest first, in a muted gray with the
 * current bucket in the accent. Each column shows its count on hover; the same counts are in a
 * visually hidden table, so nothing is available only by hovering.
 *
 * Each column is its own small SVG in a flex row, so a column is exactly as wide as its slot and its
 * rounded top isn't stretched by a shared, aspect-distorted viewBox.
 */
export function TrendColumns({ label, series, fromUtc, bucket, summary }: {
  label: string
  series: number[]
  fromUtc: string
  bucket: string
  /** What the whole trend says, e.g. "3 added in the last 7 days". */
  summary: string
}) {
  const start = new Date(fromUtc).getTime()
  const size = bucket === 'hour' ? HOUR_MS : DAY_MS
  const peak = Math.max(1, ...series)
  const buckets = series.map((count, i) => ({ count, label: bucketLabel(new Date(start + i * size), bucket) }))

  return (
    <div>
      <div role="img" aria-label={summary} className="flex h-10 items-end gap-0.5">
        {buckets.map(({ count, label: name }, i) => {
          const current = i === buckets.length - 1
          // A non-zero count is never shorter than a few pixels, so one row still reads as "some".
          const percent = count === 0 ? 0 : Math.max((count / peak) * 100, 20)
          return (
            <svg
              key={name}
              data-bucket={name}
              data-current={String(current)}
              aria-hidden="true"
              className="group h-full max-w-6 flex-1"
            >
              <title>{`${name}: ${count} added`}</title>
              {/* The hairline baseline, so a zero bucket is visibly zero rather than missing. */}
              <line x1="0" x2="100%" y1="100%" y2="100%" strokeWidth="2" className="stroke-gray-200" />
              {percent > 0 && (
                // Shifted 4px down and clipped by the SVG, so only the top corners show rounded.
                <rect
                  x="0"
                  y={`${100 - percent}%`}
                  width="100%"
                  height={`${percent}%`}
                  rx="4"
                  transform="translate(0 4)"
                  className={cn(current ? 'fill-blue-600 group-hover:fill-blue-700' : 'fill-gray-300 group-hover:fill-gray-400')}
                />
              )}
            </svg>
          )
        })}
      </div>
      <table className="sr-only">
        <caption>{`${label} added per ${bucket}`}</caption>
        <thead>
          <tr>
            <th scope="col">{bucket === 'hour' ? 'Hour' : 'Day'}</th>
            <th scope="col">Added</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map(({ count, label: name }) => (
            <tr key={name}>
              <td>{name}</td>
              <td>{count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
