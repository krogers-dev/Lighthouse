/** Deterministic refresh verification (RETURN-4 P1-2). A same-second
 * refresh can legitimately mint byte-identical access tokens, so literal
 * token novelty is only meaningful once the clock has advanced past the
 * prior token's `iat` second. The harness waits deterministically
 * (msUntilIatAdvance) and then requires a strictly later `iat`, a
 * different token, a rotated refresh token, the canonical `sub`, the
 * preserved `session_id`, the expected `aal`, and valid timing claims. */

/** Milliseconds to wait so any newly minted token's iat (seconds) must
 * exceed priorIatSeconds. Zero when the clock is already past it. */
export function msUntilIatAdvance(priorIatSeconds, nowMs) {
  return Math.max(0, (priorIatSeconds + 1) * 1000 - nowMs);
}

/** Pure claim/token comparison; returns human-readable problems. */
export function verifyRefreshedSession(previous, refreshed, expectations) {
  const problems = [];
  const { canonicalSub, expectedAal, nowMs } = expectations;
  if (!(typeof refreshed.claims.iat === 'number' && typeof previous.claims.iat === 'number')) {
    problems.push('iat missing from one of the tokens');
  } else if (refreshed.claims.iat <= previous.claims.iat) {
    problems.push(
      `refreshed iat (${refreshed.claims.iat}) did not advance past the prior iat (${previous.claims.iat}) — wait for the clock to pass the prior second before exchanging`,
    );
  }
  if (refreshed.accessToken === previous.accessToken) {
    problems.push('refreshed access token is byte-identical to the prior token');
  }
  if (!refreshed.refreshToken || refreshed.refreshToken === previous.refreshToken) {
    problems.push('refresh token did not rotate');
  }
  if (refreshed.claims.sub !== canonicalSub) {
    problems.push(`refreshed sub ${refreshed.claims.sub} is not the canonical id`);
  }
  if (previous.claims.session_id && refreshed.claims.session_id !== previous.claims.session_id) {
    problems.push('session_id changed across refresh');
  }
  if ((refreshed.claims.aal ?? 'aal1') !== expectedAal) {
    problems.push(`refreshed aal ${refreshed.claims.aal} is not ${expectedAal}`);
  }
  if (typeof refreshed.claims.exp !== 'number' || refreshed.claims.exp <= refreshed.claims.iat) {
    problems.push('refreshed exp is not after iat');
  }
  const skewSeconds = 300;
  if (
    typeof refreshed.claims.iat === 'number' &&
    refreshed.claims.iat * 1000 > nowMs + skewSeconds * 1000
  ) {
    problems.push('refreshed iat is implausibly in the future');
  }
  return problems;
}
