/** The checked answer reset for the local lanes (WO-004).
 *
 * A request can be answered once, so the answer flows (Maestro, the
 * harness, the bridge) leave the seeded question ANSWERED and cannot run
 * twice on the same stack. This is the recovery: remove the answer (its
 * citations cascade), put the request back to the state the seed gave
 * it, and drop the "request answered" trail entry the submission added.
 * Synthetic lanes only: the target must be a seeded OPEN request named
 * here, never an argument-supplied id, and the caller runs it against a
 * loopback stack with the privileged bearer in memory. Audit receipts
 * are append-only and stay.
 */

const SEEDED_ANSWERED_AT = '2026-08-11T09:15:00Z';

/** Seeded OPEN requests an answer flow may settle, by key. */
export const RESETTABLE_REQUESTS = {
  a1Open: {
    requestId: 'dddddddd-0000-4000-8000-0000000000a1',
    caseId: 'eeeeeeee-0000-4000-8000-0000000000a1',
    seededStatus: 'OPEN',
  },
  a1Question: {
    requestId: 'dddddddd-0000-4000-8000-0000000000a3',
    caseId: 'eeeeeeee-0000-4000-8000-0000000000a1',
    seededStatus: 'OPEN',
  },
};

export function resolveAnswerResetTarget(requestKey) {
  const target = RESETTABLE_REQUESTS[requestKey];
  if (!target) {
    return {
      problem: `unknown request key ${JSON.stringify(requestKey)}; one of: ${Object.keys(RESETTABLE_REQUESTS).join(', ')}`,
    };
  }
  return { ...target, key: requestKey };
}

/** The activity rows the reset removes: "request answered" on the case
 * AFTER the seeded one, so the seed's own entry is never touched. */
export function answeredEventsFilter(target) {
  return `case_id=eq.${target.caseId}&event_kind=eq.request.answered&occurred_at=gt.${encodeURIComponent(SEEDED_ANSWERED_AT)}`;
}

/** What a correct reset leaves behind, checked by readback. */
export function verifyReset(request, answers) {
  const problems = [];
  if (!request) problems.push('the request is missing after the reset');
  else if (request.status !== 'OPEN')
    problems.push(`request status is ${request.status}, not OPEN`);
  if (Array.isArray(answers) && answers.length !== 0) {
    problems.push(`${answers.length} answer row(s) remain`);
  }
  return problems;
}

/** The reset itself, against a loopback stack, with the privileged bearer
 * held in memory by the caller. Returns `{ ok: true, key, version }` or
 * `{ ok: false, problems }`; prints nothing. */
export async function performAnswerReset({ url, serviceKey, gatewayKey = serviceKey, requestKey }) {
  const target = resolveAnswerResetTarget(requestKey);
  if (target.problem) return { ok: false, problems: [target.problem] };

  const rest = async (pathname, options = {}) => {
    const response = await fetch(`${url}/rest/v1${pathname}`, {
      ...options,
      headers: {
        apikey: gatewayKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  };
  const minimal = { Prefer: 'return=minimal' };

  const removed = await rest(`/request_answers?request_id=eq.${target.requestId}`, {
    method: 'DELETE',
    headers: minimal,
  });
  if (!removed.ok) {
    return { ok: false, problems: [`deleting the answer failed with status ${removed.status}`] };
  }
  const reopened = await rest(`/requests?id=eq.${target.requestId}`, {
    method: 'PATCH',
    headers: minimal,
    body: JSON.stringify({ status: target.seededStatus }),
  });
  if (!reopened.ok) {
    return { ok: false, problems: [`reopening the request failed with status ${reopened.status}`] };
  }
  const trail = await rest(`/activity_events?${answeredEventsFilter(target)}`, {
    method: 'DELETE',
    headers: minimal,
  });
  if (!trail.ok) {
    return {
      ok: false,
      problems: [`removing the added trail entries failed with status ${trail.status}`],
    };
  }

  const requestBack = await rest(`/requests?select=id,status,version&id=eq.${target.requestId}`);
  const answersBack = await rest(`/request_answers?select=id&request_id=eq.${target.requestId}`);
  if (!requestBack.ok || !answersBack.ok) return { ok: false, problems: ['readback failed'] };
  const request = JSON.parse(requestBack.text)[0];
  const problems = verifyReset(request, JSON.parse(answersBack.text));
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, key: target.key, version: request.version };
}
