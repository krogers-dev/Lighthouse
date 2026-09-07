/** Reliable Admin-API factor cleanup (RETURN-3 area 5). Pure over an
 * injected adminRequest; unit-tested in
 * tests/scripts/admin-factors.test.mjs.
 *
 * The old cleanup ignored listing and deletion failures, so a rerun
 * could silently proceed with stale factors present. This one fails
 * closed at every step: the listing must succeed and be an array, EVERY
 * deletion must succeed, and a final readback must prove zero factors
 * remain before any enrollment begins. */

function factorsFrom(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.factors)) return body.factors;
  return null;
}

/** The adapter contract: every response must carry a boolean `ok`
 * (RETURN-4 P1-1 — a real adapter that returns only {status, body} once
 * made HTTP 200 read as failure; contract violations are now their own
 * hard failure instead of a silent misread). */
function contractProblem(response, what) {
  if (typeof response !== 'object' || response === null) {
    return `${what}: adapter returned no response object`;
  }
  if (typeof response.ok !== 'boolean') {
    return `${what}: adapter response violates the contract (missing boolean 'ok'; got keys ${Object.keys(response).join(',')})`;
  }
  return null;
}

/** Thrown by requireFactorsClean so NO later step (OTP request,
 * enrollment, challenge, verification, or any other mutation) can run
 * after a cleanup failure. */
export class FactorCleanupError extends Error {
  constructor(problems) {
    super(`factor cleanup failed: ${problems.join('; ')}`);
    this.problems = problems;
  }
}

/** Fail-stop entry point: resolves only when the account is PROVEN
 * factor-clean; throws FactorCleanupError otherwise. */
export async function requireFactorsClean(adminRequest, identity) {
  const { problems, deleted } = await cleanAllFactors(adminRequest, identity);
  if (problems.length > 0) throw new FactorCleanupError(problems);
  return deleted;
}

/** Returns { problems, deleted }; problems non-empty means the account is
 * NOT in a known-clean state and enrollment must not proceed. */
export async function cleanAllFactors(adminRequest, identity) {
  const problems = [];
  let deleted = 0;
  const listing = await adminRequest(`/admin/users/${identity.id}/factors`);
  const listingContract = contractProblem(listing, `factor listing for ${identity.email}`);
  if (listingContract) return { problems: [listingContract], deleted };
  if (!listing.ok) {
    return {
      problems: [`factor listing for ${identity.email} failed with status ${listing.status}`],
      deleted,
    };
  }
  const factors = factorsFrom(listing.body);
  if (factors === null) {
    return {
      problems: [`factor listing for ${identity.email} did not return a factor array`],
      deleted,
    };
  }
  for (const factor of factors) {
    const removal = await adminRequest(`/admin/users/${identity.id}/factors/${factor.id}`, {
      method: 'DELETE',
    });
    const removalContract = contractProblem(removal, `factor deletion for ${identity.email}`);
    if (removalContract) {
      problems.push(removalContract);
      continue;
    }
    if (!removal.ok) {
      problems.push(
        `deleting factor ${factor.id} for ${identity.email} failed with status ${removal.status}`,
      );
    } else {
      deleted += 1;
    }
  }
  const readback = await adminRequest(`/admin/users/${identity.id}/factors`);
  const readbackContract = contractProblem(readback, `factor readback for ${identity.email}`);
  if (readbackContract) {
    problems.push(readbackContract);
    return { problems, deleted };
  }
  if (!readback.ok) {
    problems.push(`factor readback for ${identity.email} failed with status ${readback.status}`);
    return { problems, deleted };
  }
  const remaining = factorsFrom(readback.body);
  if (remaining === null) {
    problems.push(`factor readback for ${identity.email} did not return a factor array`);
  } else if (remaining.length !== 0) {
    problems.push(
      `${remaining.length} factor(s) remain for ${identity.email} after cleanup — not clean`,
    );
  }
  return { problems, deleted };
}
