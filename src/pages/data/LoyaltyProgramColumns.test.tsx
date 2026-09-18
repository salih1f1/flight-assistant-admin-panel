import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AllianceName, LoyaltyProgramKindName } from '@/components/ReferenceNames'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { columnLabel } from './columnValue'
import { DataBrowserPage } from './DataBrowserPage'
import { RecordPage } from './RecordPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

const TABLES = [
  { slug: 'loyalty-programs', displayName: 'Loyalty Programs', rowCount: 4 },
  { slug: 'loyalty-program-kinds', displayName: 'Loyalty Program Kinds', rowCount: 1 },
]

type Row = Record<string, unknown>

/**
 * Four programs of the same kind (so the kinds list is fetched once for the grid), the third on an
 * alliance code no alliance carries, the fourth on a kind id no kind has and no alliance at all.
 */
const PROGRAMS: Row[] = [
  {
    Id: 1, Code: 'BA-EXEC', Name: 'British Airways Executive Club', KindId: 2, AirlineId: 242,
    AllianceCode: 'OW', CreatedUtc: '2026-09-01T10:00:00Z',
    IsVerified: false, VerifiedAt: null, VerifiedBy: null, VerificationSource: null, VerificationIssue: null,
  },
  {
    Id: 2, Code: 'DL-SKY', Name: 'Delta SkyMiles', KindId: 2, AirlineId: 242,
    AllianceCode: 'ST', CreatedUtc: '2026-09-01T10:00:00Z',
    IsVerified: false, VerifiedAt: null, VerifiedBy: null, VerificationSource: null, VerificationIssue: null,
  },
  {
    Id: 3, Code: 'XX-GONE', Name: 'Gone Airways Club', KindId: 2, AirlineId: 242,
    AllianceCode: 'ZZ', CreatedUtc: '2026-09-01T10:00:00Z',
    IsVerified: false, VerifiedAt: null, VerifiedBy: null, VerificationSource: null, VerificationIssue: null,
  },
  {
    Id: 4, Code: 'IC-CLUB', Name: 'Independent Club', KindId: 9, AirlineId: 242,
    AllianceCode: null, CreatedUtc: '2026-09-01T10:00:00Z',
    IsVerified: false, VerifiedAt: null, VerifiedBy: null, VerificationSource: null, VerificationIssue: null,
  },
]

const KINDS: Row[] = [{ Id: 2, Code: 'AIRLINE', Name: 'Airline programme', Description: null }]

// Shaped like AllianceAdminDto, as GET /admin/refdata/alliances returns it: a code and a name, no id.
const ALLIANCES = [{ code: 'OW', name: 'oneworld' }, { code: 'ST', name: 'SkyTeam' }]

const BA = { id: 242, iata: 'BA', icao: 'BAW', name: 'British Airways', countryCode: 'GB' }

const ROWS: Record<string, Row[]> = { 'loyalty-programs': PROGRAMS, 'loyalty-program-kinds': KINDS }

let sent: SentRequest[]

function install() {
  sent = installFakeApi(req => {
    if (req.method !== 'GET') throw httpError(405)
    if (req.url === '/admin/data/tables') return TABLES
    if (req.url === '/admin/refdata/alliances') return ALLIANCES
    if (req.url === '/admin/airlines/242') return BA
    const table = req.url.match(/^\/admin\/data\/([a-z-]+)$/)?.[1]
    if (table && ROWS[table]) {
      const filters = (req.params?.filter ?? []) as string[]
      const rows = filters.reduce((kept, filter) => {
        const [column, ...rest] = filter.split(':')
        return kept.filter(r => String(r[column]) === rest.join(':'))
      }, ROWS[table])
      return pagedResult(rows, req.params)
    }
    throw httpError(404)
  }).sent
}

function renderAt(entry: string) {
  const router = createMemoryRouter(
    [
      { path: '/data/:table', element: <DataBrowserPage /> },
      { path: '/data/:table/:id', element: <RecordPage /> },
    ],
    { initialEntries: [entry] },
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const dataHeaders = () => within(screen.getByRole('table'))
  .getAllByRole('columnheader')
  .map(h => h.querySelector('button')?.textContent?.replace(/[↑↓]/g, '').trim())
  .filter((name): name is string => !!name)

/** The record page's fields, as label → shown value. */
const fields = () => Object.fromEntries(
  screen.getAllByRole('term').map((dt, i) => [dt.textContent, screen.getAllByRole('definition')[i].textContent]),
)

/**
 * A loyalty program is stored as two ids and a code — its kind, its airline and its alliance — and
 * a grid of them said "KindId 1" and "AllianceCode OW" where a name belongs (#152).
 */
describe('A loyalty program', () => {
  beforeEach(install)

  it('names its kind in the grid, linked to the kind record', async () => {
    renderAt('/data/loyalty-programs')

    const kind = await screen.findAllByRole('link', { name: 'Airline programme' })
    expect(kind[0]).toHaveAttribute('href', '/data/loyalty-program-kinds/2')
  })

  it('asks for the kinds list once, however many programs the page holds', async () => {
    renderAt('/data/loyalty-programs')
    await screen.findAllByRole('link', { name: 'Airline programme' })

    expect(sent.filter(req => req.url === '/admin/data/loyalty-program-kinds')).toHaveLength(1)
  })

  /** The alliance list carries no id (AllianceAdminDto is a code and a name), so there is nothing to link to. */
  it('names its alliance, with the code it is stored as on hover', async () => {
    renderAt('/data/loyalty-programs')

    const alliance = await screen.findByText('oneworld')
    expect(alliance).toHaveAttribute('title', 'OW')
    expect(alliance.closest('a')).toBeNull()
  })

  it('keeps an alliance code no alliance carries visible, saying so', async () => {
    renderAt('/data/loyalty-programs')

    expect(await screen.findByText('ZZ, not found')).toBeInTheDocument()
  })

  /** The list answered and the kind is not in it: the id stays on screen saying what happened. */
  it('says so when a kind id names no kind', async () => {
    renderAt('/data/loyalty-programs')

    expect(await screen.findByText('#9, not found')).toBeInTheDocument()
  })

  it('shows a program with no alliance as a dash, asking nothing of the list', async () => {
    renderAt('/data/loyalty-programs')
    const row = (await screen.findByText('Independent Club')).closest('tr')!

    expect(within(row).getByText('—')).toBeInTheDocument()
  })

  it('heads those columns by what they hold, not by how they are stored', async () => {
    renderAt('/data/loyalty-programs')
    await screen.findByText('British Airways Executive Club')

    expect(dataHeaders()).toEqual(['Code', 'Name', 'Kind', 'Airline', 'Alliance'])
  })

  /** Sorting still sends the raw column name: the header is a label, not a new sort key. */
  it('still sorts the kind column by the id the API orders on', async () => {
    const user = userEvent.setup()
    const router = renderAt('/data/loyalty-programs')
    await screen.findByText('British Airways Executive Club')

    await user.click(screen.getByRole('button', { name: 'Kind' }))

    expect(new URLSearchParams(router.state.location.search).get('sort')).toBe('KindId')
  })

  it('names the kind and the alliance on the record page too', async () => {
    renderAt('/data/loyalty-programs/1')
    // The last of the three lookups to answer; until then the fields still read as their ids.
    await screen.findByRole('link', { name: 'British Airways (BA)' })

    expect(fields()).toMatchObject({ Kind: 'Airline programme', Alliance: 'oneworld', Airline: 'British Airways (BA)' })
  })

  /** Hidden in the grid only: the record is where every column is spelled out. */
  it('still shows its id and creation stamp on the record page', async () => {
    renderAt('/data/loyalty-programs/1')
    await screen.findByRole('heading', { name: 'British Airways Executive Club' })

    expect(fields()).toMatchObject({ Id: '1', CreatedUtc: '2026-09-01 10:00 UTC' })
  })
})

/**
 * The two lookups on their own. Both are exported taking a nullable id or code, and both grids and
 * record pages happen to answer an empty value before ever asking them — so nothing above reaches
 * the guard that says an empty reference is a dash rather than a lookup that finds nothing.
 */
describe('A reference with nothing to look up', () => {
  beforeEach(install)

  const renderAlone = (element: ReactNode) => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{element}</MemoryRouter>
    </QueryClientProvider>,
  )

  it('shows a program with no kind as a dash', () => {
    renderAlone(<LoyaltyProgramKindName id={null} />)

    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('shows a program with no alliance as a dash', () => {
    renderAlone(<AllianceName code={null} />)

    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

/**
 * Column names arrive from the API as keys of a row object, so a column named `constructor` would
 * find Object.prototype's own — a function, which React renders by throwing. columnLabel reads its
 * map as a map, which is what keeps a header a header.
 */
describe('A column named like a property of Object', () => {
  it('is headed by its own name', () => {
    expect(columnLabel('constructor')).toBe('constructor')
    expect(columnLabel('KindId')).toBe('Kind')
  })
})
