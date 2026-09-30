/** Maestro helper script (enrollment): hand the copied on-screen setup key
 * to the loopback helper's MEMORY via a POST body — never a CLI argument,
 * env var, or URL parameter — and receive the current code plus a
 * guaranteed-wrong code derived from it. The flow overwrites the
 * clipboard immediately afterwards. Synthetic QA identities only.
 * Runs inside Maestro's GraalJS runtime, which injects these globals: */
/* global maestro, http, output, json, TOTP_USER */
const user = typeof TOTP_USER !== 'undefined' ? TOTP_USER : 'reviewer.rae@example.invalid';
const response = http.post('http://127.0.0.1:8477/capture', {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user: user, secret: maestro.copiedText }),
});
const parsed = json(response.body);
output.totpCode = parsed.code;
output.totpWrongCode = parsed.wrongCode;
