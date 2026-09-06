import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

import { classifyGetSessionError } from '../client';

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
