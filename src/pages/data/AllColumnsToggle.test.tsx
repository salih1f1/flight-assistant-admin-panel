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
 * starts without: bookkeeping columns and the ones SensitiveProperties masks on every row. Listed
 * by hand, not derived from DataBrowserPage's list, so a change there has to agree with this.
 */
const TABLES: { slug: string; columns: string[]; hidden: string[] }[] = [
  { slug: 'travelers', columns: ['Id', 'Email', 'DisplayName', 'CreatedUtc', 'UpdatedUtc'], hidden: ['Email'] },
  { slug: 'device-tokens', columns: ['Id', 'TravelerId', 'Platform', 'Token', 'LastSeenUtc'], hidden: ['Token'] },
  { slug: 'flights', columns: ['Id', 'AirlineId', 'FlightNumber', 'DepartureAirportId', 'ArrivalAirportId', 'ServiceDateUtc', 'ScheduledDepartureUtc', 'ScheduledArrivalUtc', 'EstimatedDepartureUtc', 'EstimatedArrivalUtc', 'ActualDepartureUtc', 'ActualArrivalUtc', 'EquipmentAircraftIcao', 'CreatedUtc', 'UpdatedUtc'], hidden: [] },
  { slug: 'traveler-flights', columns: ['Id', 'TravelerId', 'FlightId', 'Notify', 'CreatedUtc'], hidden: [] },
  { slug: 'flight-statuses', columns: ['Id', 'Code', 'Name', 'Description'], hidden: [] },
  { slug: 'flight-status-events', columns: ['Id', 'FlightId', 'StatusId', 'EffectiveAtUtc', 'RecordedAtUtc', 'Source', 'ExternalId', 'Gate', 'Terminal', 'BaggageClaim', 'Remarks', 'RawPayloadJson', 'DedupHash'], hidden: ['RawPayloadJson', 'DedupHash'] },
  { slug: 'lounges', columns: ['Id', 'AirportId', 'Name', 'Terminal', 'LocationHint', 'Hours', 'IsAirside', 'IsDomesticOnly', 'IsInternationalOnly', 'Amenities', 'CreatedUtc', 'IsVerified', 'VerifiedAt', 'VerifiedBy'], hidden: ['VerifiedAt', 'VerifiedBy'] },
  { slug: 'lounge-providers', columns: ['Id', 'Code', 'Name', 'Kind', 'Description', 'IsVerified', 'VerifiedAt', 'VerifiedBy'], hidden: ['VerifiedAt', 'VerifiedBy'] },
  { slug: 'lounge-provider-links', columns: ['LoungeId', 'ProviderId', 'Role', 'Notes', 'MinAllianceTierCode'], hidden: ['Notes'] },
  { slug: 'loyalty-programs', columns: ['Id', 'Code', 'Name', 'KindId', 'AirlineId', 'AllianceCode', 'CreatedUtc', 'IsVerified', 'VerifiedAt', 'VerifiedBy'], hidden: ['VerifiedAt', 'VerifiedBy'] },
  { slug: 'loyalty-program-kinds', columns: ['Id', 'Code', 'Name', 'Description', 'IsVerified', 'VerifiedAt', 'VerifiedBy'], hidden: ['VerifiedAt', 'VerifiedBy'] },
  { slug: 'loyalty-tiers', columns: ['Id', 'ProgramId', 'Code', 'Name', 'Rank', 'AllianceCode', 'AllianceTierCode'], hidden: [] },
  { slug: 'traveler-loyalty-memberships', columns: ['Id', 'TravelerId', 'ProgramId', 'TierId', 'AccountNumber', 'TierExpiryDate', 'PointsExpiryDate', 'CreatedUtc', 'UpdatedUtc'], hidden: ['AccountNumber'] },
  { slug: 'airlines', columns: ['Id', 'Iata', 'Icao', 'Name', 'CountryCode', 'AllianceCode', 'SourceType', 'FirstSeenAt', 'IsVerified', 'VerifiedAt', 'VerifiedBy'], hidden: ['SourceType', 'FirstSeenAt', 'VerifiedAt', 'VerifiedBy'] },
  { slug: 'airports', columns: ['Id', 'Iata', 'Icao', 'Name', 'City', 'CountryCode', 'Latitude', 'Longitude', 'ElevationFt', 'SourceType', 'FirstSeenAt', 'IsVerified', 'VerifiedAt', 'VerifiedBy'], hidden: ['SourceType', 'FirstSeenAt', 'VerifiedAt', 'VerifiedBy'] },
  { slug: 'alliances', columns: ['Id', 'Code', 'Name', 'SourceType', 'FirstSeenAt', 'IsVerified', 'VerifiedAt', 'VerifiedBy'], hidden: ['SourceType', 'FirstSeenAt', 'VerifiedAt', 'VerifiedBy'] },
  { slug: 'countries', columns: ['Code', 'Name', 'Alpha3', 'NumericCode', 'Region', 'Subregion', 'IsEU', 'IsSchengen', 'IsEEA', 'SourceType', 'FirstSeenAt', 'IsVerified', 'VerifiedAt', 'VerifiedBy'], hidden: ['SourceType', 'FirstSeenAt', 'VerifiedAt', 'VerifiedBy'] },
  { slug: 'seed-versions', columns: ['Dataset', 'Version', 'AppliedAt'], hidden: [] },
  { slug: 'admin-audit-log', columns: ['Id', 'ActorId', 'ActorName', 'ActionUtc', 'Action', 'EntityType', 'EntityId', 'Summary', 'Before', 'After', 'TraceId'], hidden: [] },
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
    expect(await screen.findByRole('columnheader', { name: shown[0] })).toBeInTheDocument()
    expect(dataHeaders()).toEqual(shown)

    await user.click(screen.getByRole('button', { name: `Show ${hidden.length} hidden ${columnsWord(hidden.length)}` }))

    expect(dataHeaders()).toEqual(columns)
    expect(new URLSearchParams(router.state.location.search).get('columns')).toBe('all')

    await user.click(screen.getByRole('button', { name: `Hide ${hidden.length} ${columnsWord(hidden.length)}` }))

    expect(dataHeaders()).toEqual(shown)
    expect(new URLSearchParams(router.state.location.search).get('columns')).toBeNull()
  })

  it.each(withoutHidden)('$slug: has nothing hidden, so offers no toggle', async ({ slug, columns }) => {
    renderAt(`/data/${slug}`)
    expect(await screen.findByRole('columnheader', { name: columns[0] })).toBeInTheDocument()

    expect(dataHeaders()).toEqual(columns)
    expect(screen.queryByRole('button', { name: /hidden column|^Hide \d+ column|All columns/ })).not.toBeInTheDocument()
  })

  it('offers no toggle from a shared link on a table with nothing hidden', async () => {
    renderAt('/data/flight-statuses?columns=all')
    expect(await screen.findByRole('columnheader', { name: 'Code' })).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: /hidden column|^Hide \d+ column|All columns/ })).not.toBeInTheDocument()
  })

  it('offers no toggle on a page with no rows', async () => {
    empty = true
    renderAt('/data/airlines')
    expect(await screen.findByText('No results.')).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: /hidden column|^Hide \d+ column|All columns/ })).not.toBeInTheDocument()
  })
})
