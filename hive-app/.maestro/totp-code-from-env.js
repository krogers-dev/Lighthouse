/** Maestro helper script: current TOTP code for the TOTP_SECRET env value
 * (a synthetic QA account's setup key recorded at enrollment), via the
 * loopback helper. Runs inside Maestro's GraalJS runtime, which injects
 * env values and these globals: */
/* global TOTP_SECRET, http, output, json */
const secret = TOTP_SECRET.replace(/\s+/g, '');
const response = http.get('http://127.0.0.1:8477/code?secret=' + secret);
output.totpCode = json(response.body).code;
