import type { ProblemDetails } from '@/api/generated/model'

/**
 * Why a request failed, for showing to an admin. The API answers errors with
 * ProblemDetails on an axios error's `response.data`: `title` says what went
 * wrong, and outside Production `detail` carries the underlying cause (e.g. what
 * AeroAPI replied). Anything else falls back to the error's own message.
 */
export function apiErrorMessage(error: unknown): { title: string; detail?: string } {
  const problem = hasResponse(error) ? (error.response?.data as ProblemDetails | undefined) : undefined
  if (problem?.title) return { title: problem.title, detail: problem.detail ?? undefined }
  return { title: error instanceof Error ? error.message : 'Unknown error' }
}

function hasResponse(error: unknown): error is { response?: { data?: unknown } } {
  return typeof error === 'object' && error !== null && 'response' in error
}
