import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useLoyaltyProgram, useCreateLoyaltyProgram, useUpdateLoyaltyProgram } from '@/hooks/useLoyalty'

const schema = z.object({
  code: z.string().min(1, 'Required'),
  name: z.string().min(1, 'Required'),
  kindId: z.coerce.number().int().min(1, 'Required'),
  airlineId: z.coerce.number().int().optional(),
  allianceCode: z.string().optional(),
})

type FormData = z.infer<typeof schema>

export function LoyaltyProgramFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = id !== 'new' && id !== undefined
  const navigate = useNavigate()
  const { data: existing } = useLoyaltyProgram(isEdit ? Number(id) : undefined)
  const createMutation = useCreateLoyaltyProgram()
  const updateMutation = useUpdateLoyaltyProgram()

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    if (existing) reset({
      code: existing.code,
      name: existing.name,
      kindId: 1,
      airlineId: existing.airlineId ?? undefined,
      allianceCode: existing.allianceCode ?? '',
    })
  }, [existing, reset])

  const onSubmit = (data: FormData) => {
    const payload = { ...data, allianceCode: data.allianceCode || undefined }
    if (isEdit) {
      updateMutation.mutate({ id: Number(id), data: payload }, { onSuccess: () => navigate('/loyalty') })
    } else {
      createMutation.mutate(payload, { onSuccess: () => navigate('/loyalty') })
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">{isEdit ? 'Edit loyalty program' : 'New loyalty program'}</h1>
      <Card>
        <CardHeader><CardTitle className="text-base">Program details</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Code <span className="text-red-500">*</span></Label>
                <Input {...register('code')} placeholder="e.g. EXEC_CLUB" />
                {errors.code && <p className="text-xs text-red-500">{errors.code.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Kind ID <span className="text-red-500">*</span></Label>
                <Input type="number" {...register('kindId')} />
                {errors.kindId && <p className="text-xs text-red-500">{errors.kindId.message}</p>}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Name <span className="text-red-500">*</span></Label>
              <Input {...register('name')} />
              {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Airline ID</Label>
                <Input type="number" {...register('airlineId')} placeholder="optional" />
              </div>
              <div className="space-y-1.5">
                <Label>Alliance code</Label>
                <Input {...register('allianceCode')} placeholder="STAR / OW / ST" />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {isEdit ? 'Save changes' : 'Create program'}
              </Button>
              <Button type="button" variant="outline" onClick={() => navigate('/loyalty')}>Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
