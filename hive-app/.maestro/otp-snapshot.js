/** Maestro helper (step 1 of 2): snapshot the Mailpit message ids that
 * already exist for a synthetic QA recipient BEFORE the OTP is requested.
 * otp-fetch.js then accepts only a message that appears AFTER this
 * snapshot, so a stale code from a previous run can never be replayed
 * (the same exact-message semantics the Node e2e harness uses).
 *
 * Only a synthetic example.invalid label travels here; no secret, no
 * credential. Runs inside Maestro's GraalJS runtime, which injects these
 * globals: */
/* global http, output, json, QA_EMAIL, MAILPIT_URL */
const email = typeof QA_EMAIL !== 'undefined' ? QA_EMAIL : 'reviewer.rae@example.invalid';
const mailpit = typeof MAILPIT_URL !== 'undefined' ? MAILPIT_URL : 'http://127.0.0.1:54324';

const response = http.get(
  mailpit + '/api/v1/search?limit=50&query=' + encodeURIComponent('to:"' + email + '"'),
);
const parsed = json(response.body);
const ids = [];
if (parsed && parsed.messages) {
  for (let i = 0; i < parsed.messages.length; i++) ids.push(parsed.messages[i].ID);
}
// Maestro `output` values are strings across scripts: a delimited list.
output.otpSeenIds = '|' + ids.join('|') + '|';
output.otpEmail = email;
