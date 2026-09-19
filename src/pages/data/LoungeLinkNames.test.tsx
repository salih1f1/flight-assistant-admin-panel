import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult, type SentRequest } from '@/test/fakeApi'
import { DataBrowserPage } from './DataBrowserPage'

/**
 * Picks a filter column by the name the API knows it as, which is what these tests hold: the
 * picker shows a friendlier label, so the raw name is typed into its search and matched there.
 */
async function chooseFilterColumn(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('combobox', { name: 'Filter column' }))
  await user.type(screen.getByRole('textbox', { name: 'Search columns' }), name)
  const shown = within(screen.getByRole('listbox')).getAllByRole('option')
  if (shown.length !== 1) throw new Error(`"${name}" matched ${shown.length} columns, not one`)
  await user.click(shown[0])
}


vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

/** Shaped like BrowsableColumnDto, as GET /admin/data/tables publishes them. */
const column = (name: string, kind: string, values: string[] | null = null) => ({ name, kind, values })

const LINK_COLUMNS = [
  column('LoungeId', 'Number'),
  column('ProviderId', 'Number'),
  column('Role', 'Enum', ['AccessNetwork', 'Operator']),
  column('Notes', 'Text'),
  column('MinAllianceTierCode', 'Text'),
]

const PROVIDER_COLUMNS = [column('Id', 'Number'), column('Code', 'Text'), column('Name', 'Text')]

/** One lounge, two providers, then two more lounges: the row shape the join table really has. */
const LINKS = [
  { LoungeId: 1, ProviderId: 4, Role: 'AccessNetwork', Notes: null, MinAllianceTierCode: 'SAPPHIRE' },
  { LoungeId: 1, ProviderId: 7, Role: 'Operator', Notes: null, MinAllianceTierCode: null },
  { LoungeId: 2, ProviderId: 4, Role: 'AccessNetwork', Notes: null, MinAllianceTierCode: 'EMERALD' },
  { LoungeId: 3, ProviderId: 4, Role: 'AccessNetwork', Notes: null, MinAllianceTierCode: null },
]

const PROVIDERS = [
  { Id: 4, Code: 'PP', Name: 'Priority Pass' },
  { Id: 7, Code: null, Name: 'Plaza Premium' },
]

// One name, two terminals, one airport — the real shape of the lounges table, where Galleries
// Club is a lounge in two Heathrow terminals. The name alone tells them apart; nothing else does.
const GALLERIES_T3 = { id: 1, airportId: 2276, name: 'Galleries Club', terminal: 'T3' }
const GALLERIES_T5 = { id: 2, airportId: 2276, name: 'Galleries Club', terminal: 'T5' }
// A lounge that names no terminal, as an airport with one lounge has.
const CLUBROOMS = { id: 3, airportId: 2276, name: 'Clubrooms', terminal: null }

const GATWICK = { id: 2276, iata: 'LGW', icao: 'EGKK', name: 'London Gatwick', city: 'London', countryCode: 'GB' }

let sent: SentRequest[]

function install() {
  sent = installFakeApi(req => {
    if (req.method !== 'GET') throw httpError(405)
    if (req.url === '/admin/data/tables') {
      return [
        { slug: 'lounge-provider-links', displayName: 'Lounge Provider Links', rowCount: LINKS.length, columns: LINK_COLUMNS },
        { slug: 'lounge-providers', displayName: 'Lounge Providers', rowCount: PROVIDERS.length, columns: PROVIDER_COLUMNS },
      ]
    }
    if (req.url === '/admin/data/lounge-provider-links') return pagedResult(LINKS, req.params)
    if (req.url === '/admin/data/lounge-providers') return pagedResult(PROVIDERS, req.params)
    if (req.url === '/admin/lounges/1') return GALLERIES_T3
    if (req.url === '/admin/lounges/2') return GALLERIES_T5
    if (req.url === '/admin/lounges/3') return CLUBROOMS
    if (req.url === '/admin/airports/2276') return GATWICK
    throw httpError(404)
  }).sent
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

/** The filter form, where the preview of the id in the value box renders beside the box. */
const filterForm = () => within(screen.getByLabelText('Filter value').closest('form')!)

const dataHeaders = () => within(screen.getByRole('table'))
  .getAllByRole('columnheader')
  .map(h => h.querySelector('button')?.textContent?.replace(/[↑↓]/g, '').trim())
  .filter((name): name is string => !!name)

/**
 * The one table with no record page to open — its key spans three columns — so a row that reads
 * "1, 4" can only be resolved by leaving the page and looking both numbers up by hand.
 */
describe('The lounge provider links grid', () => {
  beforeEach(install)

  it('names the lounge, and says which airport and terminal it is in', async () => {
    renderAt('/data/lounge-provider-links')

    // Two rows link the same lounge to two providers, as a lounge with an operator and an access
    // network does.
    const lounges = await screen.findAllByRole('link', { name: 'Galleries Club · LGW T3' })
    expect(lounges).toHaveLength(2)
    expect(lounges[0]).toHaveAttribute('href', '/data/lounges/1')
    expect(lounges[0]).toHaveAttribute('title', 'London Gatwick')
  })

  /** The two lounges share a name and an airport. Without the terminal the rows are the same row. */
  it('tells two lounges of the same name in the same airport apart', async () => {
    renderAt('/data/lounge-provider-links')

    expect(await screen.findByRole('link', { name: 'Galleries Club · LGW T5' })).toHaveAttribute('href', '/data/lounges/2')
  })

  it('leaves out a terminal the lounge does not name', async () => {
    renderAt('/data/lounge-provider-links')

    expect(await screen.findByRole('link', { name: 'Clubrooms · LGW' })).toHaveAttribute('href', '/data/lounges/3')
  })

  it('names the provider, with its code where it has one', async () => {
    renderAt('/data/lounge-provider-links')

    const providers = await screen.findAllByRole('link', { name: 'Priority Pass (PP)' })
    expect(providers[0]).toHaveAttribute('href', '/data/lounge-providers/4')
    expect(await screen.findByRole('link', { name: 'Plaza Premium' })).toHaveAttribute('href', '/data/lounge-providers/7')
  })

  /**
   * There is no GET /admin/lounge-providers/{id} and no list endpoint, so the names come from the
   * browsable table — walked once for the whole grid, however many rows name a provider.
   */
  it('reads the provider table once for the whole grid', async () => {
    renderAt('/data/lounge-provider-links')
    await screen.findByRole('link', { name: 'Plaza Premium' })

    expect(sent.filter(r => r.url === '/admin/data/lounge-providers')).toHaveLength(1)
  })

  it('heads both columns by what they hold, not by the id they store', async () => {
    renderAt('/data/lounge-provider-links')
    await screen.findByRole('table')

    expect(dataHeaders()).toEqual(['Lounge', 'Provider', 'Role', 'MinAllianceTierCode'])
  })

  it('still sorts those columns by the name the API knows them as', async () => {
    const user = userEvent.setup()
    const router = renderAt('/data/lounge-provider-links')
    await screen.findByRole('table')

    await user.click(screen.getByRole('button', { name: 'Lounge' }))

    expect(new URLSearchParams(router.state.location.search).get('sort')).toBe('LoungeId')
  })

  /** Neither table can be filtered by name, so the box takes an id — it should say which one. */
  it('names the lounge an id stands for before the filter is applied', async () => {
    const user = userEvent.setup()
    renderAt('/data/lounge-provider-links')
    await screen.findByRole('table')

    await chooseFilterColumn(user, 'LoungeId')
    await user.type(screen.getByLabelText('Filter value'), '3')

    expect(await filterForm().findByRole('link', { name: 'Clubrooms · LGW' })).toBeInTheDocument()
  })

  it('does the same for a provider', async () => {
    const user = userEvent.setup()
    renderAt('/data/lounge-provider-links')
    await screen.findByRole('table')

    await chooseFilterColumn(user, 'ProviderId')
    await user.type(screen.getByLabelText('Filter value'), '7')

    expect(await filterForm().findByRole('link', { name: 'Plaza Premium' })).toBeInTheDocument()
  })

  /** A link may point at a provider that is no longer there; the row must still say so. */
  it('keeps an id that names no provider visible', async () => {
    renderAt('/data/lounge-provider-links')
    await screen.findByRole('table')
    const user = userEvent.setup()

    await chooseFilterColumn(user, 'ProviderId')
    await user.type(screen.getByLabelText('Filter value'), '9')

    expect(await filterForm().findByText('#9, not found')).toBeInTheDocument()
  })
})
