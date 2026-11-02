import type { HubApi } from './client';
import { createHttpApi } from './http/httpApi';

export type * from './client';
export type * from './types';
export { ApiError, errorMessage, isApiError, validationFields } from './errors';

/*
 * The one place that chooses the transport.
 *
 * - `VITE_API=hub` or `VITE_API=mock` decides outright.
 * - Otherwise `npm run dev` uses the mock, unless `VITE_HUB_URL` points the dev
 *   server's proxy at a real hub, and a build talks to the hub.
 *
 * The choice is fixed at build time, so a hub build does not contain the mock.
 */
const useMock =
  import.meta.env.VITE_API === 'mock' || (import.meta.env.VITE_API !== 'hub' && import.meta.env.DEV && !import.meta.env.VITE_HUB_URL);

export const api: HubApi = useMock ? (await import('./mock/mockApi')).createMockApi() : createHttpApi();
