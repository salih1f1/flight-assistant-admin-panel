import { MutationCache, QueryClient } from '@tanstack/react-query'

/**
 * Refetches everything on screen and marks the rest stale.
 *
 * One rule, for every write: what changed is never only the entity that was written. An airline
 * joining an alliance changes what the alliance's page lists, a verification changes the
 * dashboard's counts, a delete cascades and reaches the audit log. Naming the affected keys write
 * by write is what left pages showing the old data until the admin reloaded the browser (#180) —
 * the list was one forgotten key behind every new cross-entity view.
 *
 * The panel is an internal tool a handful of admins use, so a round of refetches after a save is
 * cheaper than a view nobody remembered to invalidate.
 *
 * {@link createQueryClient} calls this for every mutation that succeeds; call it by hand only
 * where a write doesn't go through useMutation (VerifyDialog, which drives the verify endpoints
 * directly so a batch run can refresh once at the end rather than once per row).
 */
export function refreshAfterWrite(queryClient: QueryClient) {
  void queryClient.invalidateQueries()
}

/**
 * The app's QueryClient: reads stay fresh for five minutes, and every successful write refreshes
 * the app — see {@link refreshAfterWrite}.
 *
 * Every mutation the panel has is a genuine write; the POSTs that only read (the flight search)
 * are generated as queries, so none of this fires on them.
 */
export function createQueryClient() {
  const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5,
        retry: 1,
      },
    },
    mutationCache: new MutationCache({
      // Deliberately not awaited: holding the mutation open until the whole page had refetched
      // would keep every form's Save button disabled for the duration.
      onSuccess: () => refreshAfterWrite(queryClient),
    }),
  })
  return queryClient
}
