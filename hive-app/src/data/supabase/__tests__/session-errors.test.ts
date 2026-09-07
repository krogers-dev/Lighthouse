import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

import { SafeError } from '@/core/errors';

import { classifyGetSessionError, mapSignInRequestError } from '../client';

/** 2026-09-06 review: the only server call inside getSession() is the
 * refresh of a lapsed stored session, so its failure modes are exactly
 * three, and each must route to the right boot branch. */
describe('classifyGetSessionError', () => {
  it('a 4xx from the auth API is the server rejecting the refresh token: a dead session', () => {
    expect(
      classifyGetSessionError(
        new AuthApiError(
          'Invalid Refresh Token: Refresh Token Not Found',
          400,
          'refresh_token_not_found',
        ),
      ),
    ).toBe('expired');
    expect(classifyGetSessionError(new AuthApiError('unauthorized', 401, 'bad_jwt'))).toBe(
      'expired',
    );
    expect(classifyGetSessionError(new AuthApiError('banned', 403, 'user_banned'))).toBe('expired');
  });

  it('a retryable fetch error is an unreachable server: an offline launch', () => {
    expect(classifyGetSessionError(new AuthRetryableFetchError('fetch failed', 0))).toBe('offline');
    expect(classifyGetSessionError(new AuthRetryableFetchError('bad gateway', 502))).toBe(
      'offline',
    );
  });

  it('anything else stays fatal — never a guessed sign-out', () => {
    expect(
      classifyGetSessionError(new AuthApiError('server error', 500, 'unexpected_failure')),
    ).toBe('other');
    expect(classifyGetSessionError(new Error('storage exploded'))).toBe('other');
    expect(classifyGetSessionError(null)).toBe('other');
  });
});

/** 2026-09-07 wording review: the two sign-in answers that must reach the
 * screen as themselves rather than as the generic line. */
describe('mapSignInRequestError', () => {
  const asSafe = (value: unknown): SafeError => {
    expect(value).toBeInstanceOf(SafeError);
    return value as SafeError;
  };

  it('maps the invite-only refusal (422 / otp_disabled / signup_disabled) to not_authorized', () => {
    expect(
      asSafe(
        mapSignInRequestError(new AuthApiError('Signups not allowed for otp', 422, 'otp_disabled')),
      ).code,
    ).toBe('not_authorized');
    expect(
      asSafe(mapSignInRequestError(new AuthApiError('Signups not allowed', 400, 'signup_disabled')))
        .code,
    ).toBe('not_authorized');
    expect(
      asSafe(mapSignInRequestError(new AuthApiError('unprocessable', 422, undefined))).code,
    ).toBe('not_authorized');
  });

  it('maps a rate limit (429 or an over_*_rate_limit code) to rate_limited', () => {
    expect(
      asSafe(mapSignInRequestError(new AuthApiError('too many', 429, 'over_request_rate_limit')))
        .code,
    ).toBe('rate_limited');
    expect(
      asSafe(
        mapSignInRequestError(new AuthApiError('email rate', 400, 'over_email_send_rate_limit')),
      ).code,
    ).toBe('rate_limited');
  });

  it('leaves every other failure exactly as it was for the safe-error mapper', () => {
    const server = new AuthApiError('server error', 500, 'unexpected_failure');
    expect(mapSignInRequestError(server)).toBe(server);
    const retryable = new AuthRetryableFetchError('fetch failed', 0);
    expect(mapSignInRequestError(retryable)).toBe(retryable);
    const plain = new Error('storage exploded');
    expect(mapSignInRequestError(plain)).toBe(plain);
  });

  it('the not_authorized line says what to do without stating whether the email is authorized', () => {
    const message = new SafeError('not_authorized').userMessage;
    expect(message).toMatch(/contact your Honeybee team/);
    expect(message).not.toMatch(/not authorized|unauthorized|invited/i);
  });
});
