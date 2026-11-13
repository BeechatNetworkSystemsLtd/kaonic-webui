import { ApiError, type ApiErrorCode } from '../errors';
import { fieldName } from './convert';
import type { WireError } from './wire';
import { noteDateHeader } from '@/lib/hubClock';

/*
 * Requests to the hub: JSON bodies, same-origin cookies, the CSRF token on
 * writes, a time limit, and one error shape (`ApiError`) for every failure.
 */

export const BASE_URL = '/api/v1';
const CSRF_HEADER = 'X-Kaonic-CSRF';
/** Remote calls can take a link setup plus 40 s on the hub; give them a minute before giving up here. */
const TIMEOUT_MS = 60_000;

/** The hub's error codes, folded into the few the UI branches on. */
const CODES: Record<string, ApiErrorCode> = {
  unauthenticated: 'unauthenticated',
  forbidden: 'forbidden',
  feature_disabled: 'forbidden',
  not_admin_device: 'forbidden',
  not_whitelisted: 'forbidden',
  not_found: 'not_found',
  conflict: 'conflict',
  downgrade: 'conflict',
  busy: 'conflict',
  foreign_node: 'conflict',
  validation_failed: 'validation_failed',
  rate_limited: 'rate_limited',
  radio_unavailable: 'unavailable',
  not_running: 'unavailable',
  installer_unavailable: 'unavailable',
  peer_unreachable: 'unavailable',
  peer_timeout: 'unavailable',
};

/** For codes this client does not know yet: the status says enough. */
function codeForStatus(status: number): ApiErrorCode {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 422) return 'validation_failed';
  if (status === 429) return 'rate_limited';
  if (status === 503 || status === 504) return 'unavailable';
  return 'internal';
}

function isWireError(body: unknown): body is WireError {
  return typeof body === 'object' && body !== null && typeof (body as WireError).code === 'string' && typeof (body as WireError).message === 'string';
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON: a proxy or a crash in front of the hub. The status is all there is.
  }
  if (!isWireError(body)) {
    // A proxy in front of the hub may refuse a large upload before the hub sees it.
    if (response.status === 413) return new ApiError('internal', 'The file is too large for the device.');
    return new ApiError(codeForStatus(response.status), `The device answered with an error (${response.status}).`);
  }

  const fields: Record<string, string> = {};
  for (const [path, message] of Object.entries(body.details?.fields ?? {})) fields[fieldName(path)] = message;
  return new ApiError(CODES[body.code] ?? codeForStatus(response.status), body.message, fields, body.code);
}

export interface Transport {
  /** Sends a request and resolves with the parsed body, or undefined when there is none. `timeoutMs` overrides the usual limit for a slow call. */
  request<T>(method: string, path: string, body?: unknown, options?: { timeoutMs?: number }): Promise<T>;
  /** A GET whose answer is a file, not JSON. */
  download(path: string): Promise<Blob>;
  /** The CSRF token of the current session, sent with every write. Null drops it. */
  setCsrfToken(token: string | null): void;
  csrfToken(): string | null;
}

export interface TransportOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

export function createTransport(options: TransportOptions = {}): Transport {
  const send = options.fetch ?? ((input, init) => fetch(input, init));
  const baseUrl = options.baseUrl ?? BASE_URL;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  let csrf: string | null = null;

  return {
    async download(path: string): Promise<Blob> {
      let response: Response;
      try {
        response = await send(baseUrl + path, { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
      } catch {
        throw new ApiError('network', 'Cannot reach the device. Check that you are still connected to it.');
      }
      if (!response.ok) throw await toApiError(response);
      return response.blob();
    },

    setCsrfToken: (token) => void (csrf = token),
    csrfToken: () => csrf,

    async request<T>(method: string, path: string, body?: unknown, requestOptions: { timeoutMs?: number } = {}): Promise<T> {
      const headers: Record<string, string> = { Accept: 'application/json' };
      // A form (a file upload) sets its own multipart content type, boundary included.
      const isForm = body instanceof FormData;
      // A file sent as it is (a WAV upload) carries its own type.
      const isFile = !isForm && typeof Blob !== 'undefined' && body instanceof Blob;
      if (isFile) headers['Content-Type'] = body.type || 'application/octet-stream';
      else if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
      if (method !== 'GET' && csrf) headers[CSRF_HEADER] = csrf;

      let response: Response;
      try {
        response = await send(baseUrl + path, {
          method,
          headers,
          credentials: 'same-origin',
          // Never let a cached answer stand in for the device's current state.
          cache: 'no-store',
          body: body === undefined ? undefined : isForm || isFile ? body : JSON.stringify(body),
          signal: AbortSignal.timeout(requestOptions.timeoutMs ?? timeoutMs),
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'TimeoutError') {
          throw new ApiError('unavailable', 'The device took too long to answer. Try again.');
        }
        throw new ApiError('network', 'Cannot reach the device. Check that you are still connected to it.');
      }

      noteDateHeader(response.headers.get('date'));
      if (!response.ok) throw await toApiError(response);
      const text = await response.text();
      if (text === '') return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new ApiError('internal', 'The device sent an answer this page cannot read.');
      }
    },
  };
}
