import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpError, installFakeApi, type SentRequest } from '@/test/fakeApi'
import { renderWithProviders } from '@/test/renderWithProviders'
import type { AdminJobDto, AppServiceStatusDto } from '@/api/generated/model'
import { JobsSection } from './JobsSection'

vi.mock('@/api/client', () => ({
  apiClient: { request: vi.fn() },
}))

/** One row as GET /admin/jobs sends it, with the fields a test doesn't care about filled in. */
const job = (overrides: Partial<AdminJobDto> = {}): AdminJobDto => ({
  job: 'flight-sync',
  displayName: 'Flight status sync',
  configEnabled: true,
  switchEnabled: true,
  effectiveEnabled: true,
  canToggle: true,
  changedUtc: null,
  changedBy: null,
  reason: null,
  lastOutcome: 'Success',
  lastRunUtc: '2026-09-19T09:00:00Z',
  ...overrides,
})

let sent: SentRequest[]

/**
 * A site that is up with Always On enabled — the state in which the section says nothing extra.
 * Every test that is not about hosting gets this, so a note appearing in one of them is a signal
 * rather than noise.
 */
const ALWAYS_ON: AppServiceStatusDto = { state: 'Ok', alwaysOn: true }

function renderWith(
  jobs: AdminJobDto[],
  onToggle?: (req: SentRequest) => unknown,
  appService: AppServiceStatusDto = ALWAYS_ON,
) {
  ;({ sent } = installFakeApi(async req => {
    if (req.method === 'GET' && req.url === '/admin/jobs') return jobs
    if (req.method === 'GET' && req.url === '/admin/health/app-service') return appService
    if (req.method === 'PUT' && req.url.startsWith('/admin/jobs/')) {
      return onToggle ? onToggle(req) : { ...jobs[0], switchEnabled: false, effectiveEnabled: false }
    }
    throw new Error(`unexpected ${req.method} ${req.url}`)
  }))
  return renderWithProviders(<JobsSection />)
}

describe('JobsSection', () => {
  beforeEach(() => { sent = [] })

  // The point of the whole feature (#188). This section says "Running" in green; with Always On
  // off that is only true while someone is using the panel, because App Service unloads the app
  // after ~20 minutes idle and IHostedService stops with it.
  describe('the Always On note', () => {
    it('warns that the jobs pause when the app is unloaded', async () => {
      renderWith([job()], undefined, { state: 'Ok', alwaysOn: false })

      expect(await screen.findByText(/pause and resume with traffic/i)).toBeInTheDocument()
    })

    it('names the remedy', async () => {
      renderWith([job()], undefined, { state: 'Ok', alwaysOn: false })

      expect(await screen.findByText(/always on/i)).toBeInTheDocument()
    })

    // A deliberate hosting choice is not a fault: leaving Always On off is cheaper, and with the
    // jobs idle a forgotten test flight cannot poll overnight. Same rule NotConfigured follows on
    // the source rows, and an operator stop follows on these very rows.
    it('renders the warning in amber, not red', async () => {
      renderWith([job()], undefined, { state: 'Ok', alwaysOn: false })

      expect(await screen.findByText(/pause and resume with traffic/i)).toHaveClass('text-amber-600')
    })

    it('says nothing when Always On is enabled', async () => {
      renderWith([job()], undefined, { state: 'Ok', alwaysOn: true })
      await screen.findByText('Running')

      expect(screen.queryByText(/pause and resume/i)).not.toBeInTheDocument()
    })

    // Unknown is not false. A refusal never learned whether Always On is on, and a warning drawn
    // from a value we never read would have no evidence behind it — the inverse of the $0.00 bug:
    // inventing a fault rather than hiding one.
    it.each([
      ['NotAuthorized', 'the managed identity lacks Reader'],
      ['Unavailable', 'ARM could not be reached'],
      ['NotConfigured', 'not hosted on App Service at all'],
    ])('says nothing when the App Service read returned %s', async state => {
      renderWith([job()], undefined, { state, alwaysOn: null })
      await screen.findByText('Running')

      expect(screen.queryByText(/pause and resume/i)).not.toBeInTheDocument()
    })

    // A SUCCESSFUL read that still does not know. The backend returns Ok with alwaysOn null when
    // the ARM response carries no siteConfig, so this is a real state, not a hypothetical — and it
    // is the one case the state check above cannot catch, because the state is Ok. Added after
    // breaking the guard to `!alwaysOn` and finding only the undefined case failed: every other
    // "says nothing" test was being saved by the state check rather than by the null check.
    it.each([
      ['null', null],
      ['absent', undefined],
    ])('says nothing when an Ok read reports alwaysOn as %s', async (_label, alwaysOn) => {
      renderWith([job()], undefined, { state: 'Ok', alwaysOn })
      await screen.findByText('Running')

      expect(screen.queryByText(/pause and resume/i)).not.toBeInTheDocument()
    })

    // Belt and braces, and it is the state check's only test. The backend nulls every fact on a
    // refusal (proven there by ARefusal_ReportsNoFactsAtAll), so alwaysOn: false alongside a failed
    // state should be unreachable — but the panel must not DEPEND on that. Found by deleting the
    // state check and watching all 26 tests still pass: every other "says nothing" case pairs a
    // failed state with a null alwaysOn, so the null check alone was carrying them.
    it.each(['NotAuthorized', 'Unavailable', 'NotConfigured'])(
      'refuses to warn from a %s read even if it carries alwaysOn false',
      async state => {
        renderWith([job()], undefined, { state, alwaysOn: false })
        await screen.findByText('Running')

        expect(screen.queryByText(/pause and resume/i)).not.toBeInTheDocument()
      },
    )

    // The jobs table is the point of the section; the note must never replace it or block it.
    it('still renders the jobs when the App Service read fails outright', async () => {
      installFakeApi(async req => {
        if (req.method === 'GET' && req.url === '/admin/jobs') return [job()]
        if (req.method === 'GET' && req.url === '/admin/health/app-service') throw httpError(500, 'boom')
        throw new Error(`unexpected ${req.method} ${req.url}`)
      })
      renderWithProviders(<JobsSection />)

      expect(await screen.findByText('Running')).toBeInTheDocument()
      expect(screen.queryByText(/pause and resume/i)).not.toBeInTheDocument()
    })
  })

  it('shows a running job as running', async () => {
    renderWith([job()])

    expect(await screen.findByText('Running')).toBeInTheDocument()
  })

  // A deliberate stop is not a fault. Same rule the data-source rows follow, where NotConfigured
  // is gray rather than red: a chosen state must never render like a failure.
  it('shows a switched-off job in amber, not red', async () => {
    renderWith([job({ switchEnabled: false, effectiveEnabled: false })])

    expect(await screen.findByText('Switched off')).toHaveClass('text-amber-600')
  })

  it('says who switched a job off, when, and why', async () => {
    renderWith([job({
      switchEnabled: false,
      effectiveEnabled: false,
      changedUtc: '2026-09-19T02:14:00Z',
      changedBy: 'salihalishov@gmail.com',
      reason: 'burning AeroAPI budget',
    })])

    expect(await screen.findByText(/salihalishov@gmail.com/)).toBeInTheDocument()
    expect(screen.getByText(/2026-09-19 02:14 UTC/)).toBeInTheDocument()
    expect(screen.getByText(/burning AeroAPI budget/)).toBeInTheDocument()
  })

  // The toggle is disabled and explained, never hidden: a missing control makes an operator hunt
  // for a feature that is present but barred.
  it('disables the toggle when config has the job off, and names the config key', async () => {
    renderWith([job({ configEnabled: false, effectiveEnabled: false, canToggle: false })])

    expect(await screen.findByRole('button', { name: /switch/i })).toBeDisabled()
    expect(screen.getByText(/FlightSync:Enabled/)).toBeInTheDocument()
  })

  it('names the right config key for the verification job', async () => {
    renderWith([job({
      job: 'verification', displayName: 'Reference verification',
      configEnabled: false, effectiveEnabled: false, canToggle: false,
    })])

    expect(await screen.findByText(/Verification:Enabled/)).toBeInTheDocument()
  })

  // Switching off stops the scheduled loop, not the feature. Saying so is what stops the toggle
  // reading as something people hesitate to use.
  it('says manual runs still work while a job is off', async () => {
    renderWith([job({ switchEnabled: false, effectiveEnabled: false })])

    expect(await screen.findByText(/manual .*still/i)).toBeInTheDocument()
  })

  it('asks for a reason before switching a job off, and sends it', async () => {
    renderWith([job()])
    await userEvent.click(await screen.findByRole('button', { name: /switch off/i }))

    await userEvent.type(screen.getByLabelText(/reason/i), 'burning AeroAPI budget')
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => {
      const put = sent.find(r => r.method === 'PUT')
      expect(put?.url).toBe('/admin/jobs/flight-sync')
      expect(put?.data).toMatchObject({ enabled: false, reason: 'burning AeroAPI budget' })
    })
  })

  // The reason is optional at the API, so the panel must not invent a requirement the backend
  // does not have.
  it('allows switching off without a reason', async () => {
    renderWith([job()])
    await userEvent.click(await screen.findByRole('button', { name: /switch off/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => expect(sent.find(r => r.method === 'PUT')).toBeDefined())
  })

  // Switching ON is the recovery action. Making someone justify restarting a job they are trying
  // to restore would be friction at exactly the wrong moment.
  it('does not ask for a reason when switching a job back on', async () => {
    renderWith([job({ switchEnabled: false, effectiveEnabled: false })])

    await userEvent.click(await screen.findByRole('button', { name: /switch on/i }))

    await waitFor(() => {
      const put = sent.find(r => r.method === 'PUT')
      expect(put?.data).toMatchObject({ enabled: true })
    })
    expect(screen.queryByLabelText(/reason/i)).not.toBeInTheDocument()
  })

  // A 409 is the config ceiling refusing, not the job changing state. Rendering it as a successful
  // toggle would tell an operator the opposite of what happened.
  it('reports a refused toggle without claiming the job changed', async () => {
    renderWith([job()], () => { throw httpError(409, { title: 'FlightSync:Enabled is false in this environment.', status: 409 }) })

    await userEvent.click(await screen.findByRole('button', { name: /switch off/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))

    expect(await screen.findByText(/FlightSync:Enabled is false in this environment/)).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
  })

  it('shows both jobs', async () => {
    renderWith([job(), job({ job: 'verification', displayName: 'Reference verification' })])

    expect(await screen.findByText('Flight status sync')).toBeInTheDocument()
    expect(screen.getByText('Reference verification')).toBeInTheDocument()
  })

  it('says when the API cannot be read', async () => {
    ;({ sent } = installFakeApi(async () => { throw httpError(503, { title: 'Database unavailable.', status: 503 }) }))
    renderWithProviders(<JobsSection />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/Database unavailable/)
  })

  // The backend freezes nextRunDueUtc while a job is off and /admin/health still reports the config
  // flag, so a switched-off job must never be dressed up as late or broken here.
  it('does not describe a switched-off job as overdue', async () => {
    renderWith([job({
      switchEnabled: false, effectiveEnabled: false, lastOutcome: 'SwitchedOff',
      lastRunUtc: '2026-01-01T00:00:00Z',
    })])

    await screen.findByText('Switched off')
    expect(screen.queryByText(/overdue|stale|late/i)).not.toBeInTheDocument()
  })

  it('shows the last run time', async () => {
    renderWith([job({ lastRunUtc: '2026-09-19T09:00:00Z' })])

    expect(await screen.findByText(/2026-09-19 09:00 UTC/)).toBeInTheDocument()
  })

  it('refetches after a successful toggle, so the row reflects the new state', async () => {
    renderWith([job()])
    await userEvent.click(await screen.findByRole('button', { name: /switch off/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => {
      expect(sent.filter(r => r.method === 'GET' && r.url === '/admin/jobs').length).toBeGreaterThan(1)
    })
  })

  it('leaves the other job alone when one is toggled', async () => {
    renderWith([job(), job({ job: 'verification', displayName: 'Reference verification' })])

    const row = (await screen.findByText('Flight status sync')).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: /switch off/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => {
      expect(sent.find(r => r.method === 'PUT')?.url).toBe('/admin/jobs/flight-sync')
    })
  })
})
