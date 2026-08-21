import {
  EnvironmentValidationError,
  classifyClientKey,
  isLoopbackUrl,
  validateEnvironment,
} from '../env';

const PUBLISHABLE = 'sb_publishable_abcdefghijklmnop';
// Synthetic JWT-shaped value for tests only; not a credential.
const LEGACY_ANON = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c3ludGhldGljLXNpZ25hdHVyZQ';

function expectProblems(fn: () => void, ...fragments: string[]): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(EnvironmentValidationError);
    const problems = (error as EnvironmentValidationError).problems.join(' | ');
    for (const fragment of fragments) {
      expect(problems).toContain(fragment);
    }
    return;
  }
  throw new Error('expected validation to fail');
}

describe('validateEnvironment', () => {
  it('accepts an https URL with a publishable key in release', () => {
    const config = validateEnvironment(
      {
        EXPO_PUBLIC_SUPABASE_URL: 'https://example-project.supabase.co',
        EXPO_PUBLIC_SUPABASE_CLIENT_KEY: PUBLISHABLE,
      },
      'release',
    );
    expect(config.keyKind).toBe('publishable');
    expect(config.supabaseUrl).toBe('https://example-project.supabase.co');
  });

  it('accepts loopback http with a legacy anon key only in development', () => {
    const config = validateEnvironment(
      {
        EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        EXPO_PUBLIC_SUPABASE_CLIENT_KEY: LEGACY_ANON,
      },
      'development',
    );
    expect(config.keyKind).toBe('legacy-anon');
  });

  it('rejects a legacy anon key in release even on https', () => {
    expectProblems(
      () =>
        validateEnvironment(
          {
            EXPO_PUBLIC_SUPABASE_URL: 'https://example-project.supabase.co',
            EXPO_PUBLIC_SUPABASE_CLIENT_KEY: LEGACY_ANON,
          },
          'release',
        ),
      'legacy anon key',
    );
  });

  it('rejects a loopback URL in release', () => {
    expectProblems(
      () =>
        validateEnvironment(
          {
            EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
            EXPO_PUBLIC_SUPABASE_CLIENT_KEY: PUBLISHABLE,
          },
          'release',
        ),
      'loopback',
    );
  });

  it('rejects http on a non-loopback host in every variant', () => {
    for (const variant of ['development', 'release'] as const) {
      expectProblems(
        () =>
          validateEnvironment(
            {
              EXPO_PUBLIC_SUPABASE_URL: 'http://example.com',
              EXPO_PUBLIC_SUPABASE_CLIENT_KEY: PUBLISHABLE,
            },
            variant,
          ),
        'http:// on a non-loopback host',
      );
    }
  });

  it('rejects secret-shaped keys outright and never echoes the value', () => {
    const secret = 'sb_secret_syntheticsyntheticsynthetic';
    try {
      validateEnvironment(
        {
          EXPO_PUBLIC_SUPABASE_URL: 'https://example-project.supabase.co',
          EXPO_PUBLIC_SUPABASE_CLIENT_KEY: secret,
        },
        'development',
      );
      throw new Error('expected failure');
    } catch (error) {
      const e = error as EnvironmentValidationError;
      expect(e.problems.join(' ')).toContain('secret');
      expect(e.message).not.toContain(secret);
      expect(e.problems.join(' ')).not.toContain(secret);
    }
  });

  it('reports missing variables by name without values', () => {
    expectProblems(
      () => validateEnvironment({}, 'development'),
      'EXPO_PUBLIC_SUPABASE_URL is missing',
      'EXPO_PUBLIC_SUPABASE_CLIENT_KEY is missing',
    );
  });

  it('rejects malformed URLs and unknown key shapes', () => {
    expectProblems(
      () =>
        validateEnvironment(
          {
            EXPO_PUBLIC_SUPABASE_URL: 'not a url',
            EXPO_PUBLIC_SUPABASE_CLIENT_KEY: 'not-a-key',
          },
          'development',
        ),
      'not a valid URL',
      'not a recognized public client key format',
    );
  });
});

describe('classifyClientKey', () => {
  it('classifies each shape', () => {
    expect(classifyClientKey(PUBLISHABLE)).toBe('publishable');
    expect(classifyClientKey(LEGACY_ANON)).toBe('legacy-anon');
    expect(classifyClientKey('sb_secret_syntheticsynthetic')).toBe('secret-shaped');
    expect(classifyClientKey('SERVICE_ROLE_KEY')).toBe('secret-shaped');
    expect(classifyClientKey('hello')).toBe('malformed');
  });
});

describe('isLoopbackUrl', () => {
  it('detects loopback hosts including the Android emulator alias', () => {
    expect(isLoopbackUrl('http://127.0.0.1:54321')).toBe(true);
    expect(isLoopbackUrl('http://localhost:54321')).toBe(true);
    expect(isLoopbackUrl('http://10.0.2.2:54321')).toBe(true);
    expect(isLoopbackUrl('https://example-project.supabase.co')).toBe(false);
    expect(isLoopbackUrl('nonsense')).toBe(false);
  });
});
