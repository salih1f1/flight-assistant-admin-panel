import {
  adminVerifyAirline, adminVerifyAirport, adminVerifyAlliance, adminVerifyCountry, adminVerifyLounge,
  adminVerifyLoungeProvider, adminVerifyLoyaltyProgram, adminVerifyLoyaltyProgramKind,
} from '@/api/generated/admin'

/**
 * `map[key]` for an own key only. Table slugs come from the URL, and a slug like 'constructor'
 * must not find Object.prototype's.
 */
export const lookup = <T>(map: Record<string, T>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined

// SensitiveProperties.RedactedPlaceholder: what the API sends in place of a sensitive value.
export const MASKED = '<redacted>'

/**
 * The reference data tables that can be verified: PATCH /admin/{slug}/{id}/verify exists for
 * exactly these slugs, and their data browser rows carry IsVerified, VerifiedAt and VerifiedBy.
 * The typed admin DTOs have no verified state, which is why verifying lives with the raw data.
 */
export const VERIFIERS: Record<string, (id: number, body: { isVerified: boolean }) => Promise<void>> = {
  airports: adminVerifyAirport,
  airlines: adminVerifyAirline,
  alliances: adminVerifyAlliance,
  countries: adminVerifyCountry,
  lounges: adminVerifyLounge,
  'lounge-providers': adminVerifyLoungeProvider,
  'loyalty-programs': adminVerifyLoyaltyProgram,
  'loyalty-program-kinds': adminVerifyLoyaltyProgramKind,
}

// Tables keyed by something other than a single Id column (their EF configurations' HasKey).
const KEY_COLUMNS: Record<string, string | null> = {
  countries: 'Code',
  'lounge-provider-links': null,
  'seed-versions': null,
}

/** The column that names one record of `table`, or undefined when its key spans several columns. */
export const recordKey = (table: string): string | undefined => {
  const key = lookup(KEY_COLUMNS, table)
  return key === undefined ? 'Id' : (key ?? undefined)
}

/** Records with a richer page of their own than the generic record page. */
export const OWN_DETAIL_PAGES: Record<string, (id: string) => string> = {
  travelers: id => `/travelers/${id}`,
  flights: id => `/flights/${id}`,
}

/** Where a raw row opens: its own detail page, the record page, or nowhere for a table with no single key. */
export function recordPath(table: string, row: Record<string, unknown>): string | undefined {
  const key = recordKey(table)
  const value = key === undefined ? undefined : row[key]
  if (value === null || value === undefined) return undefined
  const id = String(value)
  return lookup(OWN_DETAIL_PAGES, table)?.(id) ?? `/data/${table}/${encodeURIComponent(id)}`
}
