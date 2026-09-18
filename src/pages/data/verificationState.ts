import { formatUtcMinute } from '@/lib/formatUtc'

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
  /**
   * Set only for 'Verified · stale': when the row was verified, by what, and the window it is past.
   * Shown on hover and to assistive tech, like `issue` — kept a separate field because `issue` is
   * also what VerificationPanel keys "does this row need attention?" off, and a stale row does not.
   */
  staleNote?: string
}

/** What the caller must supply for a stale row to be recognised as one. */
export type StaleWindow = {
  /**
   * `Verification:StaleAfterDays` from GET /admin/health. Null or undefined means "not known yet"
   * (the health read is loading, or failed) — every row then reads as plain 'Verified', which is
   * how this looked before staleness existed at all, rather than guessing at a window.
   */
  staleAfterDays?: number | null
  /** The clock, so callers stay testable; the badge passes none and gets the real one. */
  now?: Date
}

const DAY_MS = 24 * 60 * 60 * 1000

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
export function verificationState(row: Row, window: StaleWindow = {}): VerificationState {
  if (row.IsVerified === true) {
    const source = text(row.VerificationSource)
    const stale = staleNote(row, source, window)
    // Amber, but lighter than 'Needs attention' below: nobody has re-checked this row lately, which
    // is not the same as a check having found something wrong with it.
    if (stale) return { label: 'Verified · stale', tone: 'border-transparent bg-amber-50 text-amber-700', staleNote: stale }
    return { label: source ? `Verified · ${source}` : 'Verified', tone: 'border-transparent bg-green-100 text-green-800' }
  }
  const issue = text(row.VerificationIssue)
  // Amber, not red: an unverified row with a known issue is a warning to review, not a failure.
  if (issue) return { label: 'Needs attention', tone: 'border-transparent bg-amber-100 text-amber-800', issue }
  return { label: 'Unverified', tone: 'border-transparent bg-gray-100 text-gray-700' }
}

/**
 * The hover text for a verified row the backend would now re-queue, or undefined while it is still
 * good. "Older than" is strict, matching `FlightTrackedVerificationEventHandler.NeedsVerification`:
 * a row exactly at the window is one the backend still leaves alone, so the panel must not call it
 * stale either. An unparseable or missing VerifiedAt reads as not stale — the same "don't guess"
 * choice an unknown window makes.
 */
function staleNote(row: Row, source: string | undefined, { staleAfterDays, now = new Date() }: StaleWindow): string | undefined {
  if (staleAfterDays == null || staleAfterDays <= 0) return undefined

  const verifiedAt = text(row.VerifiedAt)
  if (verifiedAt === undefined) return undefined
  const verifiedAtMs = new Date(verifiedAt).getTime()
  if (Number.isNaN(verifiedAtMs)) return undefined

  if (verifiedAtMs >= now.getTime() - staleAfterDays * DAY_MS) return undefined

  const by = source ? ` by ${source}` : ''
  return `Verified ${formatUtcMinute(verifiedAt)} UTC${by} — older than the ${staleAfterDays}-day window`
}
