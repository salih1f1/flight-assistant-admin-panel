import {
  adminDeleteAirline, adminDeleteAirport, adminDeleteDeviceToken, adminDeleteFlight, adminDeleteLounge,
  adminDeleteLoyaltyProgram, adminDeleteTraveler,
  adminVerifyAirline, adminVerifyAirport, adminVerifyAlliance, adminVerifyCountry, adminVerifyLounge,
  adminVerifyLoungeProvider, adminVerifyLoyaltyProgram, adminVerifyLoyaltyProgramKind,
} from '@/api/generated/admin'

type Row = Record<string, unknown>

/**
 * `map[key]` for an own key only. Table slugs come from the URL, and a slug like 'constructor'
 * must not find Object.prototype's.
 */
export const lookup = <T>(map: Record<string, T>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined

// SensitiveProperties.RedactedPlaceholder: what the API sends in place of a sensitive value.
export const MASKED = '<redacted>'

/**
 * The reference data tables that can be verified: PATCH /admin/{slug}/{key}/verify exists for
 * exactly these slugs (key is Id for 7 of them, Code for countries), and their data browser rows
 * carry IsVerified, VerifiedAt, VerifiedBy, VerificationSource and VerificationIssue. The typed
 * admin DTOs have no verified state, which is why verifying lives with the raw data.
 *
 * Keyed by the record's key as a string (recordKey(table)'s column, e.g. Id or countries' Code):
 * the 7 numeric-id tables convert it with Number(...) themselves, since the route takes {id:int};
 * countries' route takes {code} directly.
 */
export const VERIFIERS: Record<string, (key: string, body: { isVerified: boolean }) => Promise<void>> = {
  airports: (key, body) => adminVerifyAirport(Number(key), body),
  airlines: (key, body) => adminVerifyAirline(Number(key), body),
  alliances: (key, body) => adminVerifyAlliance(Number(key), body),
  countries: adminVerifyCountry,
  lounges: (key, body) => adminVerifyLounge(Number(key), body),
  'lounge-providers': (key, body) => adminVerifyLoungeProvider(Number(key), body),
  'loyalty-programs': (key, body) => adminVerifyLoyaltyProgram(Number(key), body),
  'loyalty-program-kinds': (key, body) => adminVerifyLoyaltyProgramKind(Number(key), body),
}

// Tables keyed by something other than a single Id column (their EF configurations' HasKey).
const KEY_COLUMNS: Record<string, string | null> = {
  countries: 'Code',
  // One row per data source, keyed by the catalog key the /health page and the probe URL use.
  'data-source-status': 'Key',
  // One row per data source, keyed by the catalog key the /health page and the probe URL use.
  'lounge-provider-links': null,
  'seed-versions': null,
}

/** The column that names one record of `table`, or undefined when its key spans several columns. */
export const recordKey = (table: string): string | undefined => {
  const key = lookup(KEY_COLUMNS, table)
  return key === undefined ? 'Id' : (key ?? undefined)
}

/** Records with a richer page of their own that REPLACES the generic record page. */
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

/**
 * Tables whose grid is a list of something, rather than a dump of every column the entity has: the
 * columns worth seeing at a glance, in place of the "hide the bookkeeping columns" rule every other
 * table falls back on. They are also the columns the filter form offers, since the two answer the
 * same question — what this list is about. Everything outside the list is one press away behind
 * the grid's hidden-columns button, and always in full on the record and detail pages.
 *
 * Flights: the route and the day it flies. SyncMode is on the list deliberately — syncRowTone.ts
 * says the row tint is never the only signal precisely because that column is on screen beside it,
 * and the colour legend above the grid is read against it.
 *
 * Lounges: which airport, which lounge, which terminal — the three things that tell one lounge at
 * an airport from another. The location hint, the opening hours, the three flags and the amenities
 * are what you read once you have found it, not what you find it by.
 *
 * Countries: the code, the name and where the country is. IsEU, IsSchengen and IsEEA are a lounge's
 * flags again — facts about a country you have already found, three columns wide and reading
 * `false` on most of the rows on screen. CHECKED_COLUMNS.countries says as much already: what an
 * outside source compares is Code, Name, Alpha3, NumericCode, Region and Subregion, and the three
 * memberships are not on it.
 */
export const LIST_COLUMNS: Record<string, string[]> = {
  flights: ['AirlineId', 'FlightNumber', 'DepartureAirportId', 'ArrivalAirportId', 'ServiceDateUtc', 'SyncMode'],
  lounges: ['AirportId', 'Name', 'Terminal'],
  countries: ['Code', 'Name', 'Alpha3', 'NumericCode', 'Region', 'Subregion'],
  // The two codes, the name and the place: what an airport is found by. The coordinate pair and the
  // elevation are read once it has been found, never scanned for, and three numeric columns push
  // the rest of the row sideways. (Id is hidden for every table by #153, not by this list.)
  airports: ['Iata', 'Icao', 'Name', 'City', 'CountryCode'],
}

/** Tables the API can create and update: the noun for one record, and the page that creates one. */
export const EDITABLE: Record<string, { noun: string; newPath: string }> = {
  airlines: { noun: 'airline', newPath: '/airlines/new' },
  airports: { noun: 'airport', newPath: '/airports/new' },
  lounges: { noun: 'lounge', newPath: '/lounges/new' },
  'loyalty-programs': { noun: 'loyalty program', newPath: '/loyalty/new' },
}

/** Tables the API can delete from: what the confirmation says, and the typed DELETE for a raw row. */
export const DELETERS: Record<string, { noun: string; warning: string; remove: (row: Row) => Promise<void> }> = {
  travelers: {
    noun: 'traveler',
    warning: 'This will permanently delete the traveler and all their data.',
    remove: row => adminDeleteTraveler(String(row.Id)),
  },
  'device-tokens': {
    noun: 'device token',
    warning: 'The device will stop receiving notifications for this traveler.',
    // The route nests the token under its traveler.
    remove: row => adminDeleteDeviceToken(String(row.TravelerId), String(row.Id)),
  },
  flights: {
    noun: 'flight',
    warning: 'This will remove the flight record and all tracking links.',
    remove: row => adminDeleteFlight(Number(row.Id)),
  },
  airlines: {
    noun: 'airline',
    warning: 'Cannot delete if flights reference this airline.',
    remove: row => adminDeleteAirline(Number(row.Id)),
  },
  airports: {
    noun: 'airport',
    warning: 'This will permanently delete this airport record.',
    remove: row => adminDeleteAirport(Number(row.Id)),
  },
  lounges: {
    noun: 'lounge',
    warning: 'This will permanently delete this lounge.',
    remove: row => adminDeleteLounge(Number(row.Id)),
  },
  'loyalty-programs': {
    noun: 'loyalty program',
    warning: 'This will remove the program and all its tiers.',
    remove: row => adminDeleteLoyaltyProgram(Number(row.Id)),
  },
}
