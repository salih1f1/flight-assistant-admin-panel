import type { ProblemDetails } from '@/api/generated/model'

/** ProblemDetails, plus the per-field messages a validation failure (ValidationProblemDetails) carries. */
type ApiProblem = ProblemDetails & { errors?: Record<string, unknown> }

/**
 * Why a request failed, for showing to an admin. The API answers errors with
 * ProblemDetails on an axios error's `response.data`: `title` says what went
 * wrong, and outside Production `detail` carries the underlying cause (e.g. what
 * AeroAPI replied). A validation failure's title is only "Validation failed", with
 * the reasons in `errors`, so those become the detail. Anything else falls back to
 * the error's own message.
 */
export function apiErrorMessage(error: unknown): { title: string; detail?: string } {
  const problem = hasResponse(error) ? (error.response?.data as ApiProblem | undefined) : undefined
  if (problem?.title) return { title: problem.title, detail: problem.detail ?? validationMessages(problem.errors) }
  return { title: error instanceof Error ? error.message : 'Unknown error' }
}

function validationMessages(errors: ApiProblem['errors']): string | undefined {
  if (!errors) return undefined
  const messages = Object.values(errors).flat().filter((m): m is string => typeof m === 'string')
  return messages.length > 0 ? messages.join(' ') : undefined
}

function hasResponse(error: unknown): error is { response?: { data?: unknown } } {
  return typeof error === 'object' && error !== null && 'response' in error
}
