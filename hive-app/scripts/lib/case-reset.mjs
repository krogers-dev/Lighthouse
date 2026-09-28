/** The checked case reset for the local lanes (WO-005).
 *
 * The review lanes move the seeded case through freeze, review, and
 * approval, and leave it there. This is the recovery: remove the case's
 * approvals, verdicts, and packages (in that order; nothing cascades),
 * put the case back to the status the seed gave it, and drop the
 * workflow entries the transitions added to the trail. Synthetic lanes
 * only: the target must be a seeded case named here, never an
 * argument-supplied id, and the caller runs it against a loopback stack
 * with the privileged bearer in memory. Audit receipts are append-only
 * and stay.
 */

/** Seeded cases the review lanes may move, by key. */
export const RESETTABLE_CASES = {
  a1: {
    caseId: 'eeeeeeee-0000-4000-8000-0000000000a1',
    seededStatus: 'EVIDENCE_PENDING',
  },
};

export const WORKFLOW_EVENT_KINDS = [
  'case.package_frozen',
  'case.review_started',
  'case.review_passed',
  'case.returned',
  'case.held',
  'case.approved',
  'case.resumed',
  'case.approval_expired',
];

export function resolveCaseResetTarget(caseKey) {
  const target = RESETTABLE_CASES[caseKey];
  if (!target) {
    return {
      problem: `unknown case key ${JSON.stringify(caseKey)}; one of: ${Object.keys(RESETTABLE_CASES).join(', ')}`,
    };
  }
  return { ...target, key: caseKey };
}

/** The trail rows the reset removes: every workflow kind on the case. */
export function workflowEventsFilter(target) {
  return `case_id=eq.${target.caseId}&event_kind=in.(${WORKFLOW_EVENT_KINDS.join(',')})`;
}

/** What a correct reset leaves behind, checked by readback. */
export function verifyCaseReset(target, caseRow, packages) {
  const problems = [];
  if (!caseRow) problems.push('the case is missing after the reset');
  else if (caseRow.status !== target.seededStatus) {
    problems.push(`case status is ${caseRow.status}, not ${target.seededStatus}`);
  }
  if (Array.isArray(packages) && packages.length !== 0) {
    problems.push(`${packages.length} package row(s) remain`);
  }
  return problems;
}

/** The reset itself. Returns `{ ok: true, key, version }` or
 * `{ ok: false, problems }`; prints nothing. */
export async function performCaseReset({ url, serviceKey, gatewayKey = serviceKey, caseKey }) {
  const target = resolveCaseResetTarget(caseKey);
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

  for (const table of ['case_approvals', 'case_reviews', 'case_review_packages']) {
    const removed = await rest(`/${table}?case_id=eq.${target.caseId}`, {
      method: 'DELETE',
      headers: minimal,
    });
    if (!removed.ok) {
      return { ok: false, problems: [`deleting ${table} failed with status ${removed.status}`] };
    }
  }
  const restored = await rest(`/cases?id=eq.${target.caseId}`, {
    method: 'PATCH',
    headers: minimal,
    body: JSON.stringify({ status: target.seededStatus }),
  });
  if (!restored.ok) {
    return {
      ok: false,
      problems: [`restoring the case status failed with status ${restored.status}`],
    };
  }
  const trail = await rest(`/activity_events?${workflowEventsFilter(target)}`, {
    method: 'DELETE',
    headers: minimal,
  });
  if (!trail.ok) {
    return {
      ok: false,
      problems: [`removing the workflow trail entries failed with status ${trail.status}`],
    };
  }

  const caseBack = await rest(`/cases?select=id,status,version&id=eq.${target.caseId}`);
  const packagesBack = await rest(`/case_review_packages?select=id&case_id=eq.${target.caseId}`);
  if (!caseBack.ok || !packagesBack.ok) return { ok: false, problems: ['readback failed'] };
  const caseRow = JSON.parse(caseBack.text)[0];
  const problems = verifyCaseReset(target, caseRow, JSON.parse(packagesBack.text));
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, key: target.key, version: caseRow.version };
}
