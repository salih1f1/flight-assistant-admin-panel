import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { DataBrowserPage } from './DataBrowserPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

const pad = (n: number) => String(n).padStart(3, '0')

// Shaped like BrowsableTableDto.
const TABLES = [
  { slug: 'travelers', displayName: 'Travelers', rowCount: 120 },
  { slug: 'flight-statuses', displayName: 'Flight Statuses', rowCount: 1 },
]

// Shaped like GET /admin/data/travelers: PascalCase keys in the registry's column order,
// Email masked server-side (SensitiveProperties), nullable columns null.
type Row = Record<string, unknown>
const TRAVELERS: Row[] = Array.from({ length: 120 }, (_, i) => ({
  Id: `00000000-0000-0000-0000-000000000${pad(i + 1)}`,
  Email: '<redacted>',
  DisplayName: `Traveler ${pad(i + 1)}`,
  CreatedUtc: '2026-01-01T00:00:00Z',
  CreatedBy: null,
  UpdatedUtc: null,
  UpdatedBy: null,
}))
const FLIGHT_STATUSES: Row[] = [{ Id: 1, Code: 'SCH', Name: 'Scheduled', Description: null }]

// ValidationProblemDetails as GetBrowsableDataQueryValidator produces it: keyed by the rule's WithName.
const validationFailed = (field: 'sort' | 'filter', message: string) =>
  httpError(400, { title: 'Validation failed', status: 400, errors: { [field]: [message] } })

/** The data browser API: sorts and filters like the server, and rejects what the server rejects. */
function dataApi(req: SentRequest) {
  if (req.method !== 'GET') throw httpError(404)
  if (req.url === '/admin/data/tables') return TABLES
  const table = req.url.match(/^\/admin\/data\/([a-z-]+)$/)?.[1]
  const source = table === 'travelers' ? TRAVELERS : table === 'flight-statuses' ? FLIGHT_STATUSES : null
  if (!source) throw httpError(404, { title: `Unknown table '${table}'.`, status: 404 })

  let rows = [...source]
  const columns = Object.keys(source[0])
  const sort = req.params?.sort as string | undefined
  if (sort) {
    const column = sort.replace(/^-/, '')
    if (column === 'Email') throw validationFailed('sort', "Column 'Email' is sensitive and cannot be sorted on.")
    if (!columns.includes(column)) throw validationFailed('sort', `Unknown sort column '${column}'. Valid columns: ${columns.join(', ')}.`)
    rows.sort((a, b) => String(a[column]).localeCompare(String(b[column])))
    if (sort.startsWith('-')) rows.reverse()
  }
  const filter = req.params?.filter as string | undefined
  if (filter) {
    const [column, ...rest] = filter.split(':')
    const value = rest.join(':')
    if (column === 'Email') throw validationFailed('filter', "Column 'Email' is sensitive and cannot be filtered on.")
    rows = rows.filter(r => String(r[column] ?? '').toLowerCase().includes(value.toLowerCase()))
  }
  return pagedResult(rows, req.params)
}

let sent: SentRequest[]

function renderAt(entry: string) {
  const router = createMemoryRouter(
    [{ path: '/data/:table', element: <DataBrowserPage /> }],
    { initialEntries: [entry] },
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const lastDataRequest = () => [...sent].reverse().find(r => r.url.startsWith('/admin/data/') && r.url !== '/admin/data/tables')
const search = (router: ReturnType<typeof renderAt>) => new URLSearchParams(router.state.location.search)
const headers = () => screen.getAllByRole('columnheader').map(h => h.textContent?.replace(/[↑↓]/g, '').trim()).filter(Boolean)

describe('DataBrowserPage', () => {
  beforeEach(() => {
    ;({ sent } = installFakeApi(dataApi))
  })

  it("shows a table's first page under its name, with the API's columns in the API's order", async () => {
    renderAt('/data/travelers')

    expect(await screen.findByRole('heading', { level: 1, name: 'Travelers' })).toBeInTheDocument()
    expect(await screen.findByText('Traveler 001')).toBeInTheDocument()
    expect(screen.getByText('Traveler 050')).toBeInTheDocument()
    expect(screen.queryByText('Traveler 051')).not.toBeInTheDocument()
    expect(headers()).toEqual(['Id', 'Email', 'DisplayName', 'CreatedUtc', 'CreatedBy', 'UpdatedUtc', 'UpdatedBy'])
    expect(screen.getByText('Page 1 of 3 · 120 total')).toBeInTheDocument()
  })

  it('has no table list of its own: the side menu lists the tables', async () => {
    renderAt('/data/travelers')
    await screen.findByText('Traveler 001')

    expect(screen.queryByRole('link', { name: /Flight Statuses/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Data browser')).not.toBeInTheDocument()
  })

  it('links a table with a management page to it, current on Raw data', async () => {
    renderAt('/data/travelers')
    await screen.findByText('Traveler 001')

    const views = screen.getByRole('navigation', { name: 'Views' })
    expect(within(views).getByRole('link', { name: 'Manage' })).toHaveAttribute('href', '/travelers')
    expect(within(views).getByRole('link', { name: 'Raw data' })).toHaveAttribute('aria-current', 'page')
  })

  it('shows no Manage | Raw data tabs for a table with no management page', async () => {
    renderAt('/data/flight-statuses')
    await screen.findByText('Scheduled')

    expect(screen.queryByRole('navigation', { name: 'Views' })).not.toBeInTheDocument()
  })

  it('shows masked values as masked, never as the placeholder text', async () => {
    renderAt('/data/travelers')

    const row = (await screen.findByText('Traveler 001')).closest('tr')!
    expect(within(row).getByText('Masked')).toBeInTheDocument()
    expect(screen.queryByText('<redacted>')).not.toBeInTheDocument()
  })

  it('shows empty values as a dash', async () => {
    renderAt('/data/flight-statuses')

    const row = (await screen.findByText('Scheduled')).closest('tr')!
    expect(within(row).getAllByRole('cell').map(c => c.textContent)).toEqual(['1', 'SCH', 'Scheduled', '—'])
  })

  it('Next requests page 2 and keeps the page in the URL', async () => {
    const user = userEvent.setup()
    const router = renderAt('/data/travelers')
    await screen.findByText('Traveler 001')

    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Traveler 051')).toBeInTheDocument()
    expect(lastDataRequest()).toEqual(expect.objectContaining({ url: '/admin/data/travelers', params: { Page: 2, PageSize: 50 } }))
    expect(search(router).get('page')).toBe('2')
  })

  it('clicking a column header sorts by it, then descending, back on page 1', async () => {
    const user = userEvent.setup()
    const router = renderAt('/data/travelers?page=2')
    await screen.findByText('Traveler 051')

    await user.click(screen.getByRole('button', { name: /^DisplayName/ }))
    await waitFor(() => expect(lastDataRequest()?.params).toEqual({ Page: 1, PageSize: 50, sort: 'DisplayName' }))
    expect(await screen.findByText('Traveler 001')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^DisplayName/ }))
    expect(await screen.findByText('Traveler 120')).toBeInTheDocument()
    expect(lastDataRequest()?.params).toEqual({ Page: 1, PageSize: 50, sort: '-DisplayName' })
    expect(search(router).get('sort')).toBe('-DisplayName')
    expect(search(router).get('page')).toBeNull()
  })

  it('filters on a column and value, then clears the filter', async () => {
    const user = userEvent.setup()
    const router = renderAt('/data/travelers')
    await screen.findByText('Traveler 001')

    await user.selectOptions(screen.getByLabelText('Filter column'), 'DisplayName')
    await user.type(screen.getByLabelText('Filter value'), '042')
    await user.click(screen.getByRole('button', { name: 'Apply filter' }))

    expect(await screen.findByText('Page 1 of 1 · 1 total')).toBeInTheDocument()
    expect(screen.getByText('Traveler 042')).toBeInTheDocument()
    expect(lastDataRequest()?.params).toEqual({ Page: 1, PageSize: 50, filter: 'DisplayName:042' })
    expect(search(router).get('filter')).toBe('DisplayName:042')

    await user.click(screen.getByRole('button', { name: 'Clear filter' }))

    expect(await screen.findByText('Page 1 of 3 · 120 total')).toBeInTheDocument()
    expect(search(router).get('filter')).toBeNull()
  })

  it('sorting keeps a filter applied after the page loaded', async () => {
    const user = userEvent.setup()
    const router = renderAt('/data/travelers')
    await screen.findByText('Traveler 001')

    await user.selectOptions(screen.getByLabelText('Filter column'), 'DisplayName')
    await user.type(screen.getByLabelText('Filter value'), '04')
    await user.click(screen.getByRole('button', { name: 'Apply filter' }))
    // Contains "04": Traveler 004, 040-049 and 104.
    await screen.findByText('Page 1 of 1 · 12 total')

    await user.click(screen.getByRole('button', { name: /^DisplayName/ }))

    await waitFor(() => expect(lastDataRequest()?.params).toEqual({ Page: 1, PageSize: 50, sort: 'DisplayName', filter: 'DisplayName:04' }))
    expect(search(router).get('filter')).toBe('DisplayName:04')
    expect(search(router).get('sort')).toBe('DisplayName')
  })

  it('opens a shared link with its page, sort and filter', async () => {
    renderAt('/data/travelers?page=2&sort=-DisplayName&filter=DisplayName:Traveler')

    expect(await screen.findByText('Traveler 070')).toBeInTheDocument()
    expect(lastDataRequest()?.params).toEqual({ Page: 2, PageSize: 50, sort: '-DisplayName', filter: 'DisplayName:Traveler' })
  })

  it("shows the API's reason when it rejects a sort", async () => {
    renderAt('/data/travelers?sort=Email')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Validation failed')
    expect(alert).toHaveTextContent("Column 'Email' is sensitive and cannot be sorted on.")
  })

  it("shows the API's reason for a table that doesn't exist", async () => {
    renderAt('/data/nope')

    expect(await screen.findByRole('alert')).toHaveTextContent("Unknown table 'nope'.")
  })

  it('switching tables from the menu starts the new table on page 1 with no sort or filter', async () => {
    const router = renderAt('/data/travelers?page=2&sort=-DisplayName&filter=DisplayName:Traveler')
    await screen.findByText('Traveler 070')

    // The side menu links each table by its bare path.
    await act(() => router.navigate('/data/flight-statuses'))

    expect(await screen.findByText('Scheduled')).toBeInTheDocument()
    expect(lastDataRequest()).toEqual(expect.objectContaining({ url: '/admin/data/flight-statuses', params: { Page: 1, PageSize: 50 } }))
    expect(router.state.location.search).toBe('')
  })
})
