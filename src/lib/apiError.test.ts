import { describe, expect, it } from 'vitest'
import { httpError } from '@/test/fakeApi'
import { apiErrorMessage } from './apiError'

describe('apiErrorMessage', () => {
  it("uses a ProblemDetails response's title and detail", () => {
    const error = httpError(400, { title: 'The flight status request was rejected.', status: 400, detail: 'AeroAPI returned HTTP 400: bad ident' })

    expect(apiErrorMessage(error)).toEqual({ title: 'The flight status request was rejected.', detail: 'AeroAPI returned HTTP 400: bad ident' })
  })

  it("puts a validation response's messages in the detail, since its title only says validation failed", () => {
    // As GlobalExceptionHandler renders a FluentValidation failure: ValidationProblemDetails, no
    // detail, messages keyed by property (or the rule's WithName).
    const error = httpError(400, {
      title: 'Validation failed',
      status: 400,
      errors: { sort: ["Column 'Email' is sensitive and cannot be sorted on."], 'Paging.PageSize': ["'Page Size' must be between 1 and 200. You entered 500."] },
    })

    expect(apiErrorMessage(error)).toEqual({
      title: 'Validation failed',
      detail: "Column 'Email' is sensitive and cannot be sorted on. 'Page Size' must be between 1 and 200. You entered 500.",
    })
  })

  it('prefers the detail over validation messages when a response has both', () => {
    const error = httpError(400, { title: 'Validation failed', detail: 'Explained.', errors: { x: ['Also this.'] } })

    expect(apiErrorMessage(error)).toEqual({ title: 'Validation failed', detail: 'Explained.' })
  })

  it("falls back to the error's own message without a ProblemDetails body", () => {
    expect(apiErrorMessage(httpError(502))).toEqual({ title: 'Request failed with status code 502' })
    expect(apiErrorMessage('nope')).toEqual({ title: 'Unknown error' })
  })
})
