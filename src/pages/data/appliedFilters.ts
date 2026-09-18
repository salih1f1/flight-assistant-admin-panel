/**
 * The applied filter criteria, as the URL carries them: one `filter` search param per criterion,
 * each `column:value`, all ANDed by the API (#146, backend #479). Kept out of DataBrowserPage so
 * the criteria rules are readable and testable on their own.
 */

/** A criterion split on its *first* colon only — a value (an ISO-8601 timestamp) may contain more. */
export function parseFilter(filter: string): { column: string; value: string } {
  const separator = filter.indexOf(':')
  return separator < 0
    ? { column: filter, value: '' }
    : { column: filter.slice(0, separator), value: filter.slice(separator + 1) }
}

/**
 * A criterion as a chip reads it. A `>=` value is spelled out in the same words the comparison
 * picker uses ("on or after"), rather than shown as an operator nobody typed.
 */
export function filterLabel(filter: string): string {
  const { column, value } = parseFilter(filter)
  return value.startsWith('>=') ? `${column}: on or after ${value.slice(2)}` : `${column}: ${value}`
}

/** Appends a criterion, unless exactly that criterion is already applied. */
export function withFilter(filters: string[], filter: string): string[] {
  return filters.includes(filter) ? filters : [...filters, filter]
}

/** Removes exactly one criterion, leaving every other one applied. */
export function withoutFilter(filters: string[], filter: string): string[] {
  return filters.filter(applied => applied !== filter)
}

/** Removes every criterion on one column — how the Verified toggle drops its own. */
export function withoutColumn(filters: string[], column: string): string[] {
  return filters.filter(applied => parseFilter(applied).column !== column)
}
