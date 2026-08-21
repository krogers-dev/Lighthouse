/** Public runtime configuration validation.
 *
 * Runs before any app initialization. Failure reporting names the offending
 * variable and the rule it broke — never the value. The mobile binary may
 * carry only the Supabase URL and an approved public client key; anything
 * secret-shaped is rejected outright, in every build variant.
 */

export type BuildVariant = 'development' | 'release';
export type ClientKeyKind = 'publishable' | 'legacy-anon';

export interface EnvironmentConfig {
  readonly supabaseUrl: string;
  readonly supabaseClientKey: string;
  readonly keyKind: ClientKeyKind;
  readonly variant: BuildVariant;
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

export const REQUIRED_ENV_VARS = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_CLIENT_KEY',
] as const;

export class EnvironmentValidationError extends Error {
  constructor(readonly problems: readonly string[]) {
    // Problems name variables and rules only; values must never appear here.
    super(`Environment configuration invalid: ${problems.join('; ')}`);
    this.name = 'EnvironmentValidationError';
  }
}

const PUBLISHABLE_KEY_PATTERN = /^sb_publishable_[A-Za-z0-9_-]{10,}$/;
const JWT_SHAPED_PATTERN = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const SECRET_SHAPED_PATTERNS = [/^sb_secret_/, /service_role/i];

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '10.0.2.2', '::1', '[::1]']);

export function isLoopbackUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function classifyClientKey(key: string): ClientKeyKind | 'secret-shaped' | 'malformed' {
  if (SECRET_SHAPED_PATTERNS.some((p) => p.test(key))) return 'secret-shaped';
  if (PUBLISHABLE_KEY_PATTERN.test(key)) return 'publishable';
  if (JWT_SHAPED_PATTERN.test(key)) return 'legacy-anon';
  return 'malformed';
}

export function validateEnvironment(source: EnvSource, variant: BuildVariant): EnvironmentConfig {
  const problems: string[] = [];

  const rawUrl = source['EXPO_PUBLIC_SUPABASE_URL']?.trim() ?? '';
  const rawKey = source['EXPO_PUBLIC_SUPABASE_CLIENT_KEY']?.trim() ?? '';

  let parsedUrl: URL | undefined;
  if (rawUrl.length === 0) {
    problems.push('EXPO_PUBLIC_SUPABASE_URL is missing');
  } else {
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      problems.push('EXPO_PUBLIC_SUPABASE_URL is not a valid URL');
    }
  }

  let loopback = false;
  if (parsedUrl) {
    loopback = LOOPBACK_HOSTS.has(parsedUrl.hostname);
    if (parsedUrl.protocol === 'http:') {
      if (!loopback) {
        problems.push('EXPO_PUBLIC_SUPABASE_URL uses http:// on a non-loopback host');
      } else if (variant !== 'development') {
        problems.push('EXPO_PUBLIC_SUPABASE_URL is loopback but the build variant is not development');
      }
    } else if (parsedUrl.protocol !== 'https:') {
      problems.push('EXPO_PUBLIC_SUPABASE_URL must use https:// (or loopback http:// in development)');
    } else if (loopback && variant !== 'development') {
      problems.push('EXPO_PUBLIC_SUPABASE_URL is loopback but the build variant is not development');
    }
  }

  let keyKind: ClientKeyKind | undefined;
  if (rawKey.length === 0) {
    problems.push('EXPO_PUBLIC_SUPABASE_CLIENT_KEY is missing');
  } else {
    switch (classifyClientKey(rawKey)) {
      case 'publishable':
        keyKind = 'publishable';
        break;
      case 'legacy-anon':
        // A legacy JWT-shaped anon key is local-loopback development only and
        // is release-rejected (also enforced by scripts/candidate-config-check).
        if (variant === 'development' && loopback) {
          keyKind = 'legacy-anon';
        } else {
          problems.push(
            'EXPO_PUBLIC_SUPABASE_CLIENT_KEY is a legacy anon key, which is only permitted for loopback development',
          );
        }
        break;
      case 'secret-shaped':
        problems.push(
          'EXPO_PUBLIC_SUPABASE_CLIENT_KEY appears to be a secret or service-role key and must never be bundled',
        );
        break;
      case 'malformed':
        problems.push('EXPO_PUBLIC_SUPABASE_CLIENT_KEY is not a recognized public client key format');
        break;
    }
  }

  if (problems.length > 0 || !parsedUrl || !keyKind) {
    throw new EnvironmentValidationError(problems);
  }

  return {
    supabaseUrl: parsedUrl.origin,
    supabaseClientKey: rawKey,
    keyKind,
    variant,
  };
}
