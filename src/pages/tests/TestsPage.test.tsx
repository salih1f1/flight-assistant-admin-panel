import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, type SentRequest } from '@/test/fakeApi'
import { TestsPage } from './TestsPage'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

// Shaped like CiRunDto, from the backend's recorded CI runs.
type Run = {
  id: number; runNumber: number; runAttempt: number; title: string; event: string; branch: string; commitSha: string
  status: string; conclusion: string | null; createdUtc: string; startedUtc: string | null; updatedUtc: string
  durationSeconds: number | null; htmlUrl: string
}
const run = (id: number, runNumber: number, fields: Partial<Run>): Run => ({
  id,
  runNumber,
  runAttempt: 1,
  title: `Run ${runNumber}`,
  event: 'push',
  branch: 'development',
  commitSha: 'd7c5738a1b2c3d4e5f60718293a4b5c6d7e8f901',
  status: 'completed',
  conclusion: 'success',
  createdUtc: '2026-09-14T10:24:09Z',
  startedUtc: '2026-09-14T10:24:09Z',
  updatedUtc: '2026-09-14T10:26:30Z',
  durationSeconds: 141,
  htmlUrl: `https://github.com/salih1f1/flight-assistant-backend/actions/runs/${id}`,
  ...fields,
})

const IN_PROGRESS = run(34840000001, 35, {
  title: 'feat(ci): cache the run list', event: 'pull_request', branch: 'feature/340-cache', status: 'in_progress',
  conclusion: null, durationSeconds: null,
})
const FAILED = run(34832987777, 34, { title: 'Merge pull request #333 from salih1f1/feature/332-ci-runs-proxy', conclusion: 'failure', runAttempt: 2 })
const PASSED = run(34761036906, 32, {
  title: 'Merge pull request #330 from salih1f1/fix/align-admin-panel-dev-origin',
  commitSha: '1cc8f1a2966782782a2456e85d91eaa2fe0ff192', startedUtc: '2026-09-13T13:52:09Z', durationSeconds: 140,
})

// Shaped like CiTestReportDto, as trx_to_json.py writes it: one test failed.
const FAILED_REPORT = {
  runId: FAILED.id, commit: FAILED.commitSha, ref: 'development', total: 4, passed: 3, failed: 1, skipped: 0, durationMs: 1275,
  suites: [
    {
      suite: 'FlightAssistant.API.Tests', total: 2, passed: 2, failed: 0, skipped: 0, durationMs: 1256,
      tests: [
        { name: 'FlightAssistant.API.Tests.Integration.AdminCiEndpointTests.Anonymous_Returns401(path: "admin/ci/runs")', class: 'AdminCiEndpointTests', outcome: 'Passed', durationMs: 1189, message: '' },
        { name: 'FlightAssistant.API.Tests.Integration.LoyaltyEndpointTests.GetPrograms_ValidToken_Returns200', class: 'LoyaltyEndpointTests', outcome: 'Passed', durationMs: 67, message: '' },
      ],
    },
    {
      suite: 'FlightAssistant.Application.Tests', total: 2, passed: 1, failed: 1, skipped: 0, durationMs: 19,
      tests: [
        { name: 'FlightAssistant.Application.Tests.Commands.Loyalty.UpdateLoyaltyMembershipCommandHandlerTests.MembershipNotFound_Throws', class: 'UpdateLoyaltyMembershipCommandHandlerTests', outcome: 'Passed', durationMs: 7, message: '' },
        { name: 'FlightAssistant.Application.Tests.Queries.Admin.Ci.GetCiRunsQueryTests.Handle_KeysTheCacheByBranchAndLimit', class: 'GetCiRunsQueryTests', outcome: 'Failed', durationMs: 12, message: 'Assert.Equal() Failure: Values differ\nExpected: 3\nActual:   1' },
      ],
    },
  ],
}
const PASSED_REPORT = {
  ...FAILED_REPORT, runId: PASSED.id, passed: 4, failed: 0,
  suites: FAILED_REPORT.suites.map(suite => ({ ...suite, passed: suite.total, failed: 0, tests: suite.tests.map(t => ({ ...t, outcome: 'Passed', message: '' })) })),
}

let runs: Run[]
let reports: Map<number, () => unknown>
let sent: SentRequest[]

/** GET /admin/ci/runs filters by branch; GET /admin/ci/runs/{id}/tests answers 404 for a run with no report. */
function ciApi(req: SentRequest) {
  if (req.method === 'GET' && req.url === '/admin/ci/runs') {
    const branch = req.params?.branch
    return branch ? runs.filter(r => r.branch === branch) : runs
  }
  const match = req.method === 'GET' && /^\/admin\/ci\/runs\/(\d+)\/tests$/.exec(req.url)
  if (match) {
    const report = reports.get(Number(match[1]))
    if (report) return report()
    throw httpError(404, {
      title: `CI run ${match[1]} has no test report. It may still be running, or it stopped before its tests reported.`,
      status: 404,
    })
  }
  throw httpError(404)
}

function renderAt(entry: string) {
  const router = createMemoryRouter([{ path: '/tests', element: <TestsPage /> }], { initialEntries: [entry] })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const rowOf = async (title: string) => (await screen.findByText(title)).closest('tr')!
const cells = (tr: HTMLElement) => within(tr).getAllByRole('cell').map(c => c.textContent)
const testRequests = () => sent.filter(r => r.url.endsWith('/tests'))

describe('TestsPage', () => {
  beforeEach(() => {
    runs = [IN_PROGRESS, FAILED, PASSED]
    reports = new Map([[FAILED.id, () => FAILED_REPORT], [PASSED.id, () => PASSED_REPORT]])
    ;({ sent } = installFakeApi(ciApi))
  })

  it('lists recent runs: result, run, branch, commit, start and duration', async () => {
    renderAt('/tests')

    expect(await screen.findByRole('heading', { name: 'Tests' })).toBeInTheDocument()
    const passed = await rowOf(PASSED.title)
    expect(cells(passed).slice(0, 6)).toEqual([
      'Success', `${PASSED.title}#32 · push`, 'development', '1cc8f1a', '2026-09-13 13:52 UTC', '2m 20s',
    ])
    expect(cells(await rowOf(FAILED.title)).slice(0, 2)).toEqual(['Failure', `${FAILED.title}#34 · push · attempt 2`])
    expect(cells(await rowOf(IN_PROGRESS.title))).toEqual(
      expect.arrayContaining(['In progress', 'feature/340-cache', '—']),
    )
    expect(sent).toEqual([expect.objectContaining({ method: 'GET', url: '/admin/ci/runs', params: undefined })])
  })

  it("links each run to GitHub, and doesn't link a URL that isn't GitHub's", async () => {
    runs = [PASSED, { ...FAILED, htmlUrl: 'javascript:alert(1)' }]
    renderAt('/tests')

    const link = within(await rowOf(PASSED.title)).getByRole('link', { name: 'Run #32 on GitHub' })
    expect(link).toHaveAttribute('href', PASSED.htmlUrl)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
    expect(within(await rowOf(FAILED.title)).queryByRole('link', { name: /on GitHub/ })).not.toBeInTheDocument()
  })

  it('filters by branch, keeping it in the URL', async () => {
    const user = userEvent.setup()
    const router = renderAt('/tests')
    await rowOf(PASSED.title)

    await user.type(screen.getByLabelText('Branch'), ' feature/340-cache ')
    await user.click(screen.getByRole('button', { name: 'Filter' }))

    expect(await screen.findByText(IN_PROGRESS.title)).toBeInTheDocument()
    expect(screen.queryByText(PASSED.title)).not.toBeInTheDocument()
    expect(sent[sent.length - 1].params).toEqual({ branch: 'feature/340-cache' })
    expect(new URLSearchParams(router.state.location.search).get('branch')).toBe('feature/340-cache')

    await user.click(screen.getByRole('button', { name: 'All branches' }))

    expect(await screen.findByText(PASSED.title)).toBeInTheDocument()
    expect(router.state.location.search).toBe('')
  })

  it("filters to a run's branch from its row", async () => {
    const user = userEvent.setup()
    const router = renderAt('/tests')

    await user.click(within(await rowOf(IN_PROGRESS.title)).getByRole('link', { name: 'feature/340-cache' }))

    expect(new URLSearchParams(router.state.location.search).get('branch')).toBe('feature/340-cache')
    expect(await screen.findByText('feature/340-cache', { selector: 'a' })).toBeInTheDocument()
    expect(screen.queryByText(PASSED.title)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Branch')).toHaveValue('feature/340-cache')
  })

  it('opens a shared link with its branch filter applied', async () => {
    renderAt('/tests?branch=development')

    expect(await screen.findByText(PASSED.title)).toBeInTheDocument()
    expect(sent[0].params).toEqual({ branch: 'development' })
  })

  it("loads a run's report only when it's expanded, and shows failures first with their message", async () => {
    const user = userEvent.setup()
    renderAt('/tests')
    const row = await rowOf(FAILED.title)
    expect(testRequests()).toEqual([])

    const toggle = within(row).getByRole('button', { name: 'Show tests' })
    await user.click(toggle)

    expect(await screen.findByText('3 passed · 1 failed · 0 skipped · 4 total')).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(testRequests()).toEqual([expect.objectContaining({ method: 'GET', url: `/admin/ci/runs/${FAILED.id}/tests` })])
    expect(screen.getByText('development at d7c5738 · 1.3 s of test time')).toBeInTheDocument()

    const projects = screen.getByRole('table', { name: 'Test projects in run #34' })
    expect(within(projects).getAllByRole('row').slice(1).map(cells)).toEqual([
      ['FlightAssistant.API.Tests', '2', '0', '0', '1.3 s'],
      ['FlightAssistant.Application.Tests', '1', '1', '0', '19 ms'],
    ])

    const failures = screen.getByRole('region', { name: 'Failed tests in run #34' })
    expect(within(failures).getByRole('heading', { name: 'Failed tests (1)' })).toBeInTheDocument()
    const item = within(failures).getByRole('listitem')
    expect(item).toHaveTextContent('FlightAssistant.Application.Tests › GetCiRunsQueryTests.Handle_KeysTheCacheByBranchAndLimit')
    expect(item.querySelector('pre')!.textContent).toBe('Assert.Equal() Failure: Values differ\nExpected: 3\nActual:   1')

    await user.click(toggle)

    expect(screen.queryByRole('region', { name: 'Failed tests in run #34' })).not.toBeInTheDocument()
    expect(toggle).toHaveTextContent('Show tests')
  })

  it('lists every test on request', async () => {
    const user = userEvent.setup()
    renderAt('/tests')
    await user.click(within(await rowOf(FAILED.title)).getByRole('button', { name: 'Show tests' }))

    await user.click(await screen.findByRole('button', { name: 'Show all 4 tests' }))

    const all = screen.getByRole('table', { name: 'All tests in run #34' })
    expect(within(all).getAllByRole('row').slice(1).map(cells)).toEqual([
      ['FlightAssistant.API.Tests', 'AdminCiEndpointTests.Anonymous_Returns401(path: "admin/ci/runs")', 'Passed', '1.2 s'],
      ['FlightAssistant.API.Tests', 'LoyaltyEndpointTests.GetPrograms_ValidToken_Returns200', 'Passed', '67 ms'],
      ['FlightAssistant.Application.Tests', 'UpdateLoyaltyMembershipCommandHandlerTests.MembershipNotFound_Throws', 'Passed', '7 ms'],
      ['FlightAssistant.Application.Tests', 'GetCiRunsQueryTests.Handle_KeysTheCacheByBranchAndLimit', 'Failed', '12 ms'],
    ])

    await user.click(screen.getByRole('button', { name: 'Hide all tests' }))

    expect(screen.queryByRole('table', { name: 'All tests in run #34' })).not.toBeInTheDocument()
  })

  it('says when a run had no failed tests', async () => {
    const user = userEvent.setup()
    renderAt('/tests')

    await user.click(within(await rowOf(PASSED.title)).getByRole('button', { name: 'Show tests' }))

    expect(await screen.findByText('4 passed · 0 failed · 0 skipped · 4 total')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Failed tests in run #32' })).getByText('No failed tests.')).toBeInTheDocument()
  })

  it("shows the API's reason as a note, not an error, when a run has no report", async () => {
    const user = userEvent.setup()
    renderAt('/tests')

    await user.click(within(await rowOf(IN_PROGRESS.title)).getByRole('button', { name: 'Show tests' }))

    expect(await screen.findByText(
      `CI run ${IN_PROGRESS.id} has no test report. It may still be running, or it stopped before its tests reported.`,
    )).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows an error when a report fails to load for another reason', async () => {
    reports.set(FAILED.id, () => {
      throw httpError(502, { title: 'CI results are temporarily unavailable. Please try again shortly.', status: 502 })
    })
    const user = userEvent.setup()
    renderAt('/tests')

    await user.click(within(await rowOf(FAILED.title)).getByRole('button', { name: 'Show tests' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load the test report: CI results are temporarily unavailable. Please try again shortly.',
    )
  })

  it("shows the API's reason when CI runs can't be loaded, e.g. no GitHub token configured", async () => {
    installFakeApi(() => {
      throw httpError(503, { title: "CI results aren't configured on this API.", status: 503, detail: 'GitHub:Token is not set.' })
    })
    renderAt('/tests')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Could not load CI runs: CI results aren't configured on this API.")
    expect(alert).toHaveTextContent('GitHub:Token is not set.')
  })

  it('says when a branch has no runs', async () => {
    renderAt('/tests?branch=nope')

    expect(await screen.findByText('No CI runs for branch nope.')).toBeInTheDocument()
  })
})
