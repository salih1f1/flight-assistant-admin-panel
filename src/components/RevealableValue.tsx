import { useState } from 'react'
import { EyeOff, Lock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useAdminRevealValue } from '@/api/generated/admin'
import { apiErrorMessage } from '@/lib/apiError'

/** How the panel shows a value the API masked (SensitiveProperties.RedactedPlaceholder). */
export function MaskedBadge() {
  return (
    <Badge variant="secondary" className="gap-1" title="Masked by the API">
      <Lock className="h-3 w-3" />
      Masked
    </Badge>
  )
}

/**
 * A masked value that can be revealed through POST /admin/data/{table}/{id}/reveal, which
 * writes an audit row before answering. Asks first, then shows the value with a Hide button.
 *
 * The revealed value lives only in this component's state: never in the URL or the query
 * cache. Callers key it by table, id and column, so a different row or a changed view mounts a
 * fresh, masked one.
 */
export function RevealableValue({ table, id, column }: { table: string; id: string; column: string }) {
  const [revealed, setRevealed] = useState<{ value: unknown } | null>(null)
  const [asking, setAsking] = useState(false)
  // gcTime 0: the mutation cache must not keep a revealed value after this component lets go of it.
  const reveal = useAdminRevealValue({ mutation: { gcTime: 0 } })

  const close = () => {
    reveal.reset()
    setAsking(false)
  }

  const confirm = () =>
    reveal.mutate(
      { table, id, data: { column } },
      {
        onSuccess: result => {
          setRevealed({ value: result.value })
          setAsking(false)
          reveal.reset()
        },
      },
    )

  if (revealed) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="rounded bg-amber-50 px-1 text-amber-900">{formatValue(revealed.value)}</span>
        <button type="button" aria-label={`Hide ${column}`} title="Hide" onClick={() => setRevealed(null)} className="text-gray-400 hover:text-gray-700">
          <EyeOff className="h-3.5 w-3.5" />
        </button>
      </span>
    )
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Reveal ${column}`}
        title="Reveal (audited)"
        onClick={() => {
          reveal.reset()
          setAsking(true)
        }}
      >
        <MaskedBadge />
      </button>
      <Dialog open={asking} onOpenChange={open => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`Reveal ${column}?`}</DialogTitle>
            <DialogDescription>
              {`Row ${id}. The value is shown in this view only, and the reveal is recorded in the admin audit log under your account.`}
            </DialogDescription>
          </DialogHeader>
          {reveal.error ? <RevealError error={reveal.error} /> : null}
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={reveal.isPending}>Cancel</Button>
            <Button onClick={confirm} disabled={reveal.isPending}>{reveal.isPending ? 'Revealing…' : 'Reveal'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

const formatValue = (value: unknown) =>
  value === null || value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)

function RevealError({ error }: { error: unknown }) {
  // The reveal rate limiter answers with plain text rather than ProblemDetails, and its
  // Retry-After header isn't exposed over CORS, so the reason has to be said here.
  const status = (error as { response?: { status?: number } } | null)?.response?.status
  const { title, detail } = status === 429
    ? { title: 'Too many reveals in a short time.', detail: 'The API limits how often values can be revealed. Try again shortly.' }
    : apiErrorMessage(error)
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>{title}</p>
      {detail && <p className="mt-1 text-xs text-red-600">{detail}</p>}
    </div>
  )
}
