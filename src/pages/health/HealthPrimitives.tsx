import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { toneFor } from './statusTone'

/** A status name in its tone. A missing status reads as Unknown, never as healthy. */
export function Status({ status }: { status: string | null | undefined }) {
  const name = status ?? 'Unknown'
  return <span className={cn('font-medium', toneFor(name))}>{name}</span>
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1 rounded-md border border-gray-200 p-4 text-sm">
      <h3 className="font-medium text-gray-900">{title}</h3>
      {children}
    </div>
  )
}
