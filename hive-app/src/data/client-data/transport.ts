/** Optional HTTP transport for the read contract. Not bound to the live app.
 * The endpoint must come from reviewed build configuration, never a route,
 * user input, a membership record or a provider response.
 */
import { SafeError } from '@/core/errors';

import type { ClientDataTransport } from './adapter';
import { MAX_BODY_CHARS, type DataRequest } from './contract';
import { parseDataRequest } from './validation';

/** Small fetch surface permits deterministic tests without a native runtime. */
export interface ClientDataResponse {
  readonly status: number;
  readonly url: string;
  readonly redirected: boolean;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type ClientDataFetch = (url: string, init: RequestInit) => Promise<ClientDataResponse>;

export interface ClientDataTransportConfig {
  readonly endpoint: string;
  /** Use the authorized lifecycle controller. Acquire for every request;
   * never close over a saved access token or use a provider/service token.
   */
  readonly getAccessToken: () => string | null | Promise<string | null>;
  readonly fetch?: ClientDataFetch;
}

function checkedEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    if (
      url.protocol !== 'https:' ||
      !url.hostname ||
      url.username ||
      url.password ||
      endpoint.includes('?') ||
      endpoint.includes('#') ||
      url.href !== endpoint
    ) {
      throw new SafeError('config');
    }
    return endpoint;
  } catch {
    throw new SafeError('config');
  }
}

function assertCurrent(signal: AbortSignal): void {
  if (signal.aborted) throw new SafeError('stale_scope');
}

function assertBodyHeaders(response: ClientDataResponse): void {
  const type = response.headers.get('content-type');
  if (!type || !/^application\/json(?:\s*;|\s*$)/i.test(type)) {
    throw new SafeError('unavailable');
  }
  const length = response.headers.get('content-length');
  if (
    length !== null &&
    (!/^\d+$/.test(length) ||
      !Number.isSafeInteger(Number(length)) ||
      Number(length) > MAX_BODY_CHARS)
  ) {
    throw new SafeError('unavailable');
  }
}

export function createClientDataTransport(config: ClientDataTransportConfig): ClientDataTransport {
  const endpoint = checkedEndpoint(config.endpoint);
  const fetchRequest: ClientDataFetch = config.fetch ?? globalThis.fetch;
  const getAccessToken = config.getAccessToken;

  return {
    async execute(request: DataRequest, signal: AbortSignal): Promise<unknown> {
      try {
        assertCurrent(signal);
        const body = JSON.stringify(parseDataRequest(request));
        let token: string | null;
        try {
          token = await getAccessToken();
        } catch (error) {
          throw new SafeError(error instanceof SafeError ? error.code : 'auth_expired');
        }
        // Token acquisition can cross sign-out/scope clearing. A cancelled
        // call must never start a network request with the returned token.
        assertCurrent(signal);
        if (!token || token.length > 16_384 || !/^[A-Za-z0-9._~+\/-]+=*$/.test(token)) {
          throw new SafeError('auth_expired');
        }

        let response: ClientDataResponse;
        try {
          response = await fetchRequest(endpoint, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body,
            signal,
            redirect: 'error',
            credentials: 'omit',
            cache: 'no-store',
          });
        } catch {
          assertCurrent(signal);
          throw new SafeError('network');
        }
        assertCurrent(signal);

        // Native fetch redirect/cookie behavior needs iOS/Android evidence
        // before binding this transport. Options above are not a verified
        // native guarantee. The server must never redirect or use cookies.
        // A changed final URL is rejected but cannot undo a followed request.
        if (response.redirected !== false || response.url !== endpoint) {
          throw new SafeError('unavailable');
        }
        if (response.status === 401) throw new SafeError('auth_expired');
        if (response.status === 403) throw new SafeError('denied');
        if (response.status !== 200) throw new SafeError('unavailable');
        assertBodyHeaders(response);

        // React Native may expose only buffered text, not a response stream.
        // Content-Length and accepted text are bounded here; peak native
        // buffering is not. The endpoint/proxy must enforce response byte
        // limits and no-store independently before production activation.
        const text = await response.text();
        assertCurrent(signal);
        if (text.length > MAX_BODY_CHARS) throw new SafeError('unavailable');
        try {
          return JSON.parse(text) as unknown;
        } catch {
          throw new SafeError('unavailable');
        }
      } catch (error) {
        assertCurrent(signal);
        // Never retain response bodies, token-acquisition errors, endpoint
        // strings or parser details in the error surfaced to the adapter.
        throw new SafeError(error instanceof SafeError ? error.code : 'unavailable');
      }
    },
  };
}
