type Row = Record<string, unknown>

export type VerificationState = {
  label: string
  /**
   * Tailwind classes for the tinted status pill, following the panel's existing status-pill
   * convention (TestsPage.tsx's RESULT_TONES: bg-{color}-100 text-{color}-800, no hover change
   * since the pill isn't interactive) rather than Badge's solid default/destructive variants.
   */
  tone: string
  /** Set only for 'Needs attention': the issue text, shown on hover and to assistive tech. */
  issue?: string
}

/** A non-empty, trimmed string, or undefined for missing, non-string or whitespace-only values. */
const text = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Reduces a raw row's IsVerified/VerificationSource/VerificationIssue (as GET /admin/data/{table}
 * exposes them) to one of three states, shared by the grid's IsVerified cell and the record page
 * header so the two can't drift on what counts as "needs attention". Split from the
 * VerificationStatusBadge component that renders it: a file exporting both a function and a
 * component trips react-refresh/only-export-components.
 */
export function verificationState(row: Row): VerificationState {
  if (row.IsVerified === true) {
    const source = text(row.VerificationSource)
    return { label: source ? `Verified · ${source}` : 'Verified', tone: 'border-transparent bg-green-100 text-green-800' }
  }
  const issue = text(row.VerificationIssue)
  // Amber, not red: an unverified row with a known issue is a warning to review, not a failure.
  if (issue) return { label: 'Needs attention', tone: 'border-transparent bg-amber-100 text-amber-800', issue }
  return { label: 'Unverified', tone: 'border-transparent bg-gray-100 text-gray-700' }
}
