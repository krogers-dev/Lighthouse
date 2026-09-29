import {
  compareVersions,
  decideServiceGate,
  decodeServiceStatus,
  readServiceStatus,
} from '../service-status';

const open = { state: 'open', reason_code: 'none', min_app_version: '0.0.0', version: 1 };

describe('decodeServiceStatus', () => {
  it('accepts exactly the documented shape and nothing else', () => {
    expect(decodeServiceStatus(open)).toEqual({
      state: 'open',
      reasonCode: 'none',
      minAppVersion: '0.0.0',
      version: 1,
    });
    expect(decodeServiceStatus({ ...open, state: 'closed' })).toBeNull();
    expect(decodeServiceStatus({ ...open, reason_code: 'because' })).toBeNull();
    expect(decodeServiceStatus({ ...open, min_app_version: '1.0' })).toBeNull();
    expect(decodeServiceStatus({ ...open, version: '1' })).toBeNull();
    expect(decodeServiceStatus(null)).toBeNull();
    expect(decodeServiceStatus('open')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('compares numerically, and treats a malformed version as the oldest', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.3', '1.10.0')).toBe(-1);
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
    expect(compareVersions('0.1.0', '0.0.9')).toBe(1);
    expect(compareVersions('garbage', '0.0.1')).toBe(-1);
    expect(compareVersions('garbage', '0.0.0')).toBe(0);
  });
});

describe('decideServiceGate', () => {
  it('proceeds when the status is unreadable, because the server refuses on its own', () => {
    expect(decideServiceGate(null, '0.1.0')).toEqual({ name: 'open' });
  });

  it('interrupts on a readable pause, with its reason', () => {
    expect(
      decideServiceGate(
        { state: 'paused', reasonCode: 'incident', minAppVersion: '0.0.0', version: 2 },
        '0.1.0',
      ),
    ).toEqual({ name: 'paused', reason: 'incident' });
  });

  it('interrupts an app below the minimum version, and lets one at or above it through', () => {
    const status = {
      state: 'open' as const,
      reasonCode: 'none' as const,
      minAppVersion: '1.0.0',
      version: 3,
    };
    expect(decideServiceGate(status, '0.9.9')).toEqual({
      name: 'update_required',
      minAppVersion: '1.0.0',
    });
    expect(decideServiceGate(status, '1.0.0')).toEqual({ name: 'open' });
    expect(decideServiceGate(status, '1.0.1')).toEqual({ name: 'open' });
  });
});

describe('readServiceStatus', () => {
  const source = {
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseClientKey: 'sb_publishable_test_key_value',
  };

  it('asks the one public function with the public key and nothing else, and decodes the answer', async () => {
    const calls: { input: string; init: RequestInit }[] = [];
    const fetchImpl = async (input: string, init: RequestInit) => {
      calls.push({ input, init });
      return { ok: true, json: async () => open } as Response;
    };
    await expect(readServiceStatus(source, fetchImpl)).resolves.toEqual({
      state: 'open',
      reasonCode: 'none',
      minAppVersion: '0.0.0',
      version: 1,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.input).toBe('http://127.0.0.1:54321/rest/v1/rpc/service_status_read');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.body).toBe('{}');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['apikey']).toBe('sb_publishable_test_key_value');
    expect(headers['Authorization']).toBe('Bearer sb_publishable_test_key_value');
    expect(Object.keys(headers).sort()).toEqual(['Authorization', 'Content-Type', 'apikey']);
  });

  it('is null on a refusal, a malformed body, a thrown fetch, and a timeout', async () => {
    await expect(
      readServiceStatus(source, async () => ({ ok: false, json: async () => ({}) }) as Response),
    ).resolves.toBeNull();
    await expect(
      readServiceStatus(
        source,
        async () => ({ ok: true, json: async () => ({ nope: 1 }) }) as Response,
      ),
    ).resolves.toBeNull();
    await expect(
      readServiceStatus(source, async () => {
        throw new Error('network');
      }),
    ).resolves.toBeNull();
    const never = (_input: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    await expect(readServiceStatus(source, never, 10)).resolves.toBeNull();
  });
});
