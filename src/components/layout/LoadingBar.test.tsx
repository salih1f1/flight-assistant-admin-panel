import { useEffect, type ReactNode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query'
import { createTestQueryClient } from '@/test/renderWithProviders'
import { describe, expect, it } from 'vitest'
import { APPEAR_DELAY_MS, LoadingBar } from './LoadingBar'

/** Keeps one read in flight until the test settles the gate it was handed. */
function Fetching({ gate }: { gate: Promise<unknown> }) {
  useQuery({ queryKey: ['gate'], queryFn: () => gate })
  return null
}

/** The same for a write, which the bar has to cover too. */
function Saving({ gate }: { gate: Promise<unknown> }) {
  const { mutate } = useMutation({ mutationFn: () => gate })
  useEffect(() => { mutate() }, [mutate])
  return null
}

function renderBar(inFlight?: ReactNode) {
  const queryClient = createTestQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <LoadingBar />
      {inFlight}
    </QueryClientProvider>,
  )
}

const bar = () => screen.queryByRole('progressbar', { name: 'Loading' })

/** A request that stays in flight until the test says otherwise. */
function openGate() {
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  return { gate, settle: async () => { await act(async () => { release(); await gate }) } }
}

/** Long enough that a bar which was going to appear has appeared. */
const pastTheDelay = () => act(() => new Promise(resolve => setTimeout(resolve, APPEAR_DELAY_MS * 3)))

describe('LoadingBar', () => {
  it('stays off screen while nothing is being fetched', async () => {
    renderBar()

    await pastTheDelay()

    expect(bar()).not.toBeInTheDocument()
  })

  it('appears once a request has been running longer than the delay', async () => {
    renderBar(<Fetching gate={new Promise(() => {})} />)

    await pastTheDelay()

    expect(bar()).toBeInTheDocument()
  })

  it('shows for a write as well, so a save in flight is not silent', async () => {
    renderBar(<Saving gate={new Promise(() => {})} />)

    await pastTheDelay()

    expect(bar()).toBeInTheDocument()
  })

  it('goes once the request settles', async () => {
    const { gate, settle } = openGate()
    renderBar(<Fetching gate={gate} />)
    await pastTheDelay()
    expect(bar()).toBeInTheDocument()

    await settle()

    await waitFor(() => expect(bar()).not.toBeInTheDocument())
  })

  it('never shows for a request that settles inside the delay, so a cached page does not flash', async () => {
    const { gate, settle } = openGate()
    renderBar(<Fetching gate={gate} />)

    // In flight, but not yet for long enough to be worth saying so.
    await act(() => new Promise(resolve => setTimeout(resolve, APPEAR_DELAY_MS / 3)))
    expect(bar()).not.toBeInTheDocument()

    await settle()
    await pastTheDelay()

    expect(bar()).not.toBeInTheDocument()
  })
})
