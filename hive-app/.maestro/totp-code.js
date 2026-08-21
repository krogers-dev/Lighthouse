/** Maestro helper script: turn the copied on-screen setup key into the
 * current six-digit TOTP code via the loopback helper
 * (scripts/totp-helper.mjs), which stands in for the human's authenticator
 * app in the device lane. Synthetic QA identities only; loopback only.
 * Runs inside Maestro's GraalJS runtime, which injects these globals: */
/* global maestro, http, output, json */
const secret = maestro.copiedText.replace(/\s+/g, '');
const response = http.get('http://127.0.0.1:8477/code?secret=' + secret);
output.totpCode = json(response.body).code;
