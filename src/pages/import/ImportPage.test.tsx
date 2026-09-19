import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, type SentRequest } from '@/test/fakeApi'
import { createTestQueryClient, renderWithProviders } from '@/test/renderWithProviders'
import { ImportPage } from './ImportPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

// The order the import endpoints' own summaries require ("run after …").
const ORDER = ['Alliances', 'Countries', 'Airports', 'Airlines', 'Lounge providers', 'Loyalty program kinds', 'Lounges', 'Loyalty programs']

let sent: SentRequest[]
let answer: (req: SentRequest) => unknown

const step = (name: string) => screen.getByRole('region', { name })
const csv = (name: string, type = 'text/csv') => new File(['Code,Name\nDE,Germany\n'], name, { type })

async function pickAndImport(user: ReturnType<typeof userEvent.setup>, name: string, file: File) {
  const region = step(name)
  await user.upload(within(region).getByLabelText(`CSV file for ${name}`), file)
  await user.click(within(region).getByRole('button', { name: 'Import' }))
  return region
}

describe('ImportPage', () => {
  beforeEach(() => {
    // ImportResult as ToImportResponse sends it: 200 with no errors.
    answer = () => ({ inserted: 2, updated: 1, errors: [] })
    ;({ sent } = installFakeApi(req => {
      if (req.method === 'POST' && req.url.startsWith('/admin/import/')) return answer(req)
      throw httpError(404)
    }))
  })

  it('lists the imports in the order the API requires, each saying what it comes after', () => {
    renderWithProviders(<ImportPage />)

    expect(screen.getAllByRole('region').map(r => r.getAttribute('aria-label'))).toEqual(ORDER)
    expect(step('Countries')).toHaveTextContent('After alliances')
    expect(step('Loyalty programs')).toHaveTextContent('After loyalty program kinds and airlines')
    expect(screen.getByText(/writes to the shared database/)).toBeInTheDocument()
  })

  it('keeps Import disabled until a file is picked', () => {
    renderWithProviders(<ImportPage />)

    expect(within(step('Countries')).getByRole('button', { name: 'Import' })).toBeDisabled()
  })

  it("uploads the file to the table's import endpoint and shows what changed", async () => {
    const user = userEvent.setup()
    renderWithProviders(<ImportPage />)

    const region = await pickAndImport(user, 'Countries', csv('countries.csv'))

    expect(await within(region).findByText('Imported countries.csv: 2 inserted, 1 updated.')).toBeInTheDocument()
    const request = sent.find(r => r.method === 'POST')!
    expect(request.url).toBe('/admin/import/countries')
    const file = (request.data as FormData).get('file') as File
    expect(file.name).toBe('countries.csv')
    expect(file.type).toBe('text/csv')
  })

  it('sends the file as text/csv even when the browser labels it otherwise, since the API only accepts text/csv', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ImportPage />)

    await pickAndImport(user, 'Airports', csv('airports.csv', 'application/vnd.ms-excel'))

    await waitFor(() => expect(sent.some(r => r.method === 'POST')).toBe(true))
    const file = (sent.find(r => r.method === 'POST')!.data as FormData).get('file') as File
    expect(file.type).toBe('text/csv')
    expect(file.name).toBe('airports.csv')
  })

  it('lists every row error when only some rows were imported (207)', async () => {
    // Results.Json(result, statusCode: 207): a success status, so the body arrives as data.
    answer = () => ({
      inserted: 1,
      updated: 0,
      errors: ["Country 'XX': Code must be a known ISO 3166-1 alpha-2 code.", "Country 'YY': Name is required."],
    })
    const user = userEvent.setup()
    renderWithProviders(<ImportPage />)

    const region = await pickAndImport(user, 'Countries', csv('countries.csv'))

    const alert = await within(region).findByRole('alert')
    expect(alert).toHaveTextContent('Imported countries.csv with errors: 1 inserted, 0 updated, 2 rows failed.')
    expect(within(alert).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      "Country 'XX': Code must be a known ISO 3166-1 alpha-2 code.",
      "Country 'YY': Name is required.",
    ])
  })

  it("shows the API's reason when it rejects the file", async () => {
    // CsvHelperException, as GlobalExceptionHandler renders it.
    answer = () => {
      throw httpError(400, { title: 'Invalid CSV file', status: 400, detail: 'Header with name \'Code\' was not found.' })
    }
    const user = userEvent.setup()
    renderWithProviders(<ImportPage />)

    const region = await pickAndImport(user, 'Alliances', csv('alliances.csv'))

    const alert = await within(region).findByRole('alert')
    expect(alert).toHaveTextContent('Could not import alliances.csv: Invalid CSV file')
    expect(alert).toHaveTextContent("Header with name 'Code' was not found.")
  })

  it('marks cached data stale after an import, so lists and counts show the imported rows', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(['/admin/countries'], [])
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <ImportPage />
      </QueryClientProvider>,
    )

    const region = await pickAndImport(user, 'Countries', csv('countries.csv'))
    await within(region).findByText(/Imported countries\.csv/)

    expect(queryClient.getQueryState(['/admin/countries'])?.isInvalidated).toBe(true)
  })

  it("keeps each table's result with that table", async () => {
    const user = userEvent.setup()
    renderWithProviders(<ImportPage />)

    const countries = await pickAndImport(user, 'Countries', csv('countries.csv'))
    await within(countries).findByText(/Imported countries\.csv/)

    expect(step('Airports')).not.toHaveTextContent('Imported')
  })
})
