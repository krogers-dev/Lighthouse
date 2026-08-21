import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RELEASE_ONLY_PATTERNS,
  SECRET_PATTERNS,
  isAllowed,
  looksBinary,
  scanText,
} from '../../scripts/lib/secret-patterns.mjs';

// All secret-shaped inputs are assembled at runtime (never literals).
const jwt = ['eyJsyntheticA', 'eyJsyntheticB', 'signature99'].join('.');
const sbSecret = 'sb_' + 'secret_' + 'syntheticsynthetic';
const pem = ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ');

test('detects each secret class with line numbers', () => {
  const text = `line one\n${jwt}\nplain\n${sbSecret}\n${pem}\n`;
  const findings = scanText(text, SECRET_PATTERNS, 'file.txt');
  const byPattern = new Map(findings.map((f) => [f.pattern, f]));
  assert.equal(byPattern.get('jwt-shaped-token')?.line, 2);
  assert.equal(byPattern.get('supabase-secret-key')?.line, 4);
  assert.equal(byPattern.get('private-key-block')?.line, 5);
});

test('never includes the matched value in findings', () => {
  const findings = scanText(sbSecret, SECRET_PATTERNS, 'file.txt');
  for (const finding of findings) {
    assert.ok(!JSON.stringify(finding).includes('syntheticsynthetic'));
  }
});

test('does not flag publishable keys or prose mentions of service_role', () => {
  const clean = 'sb_publishable_syntheticsynthetic and the service_role stays server-side';
  assert.deepEqual(scanText(clean, SECRET_PATTERNS, 'x'), []);
});

test('flags populated secret-ish env lines but not empty ones', () => {
  const findings = scanText('MY_SERVICE_KEY=value123\nOTHER_SECRET=\n', SECRET_PATTERNS, '.env');
  assert.equal(findings.filter((f) => f.pattern === 'generic-secret-env').length, 1);
});

test('release-only patterns catch loopback and development identifiers', () => {
  const text = 'http://127.0.0.1:54321 plus com.myhbcfo.hive.development';
  const patterns = scanText(text, RELEASE_ONLY_PATTERNS, 'bundle.js').map((f) => f.pattern);
  assert.ok(patterns.includes('loopback-endpoint'));
  assert.ok(patterns.includes('development-identifier'));
});

test('allowlist matches tracked findings by path+pattern only', () => {
  const entry = { path: 'src/a.ts', pattern: 'jwt-shaped-token', reason: 'synthetic' };
  assert.ok(isAllowed({ file: 'src/a.ts', pattern: 'jwt-shaped-token' }, [entry]));
  assert.ok(!isAllowed({ file: 'src/b.ts', pattern: 'jwt-shaped-token' }, [entry]));
  assert.ok(!isAllowed({ file: 'src/a.ts', pattern: 'supabase-secret-key' }, [entry]));
  // A history finding (with blob) is never covered by a path-only entry.
  assert.ok(!isAllowed({ file: 'src/a.ts', pattern: 'jwt-shaped-token', blob: 'abc123' }, [entry]));
});

test('blob-scoped allowlist entries cover exactly one historical object', () => {
  const entry = { blob: 'abc123', pattern: 'jwt-shaped-token', reason: 'synthetic history' };
  assert.ok(isAllowed({ file: 'any', pattern: 'jwt-shaped-token', blob: 'abc123def' }, [entry]));
  assert.ok(!isAllowed({ file: 'any', pattern: 'jwt-shaped-token', blob: 'ffff' }, [entry]));
  assert.ok(!isAllowed({ file: 'any', pattern: 'jwt-shaped-token' }, [entry]));
});

test('binary detection', () => {
  assert.equal(looksBinary(Buffer.from('plain text')), false);
  assert.equal(looksBinary(Buffer.from([0x89, 0x50, 0x00, 0x47])), true);
});
