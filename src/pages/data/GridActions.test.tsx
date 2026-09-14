import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { DataBrowserPage } from './DataBrowserPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

const TABLES = [
  { slug: 'airlines', displayName: 'Airlines', rowCount: 2 },
  { slug: 'flights', displayName: 'Flights', rowCount: 2 },
  { slug: 'travelers', displayName: 'Travelers', rowCount: 1 },
  { slug: 'device-tokens', displayName: 'Device Tokens', rowCount: 1 },
  { slug: 'flight-statuses', displayName: 'Flight Statuses', rowCount: 1 },
]

type Row = Record<string, unknown>

const TRAVELER_ID = '00000000-0000-0000-0000-000000000001'
const TOKEN_ID = '00000000-0000-0000-0000-0000000000aa'

// Raw rows (GET /admin/data/{table}), trimmed to a few columns each.
let rows: Record<string, Row[]>
const makeRows = (): Record<string, Row[]> => ({
  airlines: [
    { Id: 7, Iata: 'TK', Name: 'Turkish Airlines', CountryCode: 'TR' },
    { Id: 8, Iata: 'BA', Name: 'British Airways', CountryCode: 'GB' },
  ],
  flights: [
    { Id: 1, FlightNumber: 'FA001', ActualDepartureUtc: null },
    { Id: 2, FlightNumber: 'FA002', ActualDepartureUtc: null },
  ],
  travelers: [{ Id: TRAVELER_ID, DisplayName: 'Ann Example' }],
  'device-tokens': [{ Id: TOKEN_ID, TravelerId: TRAVELER_ID, Platform: 'ios' }],
  'flight-statuses': [{ Id: 1, Code: 'SCH', Name: 'Scheduled' }],
})

let sent: SentRequest[]
let failWith: ((req: SentRequest) => never) | undefined

/** The raw grid's API, plus the typed delete and sync routes the row actions call. */
function api(req: SentRequest) {
  if (failWith && req.method !== 'GET') failWith(req)
  if (req.method === 'GET' && req.url === '/admin/data/tables') return TABLES
  const table = req.url.match(/^\/admin\/data\/([a-z-]+)$/)?.[1]
  if (req.method === 'GET' && table && rows[table]) return pagedResult(rows[table], req.params)
  const drop = (slug: string, id: unknown) => { rows[slug] = rows[slug].filter(r => r.Id !== id) }
  let m
  if (req.method === 'DELETE' && (m = req.url.match(/^\/admin\/airlines\/(\d+)$/))) return drop('airlines', Number(m[1]))
  if (req.method === 'DELETE' && (m = req.url.match(/^\/admin\/travelers\/([^/]+)\/device-tokens\/([^/]+)$/))) return drop('device-tokens', m[2])
  if (req.method === 'DELETE' && (m = req.url.match(/^\/admin\/travelers\/([^/]+)$/))) return drop('travelers', m[1])
  if (req.method === 'POST' && (m = req.url.match(/^\/admin\/flights\/(\d+)\/sync$/))) {
    const id = Number(m[1])
    // Syncing pulls the latest status from the provider; here the flight has departed.
    rows.flights = rows.flights.map(f => (f.Id === id ? { ...f, ActualDepartureUtc: '2026-09-13T10:05:00Z' } : f))
    return undefined
  }
  throw httpError(404)
}

/** staleTime Infinity, like the app's long staleTime: rows only change on screen if an action refreshed them. */
function renderAt(entry: string) {
  const router = createMemoryRouter([{ path: '/data/:table', element: <DataBrowserPage /> }], { initialEntries: [entry] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const rowOf = async (text: string) => (await screen.findByText(text)).closest('tr')!
const writes = () => sent.filter(r => r.method !== 'GET')

describe('DataBrowserPage row actions', () => {
  beforeEach(() => {
    rows = makeRows()
    failWith = undefined
    ;({ sent } = installFakeApi(api))
  })

  it('an editable table offers Add, and Edit on each row opening the record in Edit', async () => {
    renderAt('/data/airlines')

    const row = await rowOf('Turkish Airlines')
    expect(within(row).getByRole('link', { name: 'Edit record' })).toHaveAttribute('href', '/data/airlines/7?mode=edit')
    expect(within(row).getByRole('link', { name: 'Open record' })).toHaveAttribute('href', '/data/airlines/7')
    expect(screen.getByRole('link', { name: 'Add airline' })).toHaveAttribute('href', '/airlines/new')
  })

  it('a read-only table offers only Open', async () => {
    renderAt('/data/flight-statuses')

    const row = await rowOf('Scheduled')
    expect(within(row).getByRole('link', { name: 'Open record' })).toBeInTheDocument()
    for (const name of ['Edit record', 'Delete record', 'Sync status']) {
      expect(within(row).queryByRole('link', { name })).not.toBeInTheDocument()
      expect(within(row).queryByRole('button', { name })).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('link', { name: /^Add / })).not.toBeInTheDocument()
  })

  it('Delete asks first, then sends DELETE and drops the row without a reload', async () => {
    const user = userEvent.setup()
    renderAt('/data/airlines')

    await user.click(within(await rowOf('British Airways')).getByRole('button', { name: 'Delete record' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Delete airline')
    expect(dialog).toHaveTextContent('Cannot delete if flights reference this airline.')
    expect(writes()).toEqual([])

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByText('British Airways')).not.toBeInTheDocument())
    expect(screen.getByText('Turkish Airlines')).toBeInTheDocument()
    expect(writes()).toEqual([expect.objectContaining({ method: 'DELETE', url: '/admin/airlines/8' })])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Cancel in the delete dialog sends nothing', async () => {
    const user = userEvent.setup()
    renderAt('/data/airlines')

    await user.click(within(await rowOf('British Airways')).getByRole('button', { name: 'Delete record' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(writes()).toEqual([])
    expect(screen.getByText('British Airways')).toBeInTheDocument()
  })

  it("a failed delete shows the API's reason and keeps the row", async () => {
    const user = userEvent.setup()
    failWith = () => { throw httpError(409, { title: 'Airline 8 is referenced by flights.', status: 409 }) }
    renderAt('/data/airlines')

    await user.click(within(await rowOf('British Airways')).getByRole('button', { name: 'Delete record' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't delete airline 8: Airline 8 is referenced by flights.")
    expect(screen.getByText('British Airways')).toBeInTheDocument()
  })

  it('deletes a traveler by its id', async () => {
    const user = userEvent.setup()
    renderAt('/data/travelers')

    await user.click(within(await rowOf('Ann Example')).getByRole('button', { name: 'Delete record' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByText('Ann Example')).not.toBeInTheDocument())
    expect(writes()).toEqual([expect.objectContaining({ method: 'DELETE', url: `/admin/travelers/${TRAVELER_ID}` })])
  })

  it('deletes a device token under its traveler', async () => {
    const user = userEvent.setup()
    renderAt('/data/device-tokens')

    await user.click(within(await rowOf('ios')).getByRole('button', { name: 'Delete record' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByText('ios')).not.toBeInTheDocument())
    expect(writes()).toEqual([expect.objectContaining({ method: 'DELETE', url: `/admin/travelers/${TRAVELER_ID}/device-tokens/${TOKEN_ID}` })])
  })

  it('Sync status sends POST .../sync and shows the new status without a reload', async () => {
    const user = userEvent.setup()
    renderAt('/data/flights')

    await user.click(within(await rowOf('FA002')).getByRole('button', { name: 'Sync status' }))

    await waitFor(() => expect(screen.getByText('FA002').closest('tr')).toHaveTextContent('2026-09-13T10:05:00Z'))
    expect(writes()).toEqual([expect.objectContaining({ method: 'POST', url: '/admin/flights/2/sync' })])
    expect(screen.getByText('FA001').closest('tr')).not.toHaveTextContent('2026-09-13T10:05:00Z')
  })

  it("shows the API's reason when a sync fails", async () => {
    const user = userEvent.setup()
    // As the API answers when AeroAPI rejects the lookup (GlobalExceptionHandler, outside Production).
    failWith = () => {
      throw httpError(400, { title: 'The flight status request was rejected.', status: 400, detail: 'AeroAPI returned HTTP 400: invalid ident' })
    }
    renderAt('/data/flights')

    await user.click(within(await rowOf('FA002')).getByRole('button', { name: 'Sync status' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not sync FA002: The flight status request was rejected.')
    expect(alert).toHaveTextContent('AeroAPI returned HTTP 400: invalid ident')
  })

  it('falls back to the error message when a failed sync has no problem details', async () => {
    const user = userEvent.setup()
    failWith = () => { throw httpError(502) }
    renderAt('/data/flights')

    await user.click(within(await rowOf('FA001')).getByRole('button', { name: 'Sync status' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not sync FA001: Request failed with status code 502')
  })
})
