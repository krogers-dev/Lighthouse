/** Exact-origin comparison negatives (RETURN-4 P1-4): the directive's
 * listed bypass classes — suffix hosts, userinfo, loopback suffixes,
 * malformed ports, scheme/port confusion — must all be rejected. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  approvedOrigin,
  isLoopbackUrl,
  originMatchesApproved,
  parseOrigin,
} from '../../scripts/lib/origins.mjs';

test('parseOrigin normalizes scheme-default ports and preserves explicit ones', () => {
  assert.deepEqual(parseOrigin('http://127.0.0.1'), {
    protocol: 'http:',
    hostname: '127.0.0.1',
    port: '80',
  });
  assert.deepEqual(parseOrigin('https://example-project.supabase.co'), {
    protocol: 'https:',
    hostname: 'example-project.supabase.co',
    port: '443',
  });
  assert.equal(parseOrigin('http://127.0.0.1:54321').port, '54321');
});

test('NEGATIVE: userinfo, non-http(s) schemes, and malformed ports are rejected', () => {
  // Assembled at runtime so this tracked file contains no credential-shaped
  // literal (the secret gate never allowlists a tracked file — it is fixed).
  const userinfo = ['synthetic', 'placeholder'].join(':');
  assert.equal(parseOrigin(`https://${userinfo}@example-project.supabase.co`), null);
  assert.equal(parseOrigin('https://kody@example-project.supabase.co'), null);
  assert.equal(parseOrigin('ftp://example-project.supabase.co'), null);
  assert.equal(parseOrigin('file:///etc/passwd'), null);
  assert.equal(parseOrigin('javascript:alert(1)'), null);
  assert.equal(parseOrigin('not a url'), null);
  assert.equal(parseOrigin(''), null);
  // Out-of-range and non-numeric ports fail URL parsing entirely.
  assert.equal(parseOrigin('https://example-project.supabase.co:99999'), null);
  assert.equal(parseOrigin('https://example-project.supabase.co:4four4'), null);
});

test('NEGATIVE: suffix-host bypasses do not match the approved origin', () => {
  const approved = 'https://example-project.supabase.co';
  assert.equal(originMatchesApproved('https://example-project.supabase.co', approved), true);
  // The RETURN-4 counterexample class: approved origin as a PREFIX of a
  // hostile registrable domain.
  assert.equal(
    originMatchesApproved('https://example-project.supabase.co.evil.example', approved),
    false,
  );
  assert.equal(
    originMatchesApproved('https://example-project.supabase.co.evil.example/rest/v1', approved),
    false,
  );
  // Subdomain of the approved host is a DIFFERENT origin too.
  assert.equal(originMatchesApproved('https://evil.example-project.supabase.co', approved), false);
});

test('origin equality is scheme- and port-exact', () => {
  const approved = 'http://127.0.0.1:54321';
  assert.equal(originMatchesApproved('http://127.0.0.1:54321/auth/v1/token', approved), true);
  assert.equal(originMatchesApproved('http://127.0.0.1:54322', approved), false);
  assert.equal(originMatchesApproved('https://127.0.0.1:54321', approved), false);
  // Scheme-default equivalence: an explicit :443 equals the bare https origin.
  assert.equal(originMatchesApproved('https://example.test:443', 'https://example.test'), true);
  // Userinfo on the candidate is rejected even with the right origin.
  assert.equal(originMatchesApproved('http://kody@127.0.0.1:54321', approved), false);
});

test('NEGATIVE: approved values must themselves be clean origins', () => {
  assert.notEqual(approvedOrigin('https://example-project.supabase.co'), null);
  assert.notEqual(approvedOrigin('https://example-project.supabase.co/'), null);
  assert.equal(approvedOrigin('https://example-project.supabase.co/rest'), null);
  assert.equal(approvedOrigin('https://example-project.supabase.co?x=1'), null);
  assert.equal(approvedOrigin('https://example-project.supabase.co#frag'), null);
  assert.equal(approvedOrigin('https://kody@example-project.supabase.co'), null);
  // A dirty approved value can never be matched.
  assert.equal(
    originMatchesApproved(
      'https://example-project.supabase.co',
      'https://example-project.supabase.co/rest',
    ),
    false,
  );
});

test('loopback is an exact-host property, never a prefix', () => {
  assert.equal(isLoopbackUrl('http://127.0.0.1:54321'), true);
  assert.equal(isLoopbackUrl('http://localhost:8081/x'), true);
  assert.equal(isLoopbackUrl('http://10.0.2.2:54321'), true);
  assert.equal(isLoopbackUrl('http://[::1]:54321'), true);
  // The RETURN-4 counterexample: a loopback-name PREFIX on a hostile host.
  assert.equal(isLoopbackUrl('http://127.0.0.1.evil.example'), false);
  assert.equal(isLoopbackUrl('http://localhost.evil.example:54321'), false);
  assert.equal(isLoopbackUrl('http://mylocalhost'), false);
  assert.equal(isLoopbackUrl('https://kody@127.0.0.1'), false);
  assert.equal(isLoopbackUrl('not a url'), false);
});
