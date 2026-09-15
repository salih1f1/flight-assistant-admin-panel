import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readBlobText } from '@/lib/readBlobText'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { DataBrowserPage } from './DataBrowserPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

// countries is verifiable, so GET /admin/export/countries exists; flight-statuses isn't.
const TABLES = [
  { slug: 'countries', displayName: 'Countries', rowCount: 1 },
  { slug: 'flight-statuses', displayName: 'Flight Statuses', rowCount: 1 },
]
const CSV = 'Code,Name\nDE,Germany\n'

let sent: SentRequest[]
let exportAnswer: () => unknown
let downloads: { href: string; download: string }[]
let revoked: string[]

function install() {
  ;({ sent } = installFakeApi(req => {
    if (req.method === 'GET' && req.url === '/admin/data/tables') return TABLES
    if (req.method === 'GET' && req.url === '/admin/data/countries') {
      return pagedResult(
        [{ Code: 'DE', Name: 'Germany', IsVerified: true, VerifiedAt: null, VerifiedBy: null, VerificationSource: 'manual', VerificationIssue: null }],
        req.params,
      )
    }
    if (req.method === 'GET' && req.url === '/admin/data/flight-statuses') return pagedResult([{ Id: 1, Code: 'SCH', Name: 'Scheduled', Description: null }], req.params)
    // Results.File(..., "text/csv", "countries-export.csv"); axios hands a blob request a Blob.
    if (req.method === 'GET' && req.url === '/admin/export/countries') return exportAnswer()
    throw httpError(404)
  }))
}

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
}

describe('DataBrowserPage export', () => {
  beforeEach(() => {
    exportAnswer = () => new Blob([CSV], { type: 'text/csv' })
    install()
    downloads = []
    revoked = []
    // jsdom has no object URLs and doesn't navigate on click; record what would be downloaded.
    URL.createObjectURL = vi.fn(() => 'blob:export-1')
    URL.revokeObjectURL = vi.fn((url: string) => { revoked.push(url) })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ href: this.getAttribute('href') ?? '', download: this.download })
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('says the export holds verified rows only', async () => {
    renderAt('/data/countries')

    expect(await screen.findByRole('button', { name: 'Export verified CSV' })).toBeInTheDocument()
  })

  it("downloads the table's CSV under the API's file name", async () => {
    const user = userEvent.setup()
    renderAt('/data/countries')

    await user.click(await screen.findByRole('button', { name: 'Export verified CSV' }))

    await waitFor(() => expect(downloads).toEqual([{ href: 'blob:export-1', download: 'countries-export.csv' }]))
    expect(sent).toContainEqual(expect.objectContaining({ method: 'GET', url: '/admin/export/countries', responseType: 'blob' }))
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    expect(await readBlobText(blob)).toBe(CSV)
    // The object URL is released once the download has started (on the next tick).
    await waitFor(() => expect(revoked).toEqual(['blob:export-1']))
  })

  it("shows the API's reason when the export fails", async () => {
    // With responseType 'blob', axios hands back an error body as a Blob too.
    exportAnswer = () => {
      throw httpError(500, new Blob([JSON.stringify({ title: 'An unexpected error occurred.', status: 500 })], { type: 'application/problem+json' }))
    }
    const user = userEvent.setup()
    renderAt('/data/countries')

    await user.click(await screen.findByRole('button', { name: 'Export verified CSV' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not export Countries: An unexpected error occurred.')
    expect(downloads).toEqual([])
  })

  it('offers no export on a table the API cannot export', async () => {
    renderAt('/data/flight-statuses')
    await screen.findByText('Scheduled')

    expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument()
  })
})
