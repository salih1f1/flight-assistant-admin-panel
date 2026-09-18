import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, pagedResult } from '@/test/fakeApi'
import { DataBrowserPage } from './DataBrowserPage'
import { RecordPage } from './RecordPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

/** Shaped like BrowsableColumnDto, as GET /admin/data/tables publishes them. */
const column = (name: string, kind: string) => ({ name, kind, values: null })

/** Every column GET /admin/data/countries sends, in the order it sends them. */
const COUNTRY_COLUMNS = [
  column('Code', 'Text'),
  column('Name', 'Text'),
  column('Alpha3', 'Text'),
  column('NumericCode', 'Number'),
  column('Region', 'Text'),
  column('Subregion', 'Text'),
  column('IsEU', 'Bool'),
  column('IsSchengen', 'Bool'),
  column('IsEEA', 'Bool'),
  column('SourceType', 'Text'),
  column('FirstSeenAt', 'Date'),
  column('IsVerified', 'Bool'),
  column('VerifiedAt', 'Date'),
  column('VerifiedBy', 'Text'),
  column('VerificationSource', 'Text'),
  column('VerificationIssue', 'Text'),
]

const COLUMN_NAMES = COUNTRY_COLUMNS.map(c => c.name)

/** The three memberships: facts about a country, not what a country is found by. */
const MEMBERSHIPS = ['IsEU', 'IsSchengen', 'IsEEA']

/** What the grid hid before it had a list: the bookkeeping columns, and IsVerified. */
const BOOKKEEPING = [
  'SourceType', 'FirstSeenAt', 'IsVerified', 'VerifiedAt', 'VerifiedBy', 'VerificationSource', 'VerificationIssue',
]

const country = (code: string, name: string, alpha3: string, numeric: number, subregion: string, eu: boolean) => ({
  Code: code,
  Name: name,
  Alpha3: alpha3,
  NumericCode: numeric,
  Region: 'Europe',
  Subregion: subregion,
  IsEU: eu,
  IsSchengen: eu,
  IsEEA: eu,
  SourceType: 'Seed',
  FirstSeenAt: '2026-01-01T00:00:00Z',
  IsVerified: false,
  VerifiedAt: null,
  VerifiedBy: null,
  VerificationSource: null,
  VerificationIssue: null,
})

// One in the EU and one outside it, so a grid dropping the flags can't be mistaken for a grid
// whose flags all happen to read the same.
const COUNTRIES = [
  country('DE', 'Germany', 'DEU', 276, 'Western Europe', true),
  country('AL', 'Albania', 'ALB', 8, 'Southeast Europe', false),
]

function install() {
  installFakeApi(req => {
    if (req.method !== 'GET') throw httpError(404)
    if (req.url === '/admin/data/tables') {
      return [{ slug: 'countries', displayName: 'Countries', rowCount: COUNTRIES.length, columns: COUNTRY_COLUMNS }]
    }
    if (req.url === '/admin/data/countries') {
      // The key's string filter is a contains match, the same as BrowsableDataRepository's.
      const filters = (req.params?.filter ?? []) as string[]
      const rows = filters.reduce((left, filter) => {
        const [name, ...rest] = filter.split(':')
        const value = rest.join(':')
        return left.filter(row => String(row[name as keyof typeof row]).toLowerCase().includes(value.toLowerCase()))
      }, COUNTRIES)
      return pagedResult(rows, req.params)
    }
    if (req.url === '/admin/verification-requests') return []
    throw httpError(404)
  })
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
}

const dataHeaders = () => within(screen.getByRole('table'))
  .getAllByRole('columnheader')
  .map(h => h.querySelector('button')?.textContent?.replace(/[↑↓]/g, '').trim())
  .filter((name): name is string => !!name)

const filterOptions = () => within(screen.getByLabelText('Filter column')).getAllByRole('option').map(o => o.textContent)

beforeEach(install)

describe('The countries grid, as a list', () => {
  /**
   * A country is found by its code and its name, and told apart by the region it sits in. Whether
   * it is in the EU, in Schengen or in the EEA is a fact about a country you have already found —
   * three columns reading `false` on most of the rows on screen, which is what CHECKED_COLUMNS
   * already says by leaving them out of what verifying a country compares.
   */
  it('shows the code, the name and where the country is, and not its three memberships', async () => {
    renderAt('/data/countries')
    await screen.findByRole('table')

    expect(dataHeaders()).toEqual(['Code', 'Name', 'Alpha3', 'NumericCode', 'Region', 'Subregion'])
  })

  it('brings every column back behind the toggle, in the order the API sends them', async () => {
    const user = userEvent.setup()
    renderAt('/data/countries')
    await screen.findByRole('table')

    await user.click(screen.getByRole('button', { name: 'Show 10 hidden columns' }))

    expect(dataHeaders()).toEqual(COLUMN_NAMES)
  })

  it('hides them again, so the trimmed grid is a toggle away and not a one-way door', async () => {
    const user = userEvent.setup()
    renderAt('/data/countries')
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'Show 10 hidden columns' }))

    await user.click(screen.getByRole('button', { name: 'Hide 10 columns' }))

    expect(dataHeaders()).toEqual(['Code', 'Name', 'Alpha3', 'NumericCode', 'Region', 'Subregion'])
  })
})

describe('Filtering countries', () => {
  /** The picker offers what the grid shows (#149), so the list decides both. */
  it('offers the six columns the list is about', async () => {
    renderAt('/data/countries')
    await screen.findByRole('table')

    expect(filterOptions()).toEqual(['Code', 'Name', 'Alpha3', 'NumericCode', 'Region', 'Subregion'])
  })

  /**
   * "Which countries are in Schengen?" is a real question, and trimming the grid must leave it
   * askable: the same press that widens the grid widens the picker.
   */
  it('offers the memberships again once the hidden columns are shown', async () => {
    const user = userEvent.setup()
    renderAt('/data/countries')
    await screen.findByRole('table')

    await user.click(screen.getByRole('button', { name: 'Show 10 hidden columns' }))

    expect(filterOptions()).toEqual(COLUMN_NAMES)
  })
})

describe('A country record', () => {
  /** Trimmed off the list, never dropped: the record page still holds the whole country. */
  it('still shows all three memberships in full', async () => {
    renderAt('/data/countries/DE')
    // The name is both the page's heading and its Name field, so this waits on either.
    expect(await screen.findAllByText('Germany')).not.toHaveLength(0)

    for (const name of MEMBERSHIPS) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
  })
})

describe('Verifying a country', () => {
  /*
   * The Verify dialog's field list is the grid's default-visible columns unless the table has a
   * CHECKED_COLUMNS entry. Countries has one, so this list must stay put whatever the grid shows —
   * the trap LoungesGridColumns documents, from the other side: there, trimming the grid narrowed
   * verifying; here, the override is the only thing standing between them.
   */
  it('asks about the columns an outside source compares, not the columns the grid shows', async () => {
    const user = userEvent.setup()
    renderAt('/data/countries')
    await screen.findByRole('table')

    await user.click(within(screen.getAllByRole('row')[1]).getByRole('button', { name: 'Verify' }))

    const dialog = within(screen.getByRole('dialog'))
    for (const name of ['Code', 'Name', 'Alpha3', 'NumericCode', 'Region', 'Subregion']) {
      expect(dialog.getByText(name)).toBeInTheDocument()
    }
    for (const name of [...MEMBERSHIPS, ...BOOKKEEPING.filter(n => n !== 'IsVerified')]) {
      expect(dialog.queryByText(name)).not.toBeInTheDocument()
    }
  })
})
