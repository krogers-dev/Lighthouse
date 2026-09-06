/** Maestro helper (find 21): revoke the signed-in synthetic account's
 * membership on the selected entity MID-FLOW, at exactly the point
 * between "the requests list is on screen" and the refresh tap — the
 * synchronization point the flow could not express any other way.
 *
 * It POSTs to the loopback revoke endpoint that `npm run maestro:denied`
 * serves in-process; that runner holds the privileged credential in ITS
 * memory and restores the membership on every exit path. No secret and no
 * credential travels through this script: the request names only a
 * synthetic example.invalid account label and a seeded entity key, and
 * the endpoint refuses anything but the run's own target.
 *
 * It THROWS when the revoke did not happen, so the flow fails right here
 * with the reason, instead of asserting stale state the pre-step never
 * produced. Runs inside Maestro's GraalJS runtime, which injects these
 * globals (REVOKE_* arrive from the flow's env / the runner's -e): */
/* global http, json, output, REVOKE_HELPER_URL, REVOKE_USER, REVOKE_ENTITY */
const base = typeof REVOKE_HELPER_URL !== 'undefined' ? REVOKE_HELPER_URL : 'http://127.0.0.1:8478';
const user = typeof REVOKE_USER !== 'undefined' ? REVOKE_USER : 'client.owner@example.invalid';
const entity = typeof REVOKE_ENTITY !== 'undefined' ? REVOKE_ENTITY : 'entityA1';

let response = null;
try {
  response = http.post(base + '/revoke', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: user, entity: entity }),
  });
} catch (error) {
  throw new Error(
    'revoke endpoint unreachable at ' +
      base +
      ' — run this flow through `npm run maestro:denied`, which serves it (' +
      error +
      ')',
  );
}

let payload = null;
try {
  payload = response && response.body ? json(response.body) : null;
} catch (error) {
  throw new Error('revoke endpoint answered non-JSON: ' + error);
}
if (!response || !response.ok || !payload || payload.ok !== true) {
  const reason =
    payload && payload.error
      ? payload.error
      : 'status ' + (response && response.status ? response.status : 'none');
  throw new Error('membership revoke did not happen: ' + reason);
}
output.revokedRows = String(payload.revoked);
