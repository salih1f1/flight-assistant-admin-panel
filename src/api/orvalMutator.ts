import type { AxiosError, AxiosRequestConfig } from 'axios'
import { apiClient } from './client'

/**
 * The single HTTP entry point of the orval-generated client (src/api/generated).
 * Routing it through apiClient keeps one place that attaches the MSAL access token:
 * the request interceptor in client.ts.
 */
export const apiRequest = <T>(config: AxiosRequestConfig, options?: AxiosRequestConfig): Promise<T> =>
  apiClient.request<T>({ ...config, ...options }).then(r => r.data)

// Picked up by orval for the generated hooks' error and body types.
export type ErrorType<Error> = AxiosError<Error>
export type BodyType<BodyData> = BodyData
