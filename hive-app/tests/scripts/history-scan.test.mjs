/** Temp-repository proofs for full-history scanning (RETURN-4 P2-7). */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { assertCompleteHistory, scanHistoryAt } from '../../scripts/lib/history-scan.mjs';

function gitIn(dir) {
  return (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
}

function makeRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'hive-history-'));
  const git = gitIn(dir);
  git(['init', '-q']);
  git(['config', 'user.email', 'qa@example.invalid']);
  git(['config', 'user.name', 'HIVE QA (Synthetic)']);
  return { dir, git };
}

// Assembled at runtime so this test file never contains a secret literal.
const syntheticSecret = 'sb_' + 'secret_' + 'historyreusedvalue';

test('a reused secret-bearing blob is reported under BOTH of its paths', () => {
  const { dir, git } = makeRepo();
  writeFileSync(path.join(dir, 'first.txt'), `${syntheticSecret}\n`);
  git(['add', 'first.txt']);
  git(['commit', '-qm', 'first path']);
  // Same content under a second path: identical blob OID, new association.
  writeFileSync(path.join(dir, 'second.txt'), `${syntheticSecret}\n`);
  git(['add', 'second.txt']);
  git(['commit', '-qm', 'second path']);

  const { findings, blobCount, associationCount } = scanHistoryAt(git, dir);
  const paths = new Set(findings.map((f) => f.blobPath));
  assert.ok(paths.has('first.txt'), 'finding under first.txt');
  assert.ok(paths.has('second.txt'), 'finding under second.txt (reused blob)');
  // One unique blob, two associations — the old OID dedup recorded one.
  const oids = new Set(findings.map((f) => f.blob));
  assert.equal(oids.size, 1);
  assert.ok(associationCount >= blobCount);
});

test('a SHALLOW clone is detected and refused', () => {
  const { dir, git } = makeRepo();
  for (let i = 0; i < 3; i++) {
    writeFileSync(path.join(dir, 'file.txt'), `revision ${i}\n`);
    git(['add', 'file.txt']);
    git(['commit', '-qm', `rev ${i}`]);
  }
  const shallowDir = mkdtempSync(path.join(tmpdir(), 'hive-shallow-'));
  execFileSync(
    'git',
    ['clone', '-q', '--depth', '1', `file://${dir}`, path.join(shallowDir, 'clone')],
    { encoding: 'utf8' },
  );
  const problems = assertCompleteHistory(gitIn(path.join(shallowDir, 'clone')));
  assert.ok(problems.some((p) => p.includes('SHALLOW')));
  // The full repository passes.
  assert.deepEqual(assertCompleteHistory(git), []);
});

test('a partial/promisor clone is detected and refused', () => {
  const { dir, git } = makeRepo();
  writeFileSync(path.join(dir, 'file.txt'), 'content\n');
  git(['add', 'file.txt']);
  git(['commit', '-qm', 'rev']);
  const partialDir = mkdtempSync(path.join(tmpdir(), 'hive-partial-'));
  const cloneDir = path.join(partialDir, 'clone');
  execFileSync('git', ['clone', '-q', '--filter=blob:none', `file://${dir}`, cloneDir], {
    encoding: 'utf8',
  });
  const problems = assertCompleteHistory(gitIn(cloneDir));
  assert.ok(problems.some((p) => p.includes('promisor') || p.includes('partial')));
});
