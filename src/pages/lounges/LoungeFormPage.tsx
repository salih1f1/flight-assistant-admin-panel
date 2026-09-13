import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useLounge, useCreateLounge, useUpdateLounge } from '@/hooks/useLounges'

const schema = z.object({
  airportId: z.coerce.number().int().positive('Airport ID is required'),
  name: z.string().min(1, 'Name is required'),
  terminal: z.string().optional(),
  hours: z.string().optional(),
  // The API's name for this field (AdminLoungeDto, Create/UpdateLoungeRequest).
  locationHint: z.string().optional(),
  amenities: z.string().optional(),
  isAirside: z.boolean(),
  isDomesticOnly: z.boolean(),
  isInternationalOnly: z.boolean(),
})

// The form holds raw input values (coerced fields are `unknown` until parsed);
// handleSubmit receives the parsed output.
type FormInput = z.input<typeof schema>
type FormValues = z.output<typeof schema>

export function LoungeFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const navigate = useNavigate()
  const { data: lounge, isLoading } = useLounge(isEdit ? Number(id) : undefined)
  const createMutation = useCreateLounge()
  const updateMutation = useUpdateLounge()

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      isAirside: false,
      isDomesticOnly: false,
      isInternationalOnly: false,
    },
  })

  useEffect(() => {
    if (lounge) {
      reset({
        airportId: lounge.airportId,
        name: lounge.name,
        terminal: lounge.terminal ?? '',
        hours: lounge.hours ?? '',
        locationHint: lounge.locationHint ?? '',
        amenities: lounge.amenities ?? '',
        isAirside: lounge.isAirside,
        isDomesticOnly: lounge.isDomesticOnly,
        isInternationalOnly: lounge.isInternationalOnly,
      })
    }
  }, [lounge, reset])

  const onSubmit = (values: FormValues) => {
    const payload = {
      ...values,
      terminal: values.terminal || undefined,
      hours: values.hours || undefined,
      locationHint: values.locationHint || undefined,
      amenities: values.amenities || undefined,
    }

    if (isEdit) {
      updateMutation.mutate({ id: Number(id), ...payload }, { onSuccess: () => navigate('/lounges') })
    } else {
      createMutation.mutate(payload, { onSuccess: () => navigate('/lounges') })
    }
  }

  if (isEdit && isLoading) return <p className="text-gray-400">Loading…</p>

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">{isEdit ? 'Edit lounge' : 'New lounge'}</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="airportId">Airport ID</Label>
          <Input id="airportId" type="number" {...register('airportId')} />
          {errors.airportId && <p className="text-sm text-red-500">{errors.airportId.message}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="name">Name</Label>
          <Input id="name" {...register('name')} />
          {errors.name && <p className="text-sm text-red-500">{errors.name.message}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="terminal">Terminal</Label>
          <Input id="terminal" {...register('terminal')} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="hours">Hours</Label>
          <Input id="hours" placeholder="e.g. 05:00–23:00" {...register('hours')} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="locationHint">Location hint</Label>
          <Input id="locationHint" placeholder="e.g. After security, near gate A10" {...register('locationHint')} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="amenities">Amenities</Label>
          <Input id="amenities" {...register('amenities')} />
        </div>
        <div className="flex gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register('isAirside')} /> Airside
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register('isDomesticOnly')} /> Domestic only
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register('isInternationalOnly')} /> International only
          </label>
        </div>
        <div className="flex gap-3 pt-2">
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create lounge'}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate('/lounges')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
