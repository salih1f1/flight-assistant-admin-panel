import { Fragment, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAdminGetCiRunTests, useAdminGetCiRuns } from '@/api/generated/admin'
import type { CiRunDto, CiTestCaseDto, CiTestReportDto } from '@/api/generated/model'
import { apiErrorMessage } from '@/lib/apiError'
import { formatUtcMinute } from '@/lib/formatUtc'
import { cn } from '@/lib/utils'

/**
 * The backend's CI runs (GET /admin/ci/runs), newest first. A run's test report
 * (GET /admin/ci/runs/{id}/tests) loads only when the run is expanded: pass/fail counts
 * live inside each run's report, about 275 KB apiece, so one per row would be megabytes
 * per visit.
 */
export function TestsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const branch = searchParams.get('branch') ?? ''
  const { data, isLoading, error } = useAdminGetCiRuns(branch ? { branch } : undefined)
  const runs = data ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Tests</h1>
        <p className="text-sm text-gray-500">Recent runs of the backend's CI workflow, newest first. Expand a run for its test results.</p>
      </div>

      <BranchFilter key={branch} branch={branch} onApply={next => setSearchParams(next ? { branch: next } : {})} />

      {error ? (
        <ErrorAlert prefix="Could not load CI runs" error={error} />
      ) : isLoading ? (
        <p className="text-gray-400">Loading…</p>
      ) : (
        <Card>
          <CardContent className="pt-6">
            {runs.length === 0 ? (
              <p className="text-sm text-gray-500">{branch ? `No CI runs for branch ${branch}.` : 'No CI runs yet.'}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Result</TableHead>
                      <TableHead>Run</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead>Commit</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead className="text-right">Duration</TableHead>
                      <TableHead><span className="sr-only">Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map(run => <RunRow key={run.id} run={run} />)}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function RunRow({ run }: { run: CiRunDto }) {
  const [open, setOpen] = useState(false)
  const started = run.startedUtc ?? run.createdUtc
  const attempt = (run.runAttempt ?? 1) > 1 ? ` · attempt ${run.runAttempt}` : ''

  return (
    <Fragment>
      <TableRow>
        <TableCell><RunResult run={run} /></TableCell>
        <TableCell>
          <div className="font-medium text-gray-900">{run.title || '—'}</div>
          <div className="text-xs text-gray-500">{`#${run.runNumber} · ${run.event || '—'}${attempt}`}</div>
        </TableCell>
        <TableCell>
          {run.branch ? (
            <Link to={{ search: `?branch=${encodeURIComponent(run.branch)}` }} className="underline">{run.branch}</Link>
          ) : '—'}
        </TableCell>
        <TableCell className="font-mono text-xs">{run.commitSha ? run.commitSha.slice(0, 7) : '—'}</TableCell>
        <TableCell className="whitespace-nowrap">{started ? `${formatUtcMinute(started)} UTC` : '—'}</TableCell>
        <TableCell className="whitespace-nowrap text-right">{formatSeconds(run.durationSeconds)}</TableCell>
        <TableCell className="whitespace-nowrap text-right">
          {run.id != null && (
            <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(o => !o)}>
              {open ? 'Hide tests' : 'Show tests'}
            </Button>
          )}
          {isGitHubUrl(run.htmlUrl) && (
            <a
              href={run.htmlUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`Run #${run.runNumber} on GitHub`}
              className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </TableCell>
      </TableRow>
      {open && run.id != null && (
        <TableRow>
          <TableCell colSpan={7} className="bg-gray-50">
            <RunTests runId={run.id} runNumber={run.runNumber} />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  )
}

// GitHub conclusions (and statuses, for a run still going) that get a colour; the rest stay grey.
const RESULT_TONES: Record<string, string> = {
  success: 'bg-green-100 text-green-800',
  failure: 'bg-red-100 text-red-800',
  timed_out: 'bg-red-100 text-red-800',
  startup_failure: 'bg-red-100 text-red-800',
  in_progress: 'bg-amber-100 text-amber-800',
  queued: 'bg-amber-100 text-amber-800',
}

function RunResult({ run }: { run: CiRunDto }) {
  // A conclusion only exists once the run has completed; until then its status is the result.
  const result = (run.status === 'completed' ? run.conclusion : run.status) || 'unknown'
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', RESULT_TONES[result] ?? 'bg-gray-100 text-gray-700')}>
      {humanize(result)}
    </span>
  )
}

function RunTests({ runId, runNumber }: { runId: number; runNumber: number | undefined }) {
  const { data, isLoading, error } = useAdminGetCiRunTests(runId)

  if (error) {
    const response = (error as { response?: { status?: number; data?: { title?: string } } } | null)?.response
    // A 404 is an expected state, not a failure: the run is still going, stopped before its tests
    // reported, or its report expired. The API's title says which.
    if (response?.status === 404)
      return <p className="text-sm text-gray-600">{response.data?.title ?? 'This run has no test report.'}</p>
    return <ErrorAlert prefix="Could not load the test report" error={error} />
  }
  if (isLoading || !data) return <p className="text-sm text-gray-400">Loading test report…</p>

  return <Report report={data} runNumber={runNumber} />
}

function Report({ report, runNumber }: { report: CiTestReportDto; runNumber: number | undefined }) {
  const [showAll, setShowAll] = useState(false)
  const suites = report.suites ?? []
  const failures = suites.flatMap(suite =>
    (suite.tests ?? []).filter(test => test.outcome === 'Failed').map(test => ({ suite: suite.suite ?? '', test })),
  )
  const total = report.total ?? 0
  const failed = report.failed ?? 0

  return (
    <div className="space-y-4">
      <div>
        <p className={cn('text-sm font-medium', failed > 0 ? 'text-red-700' : 'text-green-700')}>
          {`${report.passed ?? 0} passed · ${failed} failed · ${report.skipped ?? 0} skipped · ${total} total`}
        </p>
        <p className="text-xs text-gray-500">
          {`${report.ref || '—'} at ${report.commit ? report.commit.slice(0, 7) : '—'} · ${formatMs(report.durationMs)} of test time`}
        </p>
      </div>

      <table aria-label={`Test projects in run #${runNumber}`} className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500">
            <th className="py-1 pr-4 font-medium">Project</th>
            <th className="py-1 pr-4 text-right font-medium">Passed</th>
            <th className="py-1 pr-4 text-right font-medium">Failed</th>
            <th className="py-1 pr-4 text-right font-medium">Skipped</th>
            <th className="py-1 text-right font-medium">Test time</th>
          </tr>
        </thead>
        <tbody>
          {suites.map(suite => (
            <tr key={suite.suite}>
              <td className="py-1 pr-4 font-mono text-xs">{suite.suite}</td>
              <td className="py-1 pr-4 text-right">{suite.passed ?? 0}</td>
              <td className={cn('py-1 pr-4 text-right', (suite.failed ?? 0) > 0 && 'font-medium text-red-700')}>{suite.failed ?? 0}</td>
              <td className="py-1 pr-4 text-right">{suite.skipped ?? 0}</td>
              <td className="py-1 text-right">{formatMs(suite.durationMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section aria-label={`Failed tests in run #${runNumber}`} className="space-y-2">
        {failures.length === 0 ? (
          <p className="text-sm text-gray-600">No failed tests.</p>
        ) : (
          <>
            <h3 className="text-sm font-semibold text-gray-900">{`Failed tests (${failures.length})`}</h3>
            <ul className="space-y-3">
              {failures.map(({ suite, test }) => (
                <li key={`${suite}|${test.name}`}>
                  <p className="font-mono text-xs text-gray-900">{`${suite} › ${testLabel(test)}`}</p>
                  <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-red-200 bg-white p-2 text-xs text-red-800">
                    {test.message || 'No failure message recorded.'}
                  </pre>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {total > 0 && (
        <div className="space-y-2">
          <Button variant="outline" size="sm" aria-expanded={showAll} onClick={() => setShowAll(s => !s)}>
            {showAll ? 'Hide all tests' : `Show all ${total} tests`}
          </Button>
          {showAll && (
            <div className="overflow-x-auto">
              <table aria-label={`All tests in run #${runNumber}`} className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="py-1 pr-4 font-medium">Project</th>
                    <th className="py-1 pr-4 font-medium">Test</th>
                    <th className="py-1 pr-4 font-medium">Outcome</th>
                    <th className="py-1 text-right font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {suites.flatMap(suite =>
                    (suite.tests ?? []).map(test => (
                      <tr key={`${suite.suite}|${test.name}`}>
                        <td className="py-1 pr-4 font-mono text-xs">{suite.suite}</td>
                        <td className="py-1 pr-4 font-mono text-xs">{testLabel(test)}</td>
                        <td className={cn('py-1 pr-4', test.outcome === 'Failed' && 'font-medium text-red-700')}>{test.outcome}</td>
                        <td className="py-1 text-right">{formatMs(test.durationMs)}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function BranchFilter({ branch, onApply }: { branch: string; onApply: (branch: string) => void }) {
  const [draft, setDraft] = useState(branch)

  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-md border border-gray-200 bg-white p-4"
      onSubmit={e => {
        e.preventDefault()
        onApply(draft.trim())
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="ci-branch">Branch</Label>
        <Input id="ci-branch" value={draft} onChange={e => setDraft(e.target.value)} placeholder="All branches" />
      </div>
      <Button type="submit">Filter</Button>
      {branch && <Button type="button" variant="outline" onClick={() => onApply('')}>All branches</Button>}
    </form>
  )
}

function ErrorAlert({ prefix, error }: { prefix: string; error: unknown }) {
  const { title, detail } = apiErrorMessage(error)
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>{`${prefix}: ${title}`}</p>
      {detail && <p className="mt-1 text-xs text-red-600">{detail}</p>}
    </div>
  )
}

/** "success" → "Success", "timed_out" → "Timed out". */
const humanize = (value: string) => {
  const words = value.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The link comes from GitHub through the API; anything else (a javascript: URL, say) isn't rendered as one. */
const isGitHubUrl = (url: string | null | undefined): url is string => !!url && url.startsWith('https://github.com/')

/** "Namespace.LoungeTests.Verify_Sets(x: 1)" with class "LoungeTests" → "LoungeTests.Verify_Sets(x: 1)". */
function testLabel(test: CiTestCaseDto) {
  const name = test.name ?? ''
  const cls = test.class
  if (!cls) return name
  const at = name.indexOf(`${cls}.`)
  return at >= 0 ? name.slice(at) : name
}

function formatSeconds(seconds: number | null | undefined) {
  if (seconds == null) return '—'
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function formatMs(ms: number | null | undefined) {
  if (ms == null) return '—'
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}
