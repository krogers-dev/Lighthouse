/** Shared secret/credential detection patterns for the secret gate
 * (scripts/secret-scan.mjs) and the exported-bundle inspector
 * (scripts/bundle-inspect.mjs). Pure and unit-tested
 * (tests/scripts/secret-patterns.test.mjs). */

export const SECRET_PATTERNS = [
  {
    name: 'private-key-block',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/g,
  },
  {
    name: 'supabase-secret-key',
    regex: /sb_secret_[A-Za-z0-9_-]{8,}/g,
  },
  {
    name: 'service-role-assignment',
    // An actual value assigned to a service-role-named variable — not prose
    // or SQL that merely names the role.
    regex: /service_role[_a-z]*["']?\s*[:=]\s*["'][A-Za-z0-9_.-]{8,}/gi,
  },
  {
    name: 'jwt-shaped-token',
    regex: /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g,
  },
  {
    name: 'aws-access-key-id',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    name: 'google-oauth-client-secret',
    regex: /\bGOCSPX-[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    name: 'stripe-secret-key',
    regex: /\bsk_live_[A-Za-z0-9]{10,}\b/g,
  },
  {
    name: 'generic-secret-env',
    // A populated secret-ish variable in env-style files.
    regex: /^(?:[A-Z0-9_]*(?:SECRET|SERVICE_KEY|PRIVATE_KEY|PASSWORD|TOKEN)[A-Z0-9_]*)=[^\s#].*$/gm,
  },
];

/** Findings that only matter outside the development profile. */
export const RELEASE_ONLY_PATTERNS = [
  {
    name: 'loopback-endpoint',
    regex: /https?:\/\/(?:127\.0\.0\.1|localhost|10\.0\.2\.2)(?::\d+)?/g,
  },
  {
    name: 'legacy-anon-key',
    // Same shape as jwt-shaped-token; kept separate so reports name the
    // release rule that rejects legacy anon keys outside development.
    regex: /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g,
  },
  {
    name: 'development-identifier',
    regex: /com\.myhbcfo\.hive\.development/g,
  },
  {
    // The dev-only storage-corruption QA hook embeds this marker exactly
    // so its absence from any non-development export is provable.
    name: 'qa-hook-marker',
    regex: /HIVE_QA_CORRUPT_HOOK/g,
  },
];

/** Scan one text for the given pattern set. Returns findings with the
 * pattern name, 1-based line number, and a REDACTED snippet (never the
 * matched value itself). */
export function scanText(text, patterns, filePath = '<memory>') {
  const findings = [];
  for (const { name, regex } of patterns) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const line = text.slice(0, match.index).split('\n').length;
      findings.push({
        pattern: name,
        file: filePath,
        line,
        // Redacted evidence only: pattern class and location, never the value.
        snippet: `[${name} match redacted]`,
      });
      if (match.index === regex.lastIndex) regex.lastIndex += 1;
    }
  }
  return findings;
}

/** History-exception gate (P2-10 hardened).
 *
 * Allowlist entries are blob-scoped only: every entry pins one exact
 * historical Git object by full 40-hex id, exact repo-relative path,
 * pattern, and exact expected occurrence count, with owner, reason,
 * approval, expiry, and retest recorded. Tracked findings (no blob) are
 * NEVER allowlisted — fix the file instead. */
const FULL_BLOB_ID = /^[0-9a-f]{40}$/;

function entryKey(entry) {
  return `${entry.blob}:${entry.path}:${entry.pattern}`;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/** Real calendar dates only: 2026-02-30 and month 13 are rejected, not
 * rolled over (RETURN-2 area 6). */
function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** A finding is covered only by an entry pinning its exact
 * (blob, path, pattern) triple — full 40-hex equality, no prefixes. */
export function isAllowed(finding, allowlist) {
  if (typeof finding.blob !== 'string') return false;
  return allowlist.some(
    (entry) =>
      entry.blob === finding.blob &&
      entry.path === finding.blobPath &&
      entry.pattern === finding.pattern,
  );
}

/** Validate every allowlist entry; returns human-readable problems.
 * Malformed, duplicate, and expired entries all fail the gate. */
export function validateAllowlist(entries, todayIso) {
  const problems = [];
  const seen = new Set();
  const knownPatterns = new Set(SECRET_PATTERNS.map((p) => p.name));
  entries.forEach((entry, index) => {
    const label = `allowlist entry ${index + 1}`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      problems.push(`${label}: not an object`);
      return;
    }
    if (typeof entry.blob !== 'string' || !FULL_BLOB_ID.test(entry.blob)) {
      problems.push(`${label}: blob must be a full 40-character lowercase hex Git object id`);
    }
    if (!isNonEmptyString(entry.path) || entry.path.startsWith('/') || entry.path.includes('..')) {
      problems.push(`${label}: path must be a non-empty exact repo-relative path`);
    }
    if (!knownPatterns.has(entry.pattern)) {
      problems.push(`${label}: pattern must name a known secret pattern`);
    }
    if (!Number.isInteger(entry.expectedCount) || entry.expectedCount < 1) {
      problems.push(`${label}: expectedCount must be an integer >= 1`);
    }
    if (!isNonEmptyString(entry.owner)) {
      problems.push(`${label}: owner is required`);
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 10) {
      problems.push(`${label}: reason must be at least 10 non-whitespace-padded characters`);
    }
    // Approval is a STATE, never free text: 'proposed' entries are valid
    // but the scan reports HOLD for them (allowlistHolds); 'ratified'
    // requires the ratification date. A string like "ratification
    // pending" is not an approval state (RETURN-2 area 6).
    if (entry.approvalStatus !== 'proposed' && entry.approvalStatus !== 'ratified') {
      problems.push(`${label}: approvalStatus must be exactly 'proposed' or 'ratified'`);
    }
    if (!isNonEmptyString(entry.approvalReference)) {
      problems.push(`${label}: approvalReference is required`);
    }
    if (!isIsoDate(entry.proposedOn)) {
      problems.push(`${label}: proposedOn must be a real calendar date (YYYY-MM-DD)`);
    }
    if (entry.approvalStatus === 'ratified') {
      // Ratification provenance (RETURN-3 area 3): named approver, date,
      // a reference that no longer reads as pending, and the digest of
      // the decision record. `owner` is never proof of approval.
      if (!isNonEmptyString(entry.ratifiedBy)) {
        problems.push(`${label}: ratified entries require ratifiedBy (a named approver)`);
      }
      if (!isIsoDate(entry.ratifiedOn)) {
        problems.push(`${label}: ratified entries require a real ratifiedOn date`);
      } else {
        if (isIsoDate(entry.proposedOn) && entry.ratifiedOn < entry.proposedOn) {
          problems.push(`${label}: ratifiedOn cannot precede proposedOn`);
        }
        if (entry.ratifiedOn > todayIso) {
          problems.push(`${label}: ratifiedOn is in the future — rejected`);
        }
        if (isIsoDate(entry.expiry) && entry.ratifiedOn > entry.expiry) {
          problems.push(`${label}: ratification after expiry is rejected`);
        }
      }
      if (
        typeof entry.decisionRecordPath !== 'string' ||
        !entry.decisionRecordPath.startsWith('security/decisions/')
      ) {
        problems.push(
          `${label}: ratified entries require decisionRecordPath under security/decisions/`,
        );
      }
      if (
        isNonEmptyString(entry.approvalReference) &&
        /pending|proposed|not\s+approved|not\s+yet\s+given/i.test(entry.approvalReference)
      ) {
        problems.push(
          `${label}: approvalReference still reads as pending/proposed — that is not an approval reference`,
        );
      }
      if (!/^[0-9a-f]{64}$/.test(entry.decisionRecordDigest ?? '')) {
        problems.push(
          `${label}: ratified entries require decisionRecordDigest (sha256 hex of the decision record)`,
        );
      }
    }
    if (!isIsoDate(entry.expiry)) {
      problems.push(`${label}: expiry must be a real calendar date (YYYY-MM-DD)`);
    } else {
      if (isIsoDate(entry.proposedOn) && entry.expiry <= entry.proposedOn) {
        problems.push(`${label}: expiry must be after proposedOn`);
      }
      if (entry.expiry <= todayIso) {
        problems.push(`${label}: expired on ${entry.expiry} — re-approve or remove`);
      }
    }
    if (!isNonEmptyString(entry.retest)) {
      problems.push(`${label}: retest is required`);
    }
    const key = entryKey(entry);
    if (seen.has(key)) {
      problems.push(`${label}: duplicate of ${key}`);
    }
    seen.add(key);
  });
  return problems;
}

/** Entries that are schema-valid but not yet ratified: the scan reports
 * HOLD for them instead of treating a pending approval as approval. */
export function allowlistHolds(entries) {
  return entries
    .filter((entry) => entry.approvalStatus === 'proposed')
    .map(
      (entry) =>
        `HOLD: history exception ${entryKey(entry)} is PROPOSED (owner ${entry.owner}) awaiting explicit written ratification`,
    );
}

/** Reconcile the raw (pre-filter) history findings against the allowlist:
 * returns uncovered findings plus problems for orphaned (unused) entries
 * and occurrence-count drift. Every entry must still match its recorded
 * count exactly — no silent growth, no dead policy. */
export function reconcileHistoryAllowlist(findings, allowlist) {
  const counts = new Map();
  for (const finding of findings) {
    if (typeof finding.blob !== 'string') continue;
    const key = `${finding.blob}:${finding.blobPath}:${finding.pattern}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const uncovered = findings.filter((finding) => !isAllowed(finding, allowlist));
  const problems = [];
  // matchedFindings counts individual historical matches consumed by the
  // exception ENTRIES — the two numbers are reported separately so a
  // reader never mistakes 4 entries for 4 matches (RETURN-2 area 8).
  let matchedFindings = 0;
  for (const entry of allowlist) {
    const key = entryKey(entry);
    const count = counts.get(key) ?? 0;
    matchedFindings += count;
    if (count === 0) {
      problems.push(`orphaned (unused) history exception: ${key} matches nothing`);
    } else if (count !== entry.expectedCount) {
      problems.push(
        `history exception count drift for ${key}: expected ${entry.expectedCount}, found ${count}`,
      );
    }
  }
  return { uncovered, problems, matchedFindings };
}

export function looksBinary(buffer) {
  const probe = buffer.subarray(0, 8000);
  return probe.includes(0);
}
