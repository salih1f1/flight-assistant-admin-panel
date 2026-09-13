import { useMutation } from '@tanstack/react-query'
import type { AxiosRequestConfig } from 'axios'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  exportAirlines, exportAirports, exportAlliances, exportCountries, exportLoungeProviders, exportLounges,
  exportLoyaltyProgramKinds, exportLoyaltyPrograms,
} from '@/api/generated/admin'
import { apiErrorMessage } from '@/lib/apiError'
import { readBlobText } from '@/lib/readBlobText'

/**
 * GET /admin/export/{slug} for the 8 verifiable tables. The spec declares no response
 * body, so the generated functions are typed void; asking axios for a blob returns the CSV.
 */
const EXPORTERS: Record<string, (options: AxiosRequestConfig) => Promise<unknown>> = {
  airports: exportAirports,
  airlines: exportAirlines,
  alliances: exportAlliances,
  countries: exportCountries,
  lounges: exportLounges,
  'lounge-providers': exportLoungeProviders,
  'loyalty-programs': exportLoyaltyPrograms,
  'loyalty-program-kinds': exportLoyaltyProgramKinds,
}

/**
 * Downloads a table's verified rows as CSV. Renders nothing for a table the API can't export.
 * The file name is the API's own (`{slug}-export.csv`): Content-Disposition isn't exposed over
 * CORS, so the browser can't read it from the response.
 */
export function ExportCsvButton({ table, tableName }: { table: string; tableName: string }) {
  const exporter = EXPORTERS[table]
  const download = useMutation({
    mutationFn: async () => {
      try {
        const csv = (await exporter({ responseType: 'blob' })) as Blob
        saveFile(csv, `${table}-export.csv`)
      } catch (error) {
        throw await withReadableBody(error)
      }
    },
  })

  if (!exporter) return null

  return (
    <div className="space-y-2">
      <Button variant="outline" onClick={() => download.mutate()} disabled={download.isPending}>
        <Download className="mr-2 h-4 w-4" />
        {download.isPending ? 'Exporting…' : 'Export verified CSV'}
      </Button>
      {download.error && <ExportError tableName={tableName} error={download.error} />}
    </div>
  )
}

function saveFile(file: Blob, name: string) {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Released on the next tick: some browsers cancel a download whose URL is revoked during the click.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * A blob request gets its error body as a Blob too, so the API's ProblemDetails can't be read
 * until it's parsed. Replaces the body with the parsed JSON when it is JSON; leaves it otherwise.
 */
async function withReadableBody(error: unknown): Promise<unknown> {
  const response = (error as { response?: { data?: unknown } } | null)?.response
  if (response?.data instanceof Blob) {
    try {
      response.data = JSON.parse(await readBlobText(response.data))
    } catch {
      // Not JSON: apiErrorMessage falls back to the error's own message.
    }
  }
  return error
}

function ExportError({ tableName, error }: { tableName: string; error: unknown }) {
  const { title, detail } = apiErrorMessage(error)
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>{`Could not export ${tableName}: ${title}`}</p>
      {detail && <p className="mt-1 text-xs text-red-600">{detail}</p>}
    </div>
  )
}
