/** Maestro helper script: current TOTP code for an already-captured
 * synthetic QA account. The URL carries only the synthetic account label —
 * the secret stays in the loopback helper process's memory from the
 * enrollment flow. Runs inside Maestro's GraalJS runtime, which injects
 * these globals: */
/* global http, output, json, TOTP_USER */
const user = typeof TOTP_USER !== 'undefined' ? TOTP_USER : 'reviewer.rae@example.invalid';
const response = http.get('http://127.0.0.1:8477/code?user=' + encodeURIComponent(user));
const parsed = json(response.body);
output.totpCode = parsed.code;
output.totpWrongCode = parsed.wrongCode;
