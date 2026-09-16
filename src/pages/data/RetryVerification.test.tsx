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
  { slug: 'verification-requests', displayName: 'Verification Requests', rowCount: 3 },
  { slug: 'airlines', displayName: 'Airlines', rowCount: 1 },
]

type Row = Record<string, unknown>

// Raw rows (GET /admin/data/{table}), trimmed to a few columns each. The request's own Id (1, 2,
// 3) is deliberately far from the entity it checked (EntityKey), so a test sending the wrong one
// is easy to tell apart.
let rows: Record<string, Row[]>
const makeRows = (): Record<string, Row[]> => ({
  'verification-requests': [
    { Id: 101, EntityType: 'Airport', EntityKey: '7', Status: 'Error', Attempts: 2 },
    { Id: 102, EntityType: 'Airline', EntityKey: '8', Status: 'Mismatch', Attempts: 1 },
    { Id: 103, EntityType: 'Country', EntityKey: 'FR', Status: 'Pending', Attempts: 0 },
  ],
  // A coincidental Status:'Error' value here would wrongly earn a Retry button if the row action
  // were scoped by Status alone rather than by table too.
  airlines: [{ Id: 7, Iata: 'TK', Name: 'Turkish Airlines', Status: 'Error' }],
})

let sent: SentRequest[]
let failWith: ((req: SentRequest) => never) | undefined

/** The raw grid's API, plus the typed retry route the Retry row action calls. */
function api(req: SentRequest) {
  if (failWith && req.method !== 'GET') failWith(req)
  if (req.method === 'GET' && req.url === '/admin/data/tables') return TABLES
  const table = req.url.match(/^\/admin\/data\/([a-z-]+)$/)?.[1]
  if (req.method === 'GET' && table && rows[table]) return pagedResult(rows[table], req.params)
  let m
  if (req.method === 'POST' && (m = req.url.match(/^\/admin\/verification-requests\/(\d+)\/retry$/))) {
    const id = Number(m[1])
    // A successful retry queues a fresh check, which moves the request off Error — the grid should
    // reflect that once it refetches.
    rows['verification-requests'] = rows['verification-requests'].map(r => (r.Id === id ? { ...r, Status: 'Pending' } : r))
    return { queued: 2, skipped: 1 }
  }
  throw httpError(404)
}

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

describe('Retry on the verification-requests grid', () => {
  beforeEach(() => {
    rows = makeRows()
    failWith = undefined
    ;({ sent } = installFakeApi(api))
  })

  it('offers Retry only on the row whose Status is Error', async () => {
    renderAt('/data/verification-requests')

    expect(within(await rowOf('101')).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(within(await rowOf('102')).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(within(await rowOf('103')).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it("sends the request's own id, not the entity key, and shows queued/skipped after refetching", async () => {
    const user = userEvent.setup()
    renderAt('/data/verification-requests')

    await user.click(within(await rowOf('101')).getByRole('button', { name: 'Retry' }))

    expect(writes()).toEqual([expect.objectContaining({ method: 'POST', url: '/admin/verification-requests/101/retry' })])
    expect(await screen.findByRole('status')).toHaveTextContent('Queued 2 · skipped 1')
    // The grid refetched: row 101 no longer shows Error, and its Retry button is gone.
    await waitFor(() => expect(within(screen.getByText('101').closest('tr')!).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument())
    expect(screen.getByText('101').closest('tr')).toHaveTextContent('Pending')
  })

  it('a 409 (the entity already has an open check) shows the message instead of failing silently', async () => {
    const user = userEvent.setup()
    failWith = () => { throw httpError(409, { title: 'The entity already has an open verification check.', status: 409 }) }
    renderAt('/data/verification-requests')

    await user.click(within(await rowOf('101')).getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not retry request 101: The entity already has an open verification check.')
    // A failed retry doesn't invalidate the grid, so the row is unchanged and still offers Retry.
    expect(within(await rowOf('101')).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('another table gets no Retry action at all', async () => {
    renderAt('/data/airlines')

    expect(await screen.findByText('Turkish Airlines')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })
})
