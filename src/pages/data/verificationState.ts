import type { BadgeProps } from '@/components/ui/badge'

type Row = Record<string, unknown>

export type VerificationState = {
  label: string
  variant: NonNullable<BadgeProps['variant']>
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
    return { label: source ? `Verified · ${source}` : 'Verified', variant: 'default' }
  }
  const issue = text(row.VerificationIssue)
  if (issue) return { label: 'Needs attention', variant: 'destructive', issue }
  return { label: 'Unverified', variant: 'secondary' }
}
