import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult } from '@/test/fakeApi'
import { DataBrowserPage } from './DataBrowserPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

/**
 * Every table the API browses, with its columns in BrowsableTables order, and the columns the grid
 * starts without: bookkeeping columns — Id among them (#153) — the ones SensitiveProperties masks
 * on every row, and, on the 8 verifiable tables, IsVerified, which the grid's verification column
 * says in an icon's width instead. Listed by hand, not derived from DataBrowserPage's list, so a
 * change there has to agree with this.
 */
const TABLES: { slug: string; columns: string[]; hidden: string[] }[] = [
  { slug: 'travelers', columns: ['Id', 'Email', 'DisplayName', 'CreatedUtc', 'UpdatedUtc'], hidden: ['Id', 'Email'] },
  { slug: 'device-tokens', columns: ['Id', 'TravelerId', 'Platform', 'Token', 'LastSeenUtc'], hidden: ['Id', 'Token'] },
  // The one table with a list of its own (LIST_COLUMNS): everything outside it starts hidden,
  // rather than only the bookkeeping and masked columns the other tables hide.
  { slug: 'flights', columns: ['Id', 'AirlineId', 'FlightNumber', 'DepartureAirportId', 'ArrivalAirportId', 'ServiceDateUtc', 'ScheduledDepartureUtc', 'ScheduledArrivalUtc', 'EstimatedDepartureUtc', 'EstimatedArrivalUtc', 'ActualDepartureUtc', 'ActualArrivalUtc', 'EquipmentAircraftIcao', 'SyncMode', 'CreatedUtc', 'UpdatedUtc'], hidden: ['Id', 'ScheduledDepartureUtc', 'ScheduledArrivalUtc', 'EstimatedDepartureUtc', 'EstimatedArrivalUtc', 'ActualDepartureUtc', 'ActualArrivalUtc', 'EquipmentAircraftIcao', 'CreatedUtc', 'UpdatedUtc'] },
  { slug: 'traveler-flights', columns: ['Id', 'TravelerId', 'FlightId', 'Notify', 'CreatedUtc'], hidden: ['Id'] },
  { slug: 'flight-statuses', columns: ['Id', 'Code', 'Name', 'Description'], hidden: ['Id'] },
  { slug: 'flight-status-events', columns: ['Id', 'FlightId', 'StatusId', 'EffectiveAtUtc', 'RecordedAtUtc', 'Source', 'ExternalId', 'Gate', 'Terminal', 'BaggageClaim', 'Remarks', 'RawPayloadJson', 'DedupHash'], hidden: ['Id', 'RawPayloadJson', 'DedupHash'] },
  // A second table with a list of its own, and the first verifiable one: everything but the
  // airport, the name and the terminal starts hidden.
  { slug: 'lounges', columns: ['Id', 'AirportId', 'Name', 'Terminal', 'LocationHint', 'Hours', 'IsAirside', 'IsDomesticOnly', 'IsInternationalOnly', 'Amenities', 'CreatedUtc', 'IsVerified', 'VerifiedAt', 'VerifiedBy', 'VerificationSource', 'VerificationIssue'], hidden: ['Id', 'LocationHint', 'Hours', 'IsAirside', 'IsDomesticOnly', 'IsInternationalOnly', 'Amenities', 'CreatedUtc', 'IsVerified', 'VerifiedAt', 'VerifiedBy', 'VerificationSource', 'VerificationIssue'] },
  { slug: 'lounge-providers', columns: ['Id', 'Code', 'Name', 'Kind', 'Description', 'IsVerified', 'VerifiedAt', 'VerifiedBy', 'VerificationSource', 'VerificationIssue'], hidden: ['Id', 'IsVerified', 'VerifiedAt', 'VerifiedBy', 'VerificationSource', 'VerificationIssue'] },
  { slug: 'lounge-provider-links', columns: ['LoungeId', 'ProviderId', 'Role', 'Notes', 'MinAllianceTierCode'], hidden: ['Notes'] },
  { slug: 'loyalty-programs', columns: ['Id', 'Code', 'Name', 'KindId', 'AirlineId', 'AllianceCode', 'CreatedUtc', 'IsVerified', 'VerifiedAt', 'VerifiedBy', 'VerificationSource', 'VerificationIssue'], hidden: ['Id', 'IsVerified', 'VerifiedAt', 'VerifiedBy', 'VerificationSource', 'VerificationIssue'] },
  { slug: 'loyalty-program-kinds', columns: ['Id', 'Code', 'Name', 'Description', 'IsVerified', 'VerifiedAt', 'VerifiedBy', 'VerificationSource', 'VerificationIssue'], hidden: ['Id', 'IsVerified', 'VerifiedAt', 'VerifiedBy', 'VerificationSource', 'VerificationIssue'] },
  { slug: 'loyalty-tiers', columns: ['Id', 'ProgramId', 'Code', 'Name', 'Rank', 'AllianceCode', 'AllianceTierCode'], hidden: ['Id'] },
  { slug: 'traveler-loyalty-memberships', columns: ['Id', 'TravelerId', 'ProgramId', 'TierId', 'AccountNumber', 'TierExpiryDate', 'PointsExpiryDate', 'CreatedUtc', 'UpdatedUtc'], hidden: ['Id', 'AccountNumber'] },
  { slug: 'airlines', columns: ['Id', 'Iata', 'Icao', 'Name', 'CountryCode', 'AllianceCode', 'SourceType', 'FirstSeenAt', 'IsVerified', 'VerifiedAt', 'VerifiedBy', 'VerificationSource', 'VerificationIssue'], hidden: ['Id', 'SourceType', 'FirstSeenAt', 'IsVerified', 'VerifiedAt', 'VerifiedBy', 'VerificationSource', 'VerificationIssue'] },
  { slug: 'airports', columns: ['Id', 'Iata', 'Icao', 'Name', 'City', 'CountryCode', 'Latitude', 'Longitude', 'ElevationFt', 'SourceType', 'FirstSeenAt', 'IsVerified', 'VerifiedAt', 'VerifiedBy', 'VerificationSource', 'VerificationIssue'], hidden: ['Id', 'SourceType', 'FirstSeenAt', 'IsVerified', 'VerifiedAt', 'VerifiedBy', 'VerificationSource', 'VerificationIssue'] },
  { slug: 'alliances', columns: ['Id', 'Code', 'Name', 'SourceType', 'FirstSeenAt', 'IsVerified', 'VerifiedAt', 'VerifiedBy', 'VerificationSource', 'VerificationIssue'], hidden: ['Id', 'SourceType', 'FirstSeenAt', 'IsVerified', 'VerifiedAt', 'VerifiedBy', 'VerificationSource', 'VerificationIssue'] },
  { slug: 'countries', columns: ['Code', 'Name', 'Alpha3', 'NumericCode', 'Region', 'Subregion', 'IsEU', 'IsSchengen', 'IsEEA', 'SourceType', 'FirstSeenAt', 'IsVerified', 'VerifiedAt', 'VerifiedBy', 'VerificationSource', 'VerificationIssue'], hidden: ['SourceType', 'FirstSeenAt', 'IsVerified', 'VerifiedAt', 'VerifiedBy', 'VerificationSource', 'VerificationIssue'] },
  { slug: 'seed-versions', columns: ['Dataset', 'Version', 'AppliedAt'], hidden: [] },
  { slug: 'admin-audit-log', columns: ['Id', 'ActorId', 'ActorName', 'ActionUtc', 'Action', 'EntityType', 'EntityId', 'Summary', 'Before', 'After', 'TraceId'], hidden: ['Id'] },
]

const MASKED_COLUMNS = new Set(['Email', 'Token', 'AccountNumber'])

/** One row shaped like GET /admin/data/{table}: every column filled, masked columns redacted. */
const row = (columns: string[]) => Object.fromEntries(columns.map(name => [
  name,
  MASKED_COLUMNS.has(name) ? '<redacted>' : name === 'Id' ? 1 : name === 'IsVerified' ? false : `${name} value`,
]))

let empty = false

function install() {
  installFakeApi(req => {
    if (req.method !== 'GET') throw httpError(404)
    if (req.url === '/admin/data/tables') return TABLES.map(t => ({ slug: t.slug, displayName: t.slug, rowCount: 1 }))
    const table = TABLES.find(t => req.url === `/admin/data/${t.slug}`)
    if (!table) throw httpError(404)
    return pagedResult(empty ? [] : [row(table.columns)], req.params)
  })
}

function renderAt(entry: string) {
  const router = createMemoryRouter([{ path: '/data/:table', element: <DataBrowserPage /> }], { initialEntries: [entry] })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

/**
 * The header a column is shown under: a column holding another record's id is labelled by what it
 * holds, since the cells under it hold that record. Listed by hand, like TABLES above, so a change
 * to DataBrowserPage's COLUMN_LABELS has to agree with this.
 */
const HEADERS: Record<string, string> = {
  AirlineId: 'Airline',
  AirportId: 'Airport',
  DepartureAirportId: 'From',
  ArrivalAirportId: 'To',
}

const headersFor = (columns: string[]) => columns.map(name => HEADERS[name] ?? name)

/** The grid's data column headers, leaving out the verify and actions columns. */
const dataHeaders = () => within(screen.getByRole('table'))
  .getAllByRole('columnheader')
  .map(h => h.querySelector('button')?.textContent?.replace(/[↑↓]/g, '').trim())
  .filter((name): name is string => !!name)

const columnsWord = (n: number) => `column${n === 1 ? '' : 's'}`

describe('Hidden columns toggle', () => {
  beforeEach(() => {
    empty = false
    install()
  })

  const withHidden = TABLES.filter(t => t.hidden.length > 0)
  const withoutHidden = TABLES.filter(t => t.hidden.length === 0)

  it.each(withHidden)('$slug: shows its hidden columns in place, then hides them again', async ({ slug, columns, hidden }) => {
    const user = userEvent.setup()
    const router = renderAt(`/data/${slug}`)
    await screen.findByRole('table')
    const shown = columns.filter(name => !hidden.includes(name))
    expect(await screen.findByRole('columnheader', { name: headersFor(shown)[0] })).toBeInTheDocument()
    expect(dataHeaders()).toEqual(headersFor(shown))

    await user.click(screen.getByRole('button', { name: `Show ${hidden.length} hidden ${columnsWord(hidden.length)}` }))

    expect(dataHeaders()).toEqual(headersFor(columns))
    expect(new URLSearchParams(router.state.location.search).get('columns')).toBe('all')

    await user.click(screen.getByRole('button', { name: `Hide ${hidden.length} ${columnsWord(hidden.length)}` }))

    expect(dataHeaders()).toEqual(headersFor(shown))
    expect(new URLSearchParams(router.state.location.search).get('columns')).toBeNull()
  })

  it.each(withoutHidden)('$slug: has nothing hidden, so offers no toggle', async ({ slug, columns }) => {
    renderAt(`/data/${slug}`)
    expect(await screen.findByRole('columnheader', { name: headersFor(columns)[0] })).toBeInTheDocument()

    expect(dataHeaders()).toEqual(headersFor(columns))
    expect(screen.queryByRole('button', { name: /hidden column|^Hide \d+ column|All columns/ })).not.toBeInTheDocument()
  })

  it('offers no toggle from a shared link on a table with nothing hidden', async () => {
    renderAt('/data/seed-versions?columns=all')
    expect(await screen.findByRole('columnheader', { name: 'Dataset' })).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: /hidden column|^Hide \d+ column|All columns/ })).not.toBeInTheDocument()
  })

  it('offers no toggle on a page with no rows', async () => {
    empty = true
    renderAt('/data/airlines')
    expect(await screen.findByText('No results.')).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: /hidden column|^Hide \d+ column|All columns/ })).not.toBeInTheDocument()
  })
})
