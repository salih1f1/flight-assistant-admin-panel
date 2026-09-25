import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  importAirlines, importAirports, importAlliances, importCountries, importLoungeProviders, importLounges,
  importLoyaltyProgramKinds, importLoyaltyPrograms,
} from '@/api/generated/admin'
import type { ImportResult } from '@/api/generated/model'
import { apiErrorMessage } from '@/lib/apiError'

type ImportStep = {
  name: string
  after: string
  matchedBy: string
  note?: string
  run: (body: { file: Blob | File }) => Promise<ImportResult>
}

/**
 * The CSV imports in the order their endpoints require (each endpoint's summary says what it
 * must run after): alliances → countries → airports → airlines → lounge providers and loyalty
 * program kinds → lounges and loyalty programs.
 */
const STEPS: ImportStep[] = [
  { name: 'Alliances', after: 'First', matchedBy: 'code', run: importAlliances },
  { name: 'Countries', after: 'After alliances', matchedBy: 'code', run: importCountries },
  { name: 'Airports', after: 'After countries', matchedBy: 'IATA code', run: importAirports },
  { name: 'Airlines', after: 'After airports', matchedBy: 'IATA code, or ICAO when there is none', run: importAirlines },
  { name: 'Lounge providers', after: 'After airlines', matchedBy: 'code', run: importLoungeProviders },
  { name: 'Loyalty program kinds', after: 'After airlines', matchedBy: 'code', run: importLoyaltyProgramKinds },
  { name: 'Lounges', after: 'After lounge providers', matchedBy: 'name, airport IATA and terminal', note: 'The Providers column is JSON.', run: importLounges },
  { name: 'Loyalty programs', after: 'After loyalty program kinds and airlines', matchedBy: 'code', note: 'The Tiers column is JSON.', run: importLoyaltyPrograms },
]

/**
 * CSV import for reference data, over POST /admin/import/{slug}. Each import upserts rows and
 * answers ImportResult: 200 when every row succeeded, 207 when some rows failed (each error
 * names its row), 400 when the file itself is rejected.
 */
export function ImportPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Import</h1>
        <p className="text-sm text-gray-500">
          Each import adds new rows and updates existing ones, and writes to the shared database. Run them in this order:
          each step depends on the ones above it.
        </p>
      </div>
      <ol className="space-y-4">
        {STEPS.map((step, index) => (
          <li key={step.name}>
            <ImportStepCard step={step} number={index + 1} />
          </li>
        ))}
      </ol>
    </div>
  )
}

function ImportStepCard({ step, number }: { step: ImportStep; number: number }) {
  const [file, setFile] = useState<File | null>(null)
  const upload = useMutation({
    // The API accepts only a text/csv part, and browsers don't agree on a .csv file's type
    // (Windows often reports application/vnd.ms-excel), so the file is re-labelled before sending.
    mutationFn: (picked: File) => step.run({ file: new File([picked], picked.name, { type: 'text/csv' }) }),
    // Imported rows can appear in any list, count or data browser view; the app's QueryClient
    // refetches all of them after every successful mutation (`refreshAfterWrite`, #180).
  })
  const fileName = upload.variables?.name ?? ''

  return (
    <section aria-label={step.name}>
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div>
            <h2 className="font-semibold text-gray-900">{`${number}. ${step.name}`}</h2>
            <p className="text-sm text-gray-500">
              {`${step.after}. Matches existing rows by ${step.matchedBy}.`}
              {step.note && ` ${step.note}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label={`CSV file for ${step.name}`}
              onChange={e => {
                setFile(e.target.files?.[0] ?? null)
                upload.reset()
              }}
              className="text-sm"
            />
            <Button onClick={() => file && upload.mutate(file)} disabled={!file || upload.isPending}>
              {upload.isPending ? 'Importing…' : 'Import'}
            </Button>
          </div>
          {upload.error ? (
            <ImportFailed fileName={fileName} error={upload.error} />
          ) : upload.data ? (
            <ImportOutcome fileName={fileName} result={upload.data} />
          ) : null}
        </CardContent>
      </Card>
    </section>
  )
}

function ImportOutcome({ fileName, result }: { fileName: string; result: ImportResult }) {
  const inserted = result.inserted ?? 0
  const updated = result.updated ?? 0
  const errors = result.errors ?? []

  if (errors.length === 0) {
    return (
      <p role="status" className="text-sm text-green-700">
        {`Imported ${fileName}: ${inserted} inserted, ${updated} updated.`}
      </p>
    )
  }

  // A 207: the rows that could be imported were; each failure names its row.
  return (
    <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <p>{`Imported ${fileName} with errors: ${inserted} inserted, ${updated} updated, ${errors.length} ${errors.length === 1 ? 'row' : 'rows'} failed.`}</p>
      <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs">
        {errors.map((error, i) => <li key={i}>{error}</li>)}
      </ul>
    </div>
  )
}

function ImportFailed({ fileName, error }: { fileName: string; error: unknown }) {
  const { title, detail } = apiErrorMessage(error)
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>{`Could not import ${fileName}: ${title}`}</p>
      {detail && <p className="mt-1 text-xs text-red-600">{detail}</p>}
    </div>
  )
}
