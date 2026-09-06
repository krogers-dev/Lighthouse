import { SafeError } from '@/core/errors';

import { CLIENT_DATA_VERSION, MAX_BODY_CHARS, type DataRequest } from '../contract';
import {
  createClientDataTransport,
  type ClientDataFetch,
  type ClientDataResponse,
} from '../transport';

const endpoint = 'https://synthetic.example.invalid/client-data';
const request: DataRequest = {
  version: CLIENT_DATA_VERSION,
  operation: 'requests.list',
  scope: {
    environmentId: '11111111-1111-4111-8111-111111111111',
    clientId: '22222222-2222-4222-8222-222222222222',
    entityId: '33333333-3333-4333-8333-333333333333',
    membershipId: '44444444-4444-4444-8444-444444444444',
  },
};
const result = { ...request, status: 'ok', result: { items: [], recordedThrough: null } };

function response(
  overrides: Partial<ClientDataResponse> = {},
  headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' },
): ClientDataResponse {
  return {
    status: 200,
    redirected: false,
    url: endpoint,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: jest.fn(async () => JSON.stringify(result)),
    ...overrides,
  };
}

function setup(reply = response()) {
  const fetch = jest
    .fn<ReturnType<ClientDataFetch>, Parameters<ClientDataFetch>>()
    .mockResolvedValue(reply);
  const getAccessToken = jest.fn(async () => 'synthetic.token.value');
  const transport = createClientDataTransport({ endpoint, fetch, getAccessToken });
  return { fetch, getAccessToken, transport };
}

describe('client data HTTP transport', () => {
  it('posts the contract to one fixed endpoint with fresh authorization for each call', async () => {
    const { transport, fetch, getAccessToken } = setup();
    const signal = new AbortController().signal;
    await expect(transport.execute(request, signal)).resolves.toEqual(result);
    getAccessToken.mockResolvedValueOnce('synthetic.replacement.value');
    await transport.execute(request, signal);
    expect(getAccessToken).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(1, endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: 'Bearer synthetic.token.value',
      },
      body: JSON.stringify(request),
      signal,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
    });
    expect(fetch.mock.calls[1]?.[1]?.headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer synthetic.replacement.value' }),
    );
  });

  it.each([
    'http://synthetic.example.invalid/client-data',
    'https://user:password@synthetic.example.invalid/client-data',
    'https://synthetic.example.invalid/client-data?scope=synthetic',
    'https://synthetic.example.invalid/client-data?',
    'https://synthetic.example.invalid/client-data#fragment',
    'https://synthetic.example.invalid/client-data#',
    '/client-data',
    ' https://synthetic.example.invalid/client-data',
  ])('rejects an unsafe endpoint before acquiring a token: %s', (invalidEndpoint) => {
    const getAccessToken = jest.fn(() => 'synthetic.token.value');
    expect(() => createClientDataTransport({ endpoint: invalidEndpoint, getAccessToken })).toThrow(
      new SafeError('config'),
    );
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it('does not acquire authorization or send an already cancelled request', async () => {
    const { transport, getAccessToken, fetch } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(transport.execute(request, controller.signal)).rejects.toMatchObject({
      code: 'stale_scope',
    });
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not fetch after sign-out while acquiring authorization', async () => {
    let finish: (token: string) => void = () => {
      throw new Error('token acquisition was not started');
    };
    const getAccessToken = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const fetch = jest.fn<ReturnType<ClientDataFetch>, Parameters<ClientDataFetch>>();
    const transport = createClientDataTransport({ endpoint, getAccessToken, fetch });
    const controller = new AbortController();
    const pending = transport.execute(request, controller.signal);
    controller.abort();
    finish('synthetic.token.value');
    await expect(pending).rejects.toMatchObject({ code: 'stale_scope' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([null, '', 'value\r\nInjected: synthetic'])(
    'refuses missing or malformed authorization',
    async (token) => {
      const fetch = jest.fn<ReturnType<ClientDataFetch>, Parameters<ClientDataFetch>>();
      const transport = createClientDataTransport({ endpoint, fetch, getAccessToken: () => token });
      await expect(transport.execute(request, new AbortController().signal)).rejects.toMatchObject({
        code: 'auth_expired',
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('redacts errors thrown during token acquisition', async () => {
    const transport = createClientDataTransport({
      endpoint,
      getAccessToken: () => {
        throw new Error('synthetic secret token content');
      },
    });
    await expect(transport.execute(request, new AbortController().signal)).rejects.toThrow(
      new SafeError('auth_expired'),
    );
  });

  it.each([
    [401, 'auth_expired'],
    [403, 'denied'],
    [500, 'unavailable'],
    [302, 'unavailable'],
  ])('redacts HTTP %s bodies and maps only a safe code', async (status, code) => {
    const text = jest.fn(async () => 'synthetic secret from provider');
    const { transport } = setup(response({ status: Number(status), text }));
    await expect(transport.execute(request, new AbortController().signal)).rejects.toMatchObject({
      code,
    });
    expect(text).not.toHaveBeenCalled();
  });

  it('redacts network failures', async () => {
    const { transport, fetch } = setup();
    fetch.mockRejectedValueOnce(new TypeError('synthetic secret token in transport error'));
    await expect(transport.execute(request, new AbortController().signal)).rejects.toThrow(
      new SafeError('network'),
    );
  });

  it.each([
    { redirected: true },
    { url: 'https://redirected.example.invalid/client-data' },
    { url: '' },
  ])('rejects an unexpected response URL or redirect', async (overrides) => {
    const text = jest.fn(async () => JSON.stringify(result));
    const { transport } = setup(response({ ...overrides, text }));
    await expect(transport.execute(request, new AbortController().signal)).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(text).not.toHaveBeenCalled();
  });

  it('rejects non-JSON without reading the body', async () => {
    const reply = response({}, { 'content-type': 'text/html' });
    const { transport } = setup(reply);
    await expect(transport.execute(request, new AbortController().signal)).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(reply.text).not.toHaveBeenCalled();
  });

  it.each([String(MAX_BODY_CHARS + 1), '-1', 'unknown', '1.1'])(
    'rejects a large or invalid declared body length: %s',
    async (length) => {
      const reply = response({}, { 'content-type': 'application/json', 'content-length': length });
      const { transport } = setup(reply);
      await expect(transport.execute(request, new AbortController().signal)).rejects.toMatchObject({
        code: 'unavailable',
      });
      expect(reply.text).not.toHaveBeenCalled();
    },
  );

  it('rejects an oversized body when the server omits content-length', async () => {
    const { transport } = setup(response({ text: async () => 'x'.repeat(MAX_BODY_CHARS + 1) }));
    await expect(transport.execute(request, new AbortController().signal)).rejects.toMatchObject({
      code: 'unavailable',
    });
  });

  it('redacts invalid JSON instead of exposing parser details', async () => {
    const { transport } = setup(response({ text: async () => '{synthetic secret data' }));
    await expect(transport.execute(request, new AbortController().signal)).rejects.toThrow(
      new SafeError('unavailable'),
    );
  });

  it('rejects a response cancelled while the body is being read', async () => {
    const controller = new AbortController();
    const { transport } = setup(
      response({
        text: async () => {
          controller.abort();
          return JSON.stringify(result);
        },
      }),
    );
    await expect(transport.execute(request, controller.signal)).rejects.toMatchObject({
      code: 'stale_scope',
    });
  });
});
