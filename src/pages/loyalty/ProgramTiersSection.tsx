import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAdminDeleteLoyaltyTier } from '@/api/generated/admin'
import type { LoyaltyTierDto } from '@/api/generated/model'
import { useLoyaltyProgram } from '@/api/loyaltyLookups'
import { apiErrorMessage } from '@/lib/apiError'
import { TierDialog } from './TierDialog'

const tierName = (tier: LoyaltyTierDto) => tier.name ?? tier.code ?? `#${tier.id}`

/** A tier's alliance pair as one column: the alliance, then its tier there. Neither is common. */
function allianceLabel(tier: LoyaltyTierDto) {
  const parts = [tier.allianceCode, tier.allianceTierCode].filter(Boolean)
  return parts.length === 0 ? '—' : parts.join(' / ')
}

/**
 * A loyalty program's tiers, on the program's own record page: the list, ordered by rank, and the
 * add, edit and delete the API allows on them. Tiers belong to a program — this is where they are
 * read and written, rather than in a flat grid of every program's tiers.
 *
 * The tiers come from the program itself (GET /admin/loyalty/programs returns them nested), so the
 * program list is what a tier write shows up in.
 */
export function ProgramTiersSection({ programId }: { programId: number }) {
  const { data: program, isLoading, isError } = useLoyaltyProgram(programId)
  const [editing, setEditing] = useState<LoyaltyTierDto | undefined>()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState<LoyaltyTierDto | undefined>()

  // Rank orders a program's tiers from entry level upwards; the API doesn't promise that order.
  const tiers = [...(program?.tiers ?? [])].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))

  const open = (tier?: LoyaltyTierDto) => {
    setEditing(tier)
    setDialogOpen(true)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-base">Tiers</CardTitle>
        <Button size="sm" variant="outline" onClick={() => open()} disabled={!program}>Add tier</Button>
      </CardHeader>
      <CardContent>
        {isError ? (
          <p className="text-sm text-red-600">Could not load this program's tiers.</p>
        ) : isLoading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : tiers.length === 0 ? (
          <p className="text-sm text-gray-500">This program has no tiers.</p>
        ) : (
          <Table aria-label="Tiers">
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Rank</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Alliance</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tiers.map(tier => (
                <TableRow key={tier.id}>
                  <TableCell>{tier.rank ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{tier.code ?? '—'}</TableCell>
                  <TableCell>{tier.name ?? '—'}</TableCell>
                  <TableCell>{allianceLabel(tier)}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Edit tier ${tierName(tier)}`}
                        title="Edit"
                        onClick={() => open(tier)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Delete tier ${tierName(tier)}`}
                        title="Delete"
                        className="text-red-500 hover:text-red-700"
                        onClick={() => setDeleting(tier)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <TierDialog programId={programId} tier={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
      <DeleteTierDialog programId={programId} tier={deleting} onClose={() => setDeleting(undefined)} />
    </Card>
  )
}

/**
 * Confirms deleting one tier. It says what the deletion costs: a membership's TierId is
 * ON DELETE SET NULL, so travelers on the tier keep their membership and lose the tier rather
 * than the delete being refused.
 */
function DeleteTierDialog({ programId, tier, onClose }: {
  programId: number
  tier?: LoyaltyTierDto
  onClose: () => void
}) {
  const deleteMutation = useAdminDeleteLoyaltyTier()
  const [failure, setFailure] = useState<ReturnType<typeof apiErrorMessage>>()

  const confirm = () => {
    if (!tier?.id) return
    setFailure(undefined)
    deleteMutation.mutate({ programId, tierId: tier.id }, {
      onSuccess: () => onClose(),
      onError: error => setFailure(apiErrorMessage(error)),
    })
  }

  const close = (open: boolean) => {
    if (open) return
    setFailure(undefined)
    onClose()
  }

  return (
    <Dialog open={tier !== undefined} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete tier</DialogTitle>
          <DialogDescription>
            {tier && `Deletes ${tierName(tier)} from this program. Travelers on it keep their membership and lose the tier.`}
          </DialogDescription>
        </DialogHeader>

        {failure && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <p>{failure.title}</p>
            {failure.detail && <p className="mt-1 text-xs text-red-600">{failure.detail}</p>}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={deleteMutation.isPending}>Cancel</Button>
          <Button type="button" variant="destructive" onClick={confirm} disabled={deleteMutation.isPending}>
            {deleteMutation.isPending ? 'Deleting…' : 'Delete tier'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
