import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { DataBrowserPage, DataBrowserRoute } from './DataBrowserPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

const pad = (n: number) => String(n).padStart(3, '0')

type Row = Record<string, unknown>

// Shaped like BrowsableTableDto, columns and all (#451). flight-statuses deliberately publishes
// none: that is the shape an API predating the metadata sends, and the form must still work.
const column = (name: string, kind: string, values: string[] | null = null) => ({ name, kind, values })
const TABLES = [
  {
    slug: 'travelers',
    displayName: 'Travelers',
    rowCount: 120,
    columns: [
      column('Id', 'Guid'), column('Email', 'Text'), column('DisplayName', 'Text'),
      column('CreatedUtc', 'Date'), column('UpdatedUtc', 'Date'),
    ],
  },
  { slug: 'flight-statuses', displayName: 'Flight Statuses', rowCount: 1 },
  {
    slug: 'airports',
    displayName: 'Airports',
    rowCount: 2,
    columns: [column('Iata', 'Text'), column('Name', 'Text'), column('IsVerified', 'Bool')],
  },
  {
    slug: 'admin-audit-log',
    displayName: 'Audit Log',
    rowCount: 1,
    columns: [column('OccurredUtc', 'Date'), column('Action', 'Enum', ['Create', 'Update', 'Delete'])],
  },
  {
    slug: 'verification-requests',
    displayName: 'Verification Requests',
    rowCount: 2,
    columns: [
      column('Id', 'Number'), column('EntityKey', 'Text'),
      column('Status', 'Enum', ['Pending', 'Running', 'Mismatch', 'Verified', 'Error']),
      column('RequestedUtc', 'Date'), column('SourceValuesJson', 'Unsupported'),
    ],
  },
]

const AIRPORTS: Row[] = [
  { Iata: 'IST', Name: 'Istanbul', IsVerified: true },
  { Iata: 'JFK', Name: 'John F. Kennedy', IsVerified: false },
]

const AUDIT: Row[] = [{ OccurredUtc: '2026-09-18T09:00:00Z', Action: 'Update' }]

const VERIFICATION_REQUESTS: Row[] = [
  { Id: 1, EntityKey: 'IST', Status: 'Pending', RequestedUtc: '2026-09-18T09:00:00Z', SourceValuesJson: null },
  { Id: 2, EntityKey: 'JFK', Status: 'Error', RequestedUtc: '2026-09-17T09:00:00Z', SourceValuesJson: null },
]

// Shaped like GET /admin/data/travelers: PascalCase keys in the registry's column order,
// Email masked server-side (SensitiveProperties), nullable columns null.
const TRAVELERS: Row[] = Array.from({ length: 120 }, (_, i) => ({
  Id: `00000000-0000-0000-0000-000000000${pad(i + 1)}`,
  Email: '<redacted>',
  DisplayName: `Traveler ${pad(i + 1)}`,
  CreatedUtc: '2026-01-01T00:00:00Z',
  UpdatedUtc: null,
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
  const source = table === 'travelers' ? TRAVELERS
    : table === 'flight-statuses' ? FLIGHT_STATUSES
      : table === 'verification-requests' ? VERIFICATION_REQUESTS
        : table === 'airports' ? AIRPORTS
          : table === 'admin-audit-log' ? AUDIT : null
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
  // `filter` arrives repeated and the criteria AND, exactly as the API applies them (#146).
  for (const filter of (req.params?.filter ?? []) as string[]) {
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

/** The route as the router mounts it, which is what decides whether a table change remounts. */
function renderRoute(entry: string) {
  const router = createMemoryRouter(
    [{ path: '/data/:table', element: <DataBrowserRoute /> }],
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

/** How many placeholder cells each placeholder row is holding open, row by row. */
const placeholderRows = () =>
  [...document.querySelectorAll('[data-skeleton-row]')].map(row => row.querySelectorAll('[data-skeleton-cell]').length)

/** The data browser with its rows held back, so the page can be looked at mid-load. */
function gateTheRows() {
  let release: () => void = () => {}
  const arrived = new Promise<void>(resolve => { release = resolve })
  ;({ sent } = installFakeApi(async req => {
    if (req.url !== '/admin/data/tables') await arrived
    return dataApi(req)
  }))
  return { deliver: async () => { await act(async () => { release(); await arrived }) } }
}

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
    // Email is masked on every row, so it starts hidden.
    expect(headers()).toEqual(['Id', 'DisplayName', 'CreatedUtc', 'UpdatedUtc'])
    expect(screen.getByText('Page 1 of 3 · 120 total')).toBeInTheDocument()
  })

  it('has no table list of its own: the side menu lists the tables', async () => {
    renderAt('/data/travelers')
    await screen.findByText('Traveler 001')

    expect(screen.queryByRole('link', { name: /Flight Statuses/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Data browser')).not.toBeInTheDocument()
  })

  it('showing hidden columns puts them in their place, keeping the choice in the URL', async () => {
    const user = userEvent.setup()
    const router = renderAt('/data/travelers')
    await screen.findByText('Traveler 001')

    await user.click(screen.getByRole('button', { name: 'Show 1 hidden column' }))

    expect(headers()).toEqual(['Id', 'Email', 'DisplayName', 'CreatedUtc', 'UpdatedUtc'])
    expect(search(router).get('columns')).toBe('all')

    await user.click(screen.getByRole('button', { name: 'Hide 1 column' }))

    expect(headers()).toEqual(['Id', 'DisplayName', 'CreatedUtc', 'UpdatedUtc'])
    expect(search(router).get('columns')).toBeNull()
  })

  it('keeps All columns while paging, and opens with it from a shared link', async () => {
    const user = userEvent.setup()
    const router = renderAt('/data/travelers?columns=all')
    await screen.findByText('Traveler 001')

    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Traveler 051')).toBeInTheDocument()
    expect(headers()).toContain('Email')
    expect(search(router).get('columns')).toBe('all')
  })

  it('still offers hidden columns to filter on', async () => {
    renderAt('/data/travelers')
    await screen.findByText('Traveler 001')

    const options = within(screen.getByLabelText('Filter column')).getAllByRole('option').map(o => o.textContent)
    expect(options).toEqual(expect.arrayContaining(['Email']))
  })

  it('has no Manage | Raw data tabs: the grid is the only list', async () => {
    renderAt('/data/travelers')
    await screen.findByText('Traveler 001')

    expect(screen.queryByRole('navigation', { name: 'Views' })).not.toBeInTheDocument()
  })

  it("each row's eye opens it: a traveler on its own detail page", async () => {
    renderAt('/data/travelers')

    const row = (await screen.findByText('Traveler 001')).closest('tr')!
    expect(within(row).getByRole('link', { name: 'Open record' })).toHaveAttribute('href', `/travelers/${TRAVELERS[0].Id}`)
  })

  it("each row's eye opens it: other tables on the record page", async () => {
    renderAt('/data/flight-statuses')

    const row = (await screen.findByText('Scheduled')).closest('tr')!
    expect(within(row).getByRole('link', { name: 'Open record' })).toHaveAttribute('href', '/data/flight-statuses/1')
  })

  it('shows masked values as masked, never as the placeholder text', async () => {
    // Email is masked on every row, so it's only in the grid with All columns.
    renderAt('/data/travelers?columns=all')

    const row = (await screen.findByText('Traveler 001')).closest('tr')!
    expect(within(row).getByText('Masked')).toBeInTheDocument()
    expect(screen.queryByText('<redacted>')).not.toBeInTheDocument()
  })

  it('shows empty values as a dash', async () => {
    renderAt('/data/flight-statuses')

    const row = (await screen.findByText('Scheduled')).closest('tr')!
    // The last cell is the row's Open link, which has no text.
    expect(within(row).getAllByRole('cell').map(c => c.textContent)).toEqual(['1', 'SCH', 'Scheduled', '—', ''])
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

  it('adds a criterion, then removes it again', async () => {
    const user = userEvent.setup()
    const router = renderAt('/data/travelers')
    await screen.findByText('Traveler 001')

    await user.selectOptions(screen.getByLabelText('Filter column'), 'DisplayName')
    await user.type(screen.getByLabelText('Filter value'), '042')
    await user.click(screen.getByRole('button', { name: 'Add filter' }))

    expect(await screen.findByText('Page 1 of 1 · 1 total')).toBeInTheDocument()
    expect(screen.getByText('Traveler 042')).toBeInTheDocument()
    expect(lastDataRequest()?.params).toEqual({ Page: 1, PageSize: 50, filter: ['DisplayName:042'] })
    expect(search(router).getAll('filter')).toEqual(['DisplayName:042'])

    await user.click(screen.getByRole('button', { name: 'Remove filter DisplayName: 042' }))

    expect(await screen.findByText('Page 1 of 3 · 120 total')).toBeInTheDocument()
    expect(search(router).getAll('filter')).toEqual([])
  })

  it('adds a second criterion instead of replacing the first', async () => {
    const user = userEvent.setup()
    const router = renderAt('/data/travelers')
    await screen.findByText('Traveler 001')

    await user.selectOptions(screen.getByLabelText('Filter column'), 'DisplayName')
    await user.type(screen.getByLabelText('Filter value'), '04')
    await user.click(screen.getByRole('button', { name: 'Add filter' }))
    await screen.findByText('DisplayName: 04')

    await user.selectOptions(screen.getByLabelText('Filter column'), 'DisplayName')
    await user.type(screen.getByLabelText('Filter value'), '2')
    await user.click(screen.getByRole('button', { name: 'Add filter' }))

    await waitFor(() => expect(lastDataRequest()?.params)
      .toEqual({ Page: 1, PageSize: 50, filter: ['DisplayName:04', 'DisplayName:2'] }))
    expect(search(router).getAll('filter')).toEqual(['DisplayName:04', 'DisplayName:2'])
    expect(await screen.findByText('Traveler 042')).toBeInTheDocument()
  })

  it('removes one criterion and leaves the others applied', async () => {
    const user = userEvent.setup()
    const router = renderAt('/data/travelers?filter=DisplayName%3A04&filter=DisplayName%3A2')
    await screen.findByText('Traveler 042')

    await user.click(screen.getByRole('button', { name: 'Remove filter DisplayName: 2' }))

    await waitFor(() => expect(search(router).getAll('filter')).toEqual(['DisplayName:04']))
    expect(screen.getByText('DisplayName: 04')).toBeInTheDocument()
    expect(screen.queryByText('DisplayName: 2')).not.toBeInTheDocument()
  })

  it('clears every criterion at once', async () => {
    const user = userEvent.setup()
    const router = renderAt('/data/travelers?filter=DisplayName%3A04&filter=DisplayName%3A2')
    await screen.findByText('Traveler 042')

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    expect(await screen.findByText('Page 1 of 3 · 120 total')).toBeInTheDocument()
    expect(search(router).getAll('filter')).toEqual([])
  })

  it('does not add a criterion that is already applied', async () => {
    const user = userEvent.setup()
    const router = renderAt('/data/travelers?filter=DisplayName%3A042')
    await screen.findByText('Traveler 042')

    await user.selectOptions(screen.getByLabelText('Filter column'), 'DisplayName')
    await user.type(screen.getByLabelText('Filter value'), '042')
    await user.click(screen.getByRole('button', { name: 'Add filter' }))

    expect(search(router).getAll('filter')).toEqual(['DisplayName:042'])
    expect(screen.getAllByText('DisplayName: 042')).toHaveLength(1)
  })

  it('shows a date criterion the way its comparison picker words it', async () => {
    renderAt('/data/admin-audit-log?filter=OccurredUtc%3A%3E%3D2026-09-18')
    expect(await screen.findByText('OccurredUtc: on or after 2026-09-18')).toBeInTheDocument()
  })

  /** Every dashboard tile, the pending-queue link and the detail-page links build exactly this. */
  it('still filters from a link carrying a single filter', async () => {
    renderAt('/data/travelers?filter=DisplayName%3A042')

    expect(await screen.findByText('Traveler 042')).toBeInTheDocument()
    expect(screen.getByText('DisplayName: 042')).toBeInTheDocument()
    expect(lastDataRequest()?.params).toEqual({ Page: 1, PageSize: 50, filter: ['DisplayName:042'] })
  })

  // ── Filter controls from the published kinds (#94) ─────────────────────────

  it('offers an enum column its published values to pick from, instead of a text box', async () => {
    const user = userEvent.setup()
    renderAt('/data/verification-requests')
    await screen.findByText('IST')

    await user.selectOptions(screen.getByLabelText('Filter column'), 'Status')

    const value = screen.getByLabelText('Filter value')
    expect(value.tagName).toBe('SELECT')
    expect(within(value).getAllByRole('option').map(o => o.textContent))
      .toEqual(['Pending', 'Running', 'Mismatch', 'Verified', 'Error'])

    await user.selectOptions(value, 'Error')
    await user.click(screen.getByRole('button', { name: 'Add filter' }))

    await waitFor(() => expect(lastDataRequest()?.params).toEqual({ Page: 1, PageSize: 50, filter: ['Status:Error'] }))
  })

  it('filters a date column on or after a date by default, and exactly when asked', async () => {
    const user = userEvent.setup()
    renderAt('/data/verification-requests')
    await screen.findByText('IST')

    await user.selectOptions(screen.getByLabelText('Filter column'), 'RequestedUtc')
    // An exact match on a timestamp almost never matches, so the useful default leads.
    expect((screen.getByLabelText('Filter value') as HTMLInputElement).type).toBe('date')
    expect((screen.getByLabelText('Date comparison') as HTMLSelectElement).value).toBe('gte')

    await user.type(screen.getByLabelText('Filter value'), '2026-09-18')
    await user.click(screen.getByRole('button', { name: 'Add filter' }))
    await waitFor(() => expect(lastDataRequest()?.params).toEqual({ Page: 1, PageSize: 50, filter: ['RequestedUtc:>=2026-09-18'] }))

    // A second criterion, asked for exactly: the form adds, so the first one stays applied and the
    // comparison resets to the default with the value it was added with.
    await user.click(screen.getByRole('button', { name: 'Remove filter RequestedUtc: on or after 2026-09-18' }))
    await user.selectOptions(screen.getByLabelText('Filter column'), 'RequestedUtc')
    await user.selectOptions(screen.getByLabelText('Date comparison'), 'exact')
    await user.type(screen.getByLabelText('Filter value'), '2026-09-18')
    await user.click(screen.getByRole('button', { name: 'Add filter' }))
    await waitFor(() => expect(lastDataRequest()?.params).toEqual({ Page: 1, PageSize: 50, filter: ['RequestedUtc:2026-09-18'] }))
  })

  /** The default has to hold on arrival, not only after the column picker is touched: a date column
   *  that is already selected is the first thing an admin sees on these tables. */
  it('leads with "on or after" for a date column selected on arrival', async () => {
    renderAt('/data/admin-audit-log')
    await screen.findByText('Update')

    expect((screen.getByLabelText('Date comparison') as HTMLSelectElement).value).toBe('gte')
  })

  /**
   * An applied exact-date criterion must not read as "on or after": the chip says what is actually
   * filtered on, and the two match very different sets of rows. The form itself no longer mirrors
   * an applied criterion — it is the row that adds the next one.
   */
  it('shows an exact date criterion as the exact date', async () => {
    renderAt('/data/admin-audit-log?filter=OccurredUtc%3A2026-09-18')
    await screen.findByText('Update')

    expect(screen.getByText('OccurredUtc: 2026-09-18')).toBeInTheDocument()
    expect(screen.queryByText('OccurredUtc: on or after 2026-09-18')).not.toBeInTheDocument()
  })

  it('offers true and false for a bool column', async () => {
    const user = userEvent.setup()
    renderAt('/data/airports')
    await screen.findByText('Istanbul')

    await user.selectOptions(screen.getByLabelText('Filter column'), 'IsVerified')

    const value = screen.getByLabelText('Filter value')
    expect(within(value).getAllByRole('option').map(o => o.textContent)).toEqual(['true', 'false'])

    await user.selectOptions(value, 'false')
    await user.click(screen.getByRole('button', { name: 'Add filter' }))

    await waitFor(() => expect(lastDataRequest()?.params).toEqual({ Page: 1, PageSize: 50, filter: ['IsVerified:false'] }))
  })

  it('cannot filter a column the API says it cannot, and says so', async () => {
    const user = userEvent.setup()
    renderAt('/data/verification-requests')
    await screen.findByText('IST')

    await user.selectOptions(screen.getByLabelText('Filter column'), 'SourceValuesJson')

    expect(screen.queryByLabelText('Filter value')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add filter' })).toBeDisabled()
    expect(screen.getByText("This column can't be filtered.")).toBeInTheDocument()
  })

  it('takes the column list from the published columns, not the rows on screen', async () => {
    renderAt('/data/verification-requests')
    await screen.findByText('IST')

    expect(within(screen.getByLabelText('Filter column')).getAllByRole('option').map(o => o.textContent))
      .toEqual(['Id', 'EntityKey', 'Status', 'RequestedUtc', 'SourceValuesJson'])
  })

  /** An API predating #451 publishes no columns: the form keeps inferring names from the rows and
   *  offering a free-text value, exactly as it did before kinds existed. */
  it('falls back to inferred names and a text box for a table that publishes no columns', async () => {
    const user = userEvent.setup()
    renderAt('/data/flight-statuses')
    await screen.findByText('Scheduled')

    expect(within(screen.getByLabelText('Filter column')).getAllByRole('option').map(o => o.textContent))
      .toEqual(['Id', 'Code', 'Name', 'Description'])

    await user.selectOptions(screen.getByLabelText('Filter column'), 'Code')
    const value = screen.getByLabelText('Filter value')
    expect(value.tagName).toBe('INPUT')
    expect((value as HTMLInputElement).type).toBe('text')
  })

  it('sorting keeps a filter applied after the page loaded', async () => {
    const user = userEvent.setup()
    const router = renderAt('/data/travelers')
    await screen.findByText('Traveler 001')

    await user.selectOptions(screen.getByLabelText('Filter column'), 'DisplayName')
    await user.type(screen.getByLabelText('Filter value'), '04')
    await user.click(screen.getByRole('button', { name: 'Add filter' }))
    // Contains "04": Traveler 004, 040-049 and 104.
    await screen.findByText('Page 1 of 1 · 12 total')

    await user.click(screen.getByRole('button', { name: /^DisplayName/ }))

    await waitFor(() => expect(lastDataRequest()?.params).toEqual({ Page: 1, PageSize: 50, sort: 'DisplayName', filter: ['DisplayName:04'] }))
    expect(search(router).get('filter')).toBe('DisplayName:04')
    expect(search(router).get('sort')).toBe('DisplayName')
  })

  it('opens a shared link with its page, sort and filter', async () => {
    renderAt('/data/travelers?page=2&sort=-DisplayName&filter=DisplayName:Traveler')

    expect(await screen.findByText('Traveler 070')).toBeInTheDocument()
    expect(lastDataRequest()?.params).toEqual({ Page: 2, PageSize: 50, sort: '-DisplayName', filter: ['DisplayName:Traveler'] })
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

  it('holds the grid open with placeholder rows while a table loads', async () => {
    const { deliver } = gateTheRows()

    renderAt('/data/airports')

    expect(await screen.findByRole('status')).toHaveTextContent('Loading rows…')
    // As wide as the table the API published: Iata, Name, IsVerified — settled once
    // /admin/data/tables has answered, which it does while the rows are still on their way.
    await waitFor(() => {
      const placeholders = placeholderRows()
      expect(placeholders.length).toBeGreaterThan(0)
      expect(placeholders.every(cells => cells === 3)).toBe(true)
    })

    await deliver()

    expect(await screen.findByText('Istanbul')).toBeInTheDocument()
    expect(placeholderRows()).toEqual([])
  })

  it('still holds the grid open for a table whose columns the API does not publish', async () => {
    gateTheRows()

    renderAt('/data/flight-statuses')

    expect(await screen.findByRole('status')).toHaveTextContent('Loading rows…')
    expect(placeholderRows().length).toBeGreaterThan(0)
  })

  it('gives each table a fresh grid, carrying nothing of the last one over', async () => {
    const user = userEvent.setup()
    const router = renderRoute('/data/travelers')
    await screen.findByText('Traveler 001')
    // A confirmation raised against one table's row means nothing on the next table.
    await user.click(screen.getAllByRole('button', { name: 'Delete record' })[0])
    expect(await screen.findByRole('dialog')).toHaveTextContent('Delete traveler')

    await act(() => router.navigate('/data/airports'))

    expect(await screen.findByText('Istanbul')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
