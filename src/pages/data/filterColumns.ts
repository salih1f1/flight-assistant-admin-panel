import type { BrowsableColumnDto } from '@/api/generated/model'

/** A column the filter form can offer, with whatever the API said about it. */
export type FilterColumn = {
  name: string
  /** The published `BrowsableColumnKind` name, or undefined when nothing published one. */
  kind?: string
  /** The values an Enum column accepts. */
  values?: string[] | null
}

/**
 * The columns the filter form offers, preferring what GET /admin/data/tables published (backend
 * #451) over the names inferred from whatever rows came back. Published columns carry a kind, so
 * the form can offer a picker instead of a text box; inferred ones carry none, which is how the
 * filter behaved before kinds existed and is what an older API still gets.
 *
 * `applied` is the column the current filter names: it stays pickable even when neither source
 * mentions it — an empty page under a filter has no rows to name its own column, and a form
 * silently showing a different column than the URL filters on is worse than an extra option.
 */
export function filterColumns(
  published: BrowsableColumnDto[] | null | undefined,
  inferred: string[],
  applied: string | undefined,
): FilterColumn[] {
  const columns: FilterColumn[] = (published ?? [])
    .filter(column => typeof column.name === 'string' && column.name !== '')
    .map(column => ({ name: column.name!, kind: column.kind ?? undefined, values: column.values }))

  const offered = columns.length > 0 ? columns : inferred.map(name => ({ name }))

  return applied && !offered.some(column => column.name === applied)
    ? [{ name: applied }, ...offered]
    : offered
}

/** Which value control a column's kind calls for. */
export type FilterControl = 'enum' | 'bool' | 'date' | 'text' | 'none'

/**
 * The control for a published kind. An unknown or absent kind falls back to free text rather than
 * disabling anything: a kind the API adds later must leave the form working, and "no metadata" is
 * the ordinary state for an older API. Only `Unsupported` — the API saying outright that it cannot
 * filter this column — offers nothing.
 */
export function filterControl(kind: string | null | undefined): FilterControl {
  switch (kind) {
    case 'Enum': return 'enum'
    case 'Bool': return 'bool'
    case 'Date': return 'date'
    case 'Unsupported': return 'none'
    default: return 'text'
  }
}
