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

/** Allowlist entries: { path, pattern, reason, blob? }.
 *
 * - Without `blob`, an entry allows matches of that pattern in that tracked
 *   file (path suffix match).
 * - With `blob` (a Git object id prefix), the entry allows only that exact
 *   historical blob — used for synthetic values that once existed as
 *   literals; every new blob and tracked file stays fully covered. */
export function isAllowed(finding, allowlist) {
  return allowlist.some((entry) => {
    if (finding.pattern !== entry.pattern) return false;
    if (entry.blob) {
      return typeof finding.blob === 'string' && finding.blob.startsWith(entry.blob);
    }
    if (finding.blob) return false;
    return finding.file === entry.path || finding.file.endsWith(entry.path);
  });
}

export function looksBinary(buffer) {
  const probe = buffer.subarray(0, 8000);
  return probe.includes(0);
}
