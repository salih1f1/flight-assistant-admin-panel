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
const idOf = (n: number) => `00000000-0000-0000-0000-000000000${pad(n)}`

// 60 travelers: two pages at 50, so paging away and back can be tested.
const TABLES = [{ slug: 'travelers', displayName: 'Travelers', rowCount: 60 }]
const TRAVELERS = Array.from({ length: 60 }, (_, i) => ({
  Id: idOf(i + 1),
  Email: '<redacted>',
  DisplayName: `Traveler ${pad(i + 1)}`,
}))
const EMAILS: Record<string, string> = Object.fromEntries(TRAVELERS.map((t, i) => [t.Id, `traveler${pad(i + 1)}@example.com`]))

let sent: SentRequest[]
let revealAnswer: (req: SentRequest) => unknown
let travelerRows: typeof TRAVELERS
let queryClient: QueryClient

/**
 * GET /admin/data/* as before, plus POST /admin/data/{table}/{id}/reveal, which answers
 * RevealedValueDto unless a test swaps in a failure.
 */
function install() {
  ;({ sent } = installFakeApi(req => {
    if (req.method === 'GET' && req.url === '/admin/data/tables') return TABLES
    if (req.method === 'GET' && req.url === '/admin/data/travelers') return pagedResult(travelerRows, req.params)
    if (req.method === 'POST' && /^\/admin\/data\/travelers\/[^/]+\/reveal$/.test(req.url)) return revealAnswer(req)
    throw httpError(404)
  }))
}

const defaultReveal = (req: SentRequest) => {
  const id = req.url.split('/')[4]
  const column = (req.data as { column: string }).column
  if (!(id in EMAILS)) throw httpError(404, { title: `No 'Travelers' row with id '${id}'.`, status: 404 })
  return { table: 'travelers', id, column, value: EMAILS[id] }
}

function renderAt(entry: string) {
  const router = createMemoryRouter(
    [
      { path: '/data', element: <DataBrowserPage /> },
      { path: '/data/:table', element: <DataBrowserPage /> },
    ],
    { initialEntries: [entry] },
  )
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const rowOf = async (name: string) => (await screen.findByText(name)).closest('tr')!
const reveals = () => sent.filter(r => r.method === 'POST')

describe('DataBrowserPage reveal', () => {
  beforeEach(() => {
    revealAnswer = defaultReveal
    travelerRows = TRAVELERS
    install()
  })

  it('asks before revealing, says the reveal is audited, and sends nothing on cancel', async () => {
    const user = userEvent.setup()
    renderAt('/data/travelers')

    await user.click(within(await rowOf('Traveler 001')).getByRole('button', { name: 'Reveal Email' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Reveal Email?')
    expect(dialog).toHaveTextContent('recorded in the admin audit log')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(reveals()).toHaveLength(0)
    expect(within(await rowOf('Traveler 001')).getByText('Masked')).toBeInTheDocument()
  })

  it('confirming sends the reveal and shows the value in that cell only', async () => {
    const user = userEvent.setup()
    const router = renderAt('/data/travelers')
    await user.click(within(await rowOf('Traveler 002')).getByRole('button', { name: 'Reveal Email' }))

    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reveal' }))

    expect(await within(await rowOf('Traveler 002')).findByText('traveler002@example.com')).toBeInTheDocument()
    expect(reveals()).toEqual([{ method: 'POST', url: `/admin/data/travelers/${idOf(2)}/reveal`, params: undefined, data: { column: 'Email' } }])
    expect(within(await rowOf('Traveler 001')).getByText('Masked')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Never in the URL, where it would outlive the page in history and shared links.
    expect(router.state.location.search).toBe('')
  })

  it('Hide masks the value again without asking the API', async () => {
    const user = userEvent.setup()
    renderAt('/data/travelers')
    await user.click(within(await rowOf('Traveler 001')).getByRole('button', { name: 'Reveal Email' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reveal' }))
    await screen.findByText('traveler001@example.com')

    await user.click(within(await rowOf('Traveler 001')).getByRole('button', { name: 'Hide Email' }))

    expect(screen.queryByText('traveler001@example.com')).not.toBeInTheDocument()
    expect(within(await rowOf('Traveler 001')).getByText('Masked')).toBeInTheDocument()
    expect(reveals()).toHaveLength(1)
  })

  it('drops revealed values when the view changes, so paging back shows them masked', async () => {
    const user = userEvent.setup()
    renderAt('/data/travelers')
    await user.click(within(await rowOf('Traveler 001')).getByRole('button', { name: 'Reveal Email' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reveal' }))
    await screen.findByText('traveler001@example.com')

    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Traveler 051')
    await user.click(screen.getByRole('button', { name: 'Previous' }))

    expect(within(await rowOf('Traveler 001')).getByText('Masked')).toBeInTheDocument()
    expect(screen.queryByText('traveler001@example.com')).not.toBeInTheDocument()
    expect(reveals()).toHaveLength(1)
  })

  it('keeps a revealed value when the rows refresh without the view changing', async () => {
    const user = userEvent.setup()
    renderAt('/data/travelers')
    await user.click(within(await rowOf('Traveler 001')).getByRole('button', { name: 'Reveal Email' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reveal' }))
    await screen.findByText('traveler001@example.com')

    // Someone renamed another traveler: the same view, with new data.
    travelerRows = TRAVELERS.map(t => (t.Id === idOf(2) ? { ...t, DisplayName: 'Traveler 002 (renamed)' } : t))
    await act(async () => {
      await queryClient.invalidateQueries()
    })
    await screen.findByText('Traveler 002 (renamed)')

    expect(within(await rowOf('Traveler 001')).getByText('traveler001@example.com')).toBeInTheDocument()
  })

  it('never shows a revealed value on another row when the rows refresh in a different order', async () => {
    const user = userEvent.setup()
    renderAt('/data/travelers')
    await user.click(within(await rowOf('Traveler 001')).getByRole('button', { name: 'Reveal Email' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reveal' }))
    await screen.findByText('traveler001@example.com')

    // The same view refreshes with the first two rows swapped: Traveler 002 now sits where 001 was.
    travelerRows = [TRAVELERS[1], TRAVELERS[0], ...TRAVELERS.slice(2)]
    await act(async () => {
      await queryClient.invalidateQueries()
    })
    await waitFor(() => expect(screen.getAllByRole('row')[1]).toHaveTextContent('Traveler 002'))

    const traveler2 = await rowOf('Traveler 002')
    expect(within(traveler2).getByText('Masked')).toBeInTheDocument()
    expect(within(traveler2).queryByText('traveler001@example.com')).not.toBeInTheDocument()
  })

  it("shows the API's reason when the row no longer exists, and reveals nothing", async () => {
    revealAnswer = req => {
      const id = req.url.split('/')[4]
      throw httpError(404, { title: `No 'Travelers' row with id '${id}'.`, status: 404 })
    }
    const user = userEvent.setup()
    renderAt('/data/travelers')
    await user.click(within(await rowOf('Traveler 001')).getByRole('button', { name: 'Reveal Email' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Reveal' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(`No 'Travelers' row with id '${idOf(1)}'.`)
    expect(within(await rowOf('Traveler 001')).getByText('Masked')).toBeInTheDocument()
  })

  it('explains the rate limit, since its plain-text 429 carries no reason', async () => {
    // The rate limiter writes plain text, not ProblemDetails, and Retry-After isn't exposed over CORS.
    revealAnswer = () => {
      throw httpError(429, 'Too many requests. Please try again later.')
    }
    const user = userEvent.setup()
    renderAt('/data/travelers')
    await user.click(within(await rowOf('Traveler 001')).getByRole('button', { name: 'Reveal Email' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Reveal' }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('Too many reveals in a short time.')
    expect(alert).toHaveTextContent('The API limits how often values can be revealed. Try again shortly.')
  })
})
