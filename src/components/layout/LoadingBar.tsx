import { useEffect, useState } from 'react'
import { useIsFetching, useIsMutating } from '@tanstack/react-query'

/**
 * How long a request has to run before the bar appears. Answers are cached for five minutes, so
 * coming back to a page is instant; without this wait the bar would blink on every such
 * navigation and read as noise rather than as progress.
 */
export const APPEAR_DELAY_MS = 150

/**
 * One indeterminate bar across the top of the content area, on whenever the panel is waiting on
 * the API — reads as well as writes. Navigation itself is instant, so what an admin feels as lag
 * is the new page's request; this is what says the panel is working rather than broken. Global on
 * purpose: every page gets it without having to say anything, including the refetch that follows
 * a save.
 */
export function LoadingBar() {
  const busy = useIsFetching() + useIsMutating() > 0
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!busy) {
      setShow(false)
      return
    }
    const timer = setTimeout(() => setShow(true), APPEAR_DELAY_MS)
    return () => clearTimeout(timer)
  }, [busy])

  if (!show) return null

  return (
    // Indeterminate: the API says how many requests are in flight, never how far along one is, so
    // there is no value to report — only that something is happening.
    <div role="progressbar" aria-label="Loading" className="sticky top-0 z-20 -mb-1 h-1 overflow-hidden bg-blue-100">
      <div className="h-full w-1/4 rounded-full bg-blue-600 animate-loading-bar" />
    </div>
  )
}
