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

/** Returns { problems, deleted }; problems non-empty means the account is
 * NOT in a known-clean state and enrollment must not proceed. */
export async function cleanAllFactors(adminRequest, identity) {
  const problems = [];
  let deleted = 0;
  const listing = await adminRequest(`/admin/users/${identity.id}/factors`);
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
    if (!removal.ok) {
      problems.push(
        `deleting factor ${factor.id} for ${identity.email} failed with status ${removal.status}`,
      );
    } else {
      deleted += 1;
    }
  }
  const readback = await adminRequest(`/admin/users/${identity.id}/factors`);
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
