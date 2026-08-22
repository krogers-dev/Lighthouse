/** Maestro helper (step 2 of 2): fetch the six-digit email OTP MID-FLOW
 * from the local Mailpit, so the flow is executable end to end without an
 * out-of-band OTP_CODE variable prepared by the operator.
 *
 * Acceptance is strict, matching the Node e2e harness: the message must
 * be one that did NOT exist at otp-snapshot.js time, addressed to exactly
 * the synthetic recipient, carrying the exact subject, and containing
 * exactly ONE distinct six-digit token. Anything else leaves
 * output.otpCode unset, so the next inputText fails loudly instead of
 * typing an empty or wrong value silently.
 *
 * Synthetic example.invalid identities and loopback Mailpit only; no
 * secret and no credential travels through this script. Runs inside
 * Maestro's GraalJS runtime, which injects these globals: */
/* global http, output, json, QA_EMAIL, MAILPIT_URL, OTP_SUBJECT */
const email = output.otpEmail
  ? output.otpEmail
  : typeof QA_EMAIL !== 'undefined'
    ? QA_EMAIL
    : 'reviewer.rae@example.invalid';
const mailpit = typeof MAILPIT_URL !== 'undefined' ? MAILPIT_URL : 'http://127.0.0.1:54324';
const expectedSubject = typeof OTP_SUBJECT !== 'undefined' ? OTP_SUBJECT : 'Your HIVE sign-in code';
const seen = output.otpSeenIds ? String(output.otpSeenIds) : '||';

function alreadySeen(id) {
  return seen.indexOf('|' + id + '|') !== -1;
}

// Bounded poll: GraalJS has no sleep, so pacing is a short busy-wait.
const deadline = Date.now() + 20000;
const found = null;
while (Date.now() < deadline && found === null) {
  const listed = json(
    http.get(mailpit + '/api/v1/search?limit=50&query=' + encodeURIComponent('to:"' + email + '"'))
      .body,
  );
  const messages = listed && listed.messages ? listed.messages : [];
  for (let i = 0; i < messages.length; i++) {
    if (!alreadySeen(messages[i].ID)) {
      found = messages[i].ID;
      break;
    }
  }
  if (found === null) {
    const pause = Date.now() + 250;
    while (Date.now() < pause) {
      /* pace the next poll */
    }
  }
}

output.otpCode = '';
output.otpProblem = '';
if (found === null) {
  output.otpProblem = 'no new message arrived for ' + email;
} else {
  const detail = json(http.get(mailpit + '/api/v1/message/' + found).body);
  const recipients = [];
  if (detail && detail.To) {
    for (let r = 0; r < detail.To.length; r++) {
      recipients.push(String(detail.To[r].Address).toLowerCase());
    }
  }
  const body =
    (detail && detail.Text ? detail.Text : '') + '\n' + (detail && detail.HTML ? detail.HTML : '');
  const matches = body.match(/\b\d{6}\b/g) || [];
  const distinct = [];
  for (let m = 0; m < matches.length; m++) {
    if (distinct.indexOf(matches[m]) === -1) distinct.push(matches[m]);
  }
  if (recipients.length !== 1 || recipients[0] !== String(email).toLowerCase()) {
    output.otpProblem = 'recipient mismatch: ' + recipients.join(',');
  } else if (!detail || detail.Subject !== expectedSubject) {
    output.otpProblem = 'subject mismatch: ' + (detail ? detail.Subject : '(none)');
  } else if (distinct.length !== 1) {
    output.otpProblem = 'expected exactly one distinct six-digit token, found ' + distinct.length;
  } else {
    output.otpCode = distinct[0];
  }
}
