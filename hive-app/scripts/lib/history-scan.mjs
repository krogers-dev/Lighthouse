/** Provable full-history scanning helpers (RETURN-4 P2-7), extracted so
 * temp-repository tests can import them without executing the gate. */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { SECRET_PATTERNS, looksBinary, scanText } from './secret-patterns.mjs';

const TEXT_EXTENSIONS_SKIP = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ttf',
  '.otf',
  '.ico',
  '.pdf',
  '.zip',
  '.jar',
]);

/** "Full Git history" must be provable (RETURN-4 P2-7): a shallow or
 * partial/promisor clone silently hides blobs, so scanning one is a hard
 * engine failure, never a smaller clean result. */
export function assertCompleteHistory(gitRun) {
  const problems = [];
  if (gitRun(['rev-parse', '--is-shallow-repository']).trim() === 'true') {
    problems.push('repository is a SHALLOW clone — full-history scanning is impossible');
  }
  let promisors = '';
  try {
    promisors = gitRun(['config', '--get-regexp', String.raw`remote\..*\.promisor`]);
  } catch {
    promisors = ''; // no promisor config at all
  }
  if (promisors.trim() !== '') {
    problems.push('repository has promisor/partial-clone remotes — blobs may be missing locally');
  }
  let filter = '';
  try {
    filter = gitRun(['config', '--get-regexp', String.raw`remote\..*\.partialclonefilter`]);
  } catch {
    filter = '';
  }
  if (filter.trim() !== '') {
    problems.push('repository has a partial-clone filter — blobs may be missing locally');
  }
  return problems;
}

/** Enumerate EVERY historical (blob, path) association (RETURN-4 P2-7):
 * a reused blob under two paths yields findings under BOTH paths, so
 * path-scoped exceptions and per-(blob,path) expected counts stay exact.
 * Each unique blob's content is scanned once and its findings re-emitted
 * per association. */
export function scanHistoryAt(gitRun, rootDir) {
  // `rev-list --objects` prints each object ONCE with a single path, so a
  // reused blob's other paths vanish. Every commit tree is walked instead:
  // ls-tree -r per commit enumerates the complete (blob, path) relation.
  const associations = new Map(); // oid -> Set(paths)
  for (const commit of gitRun(['rev-list', '--all']).split('\n')) {
    if (!commit) continue;
    for (const line of gitRun(['ls-tree', '-r', '--full-tree', commit]).split('\n')) {
      if (!line) continue;
      const tab = line.indexOf('\t');
      if (tab === -1) continue;
      const [, type, oid] = line.slice(0, tab).split(/\s+/);
      if (type !== 'blob') continue;
      const objectPath = line.slice(tab + 1);
      if (TEXT_EXTENSIONS_SKIP.has(path.extname(objectPath).toLowerCase())) continue;
      const paths = associations.get(oid) ?? new Set();
      paths.add(objectPath);
      associations.set(oid, paths);
    }
  }
  const findings = [];
  let blobCount = 0;
  let associationCount = 0;
  for (const [oid, paths] of associations) {
    let type;
    try {
      type = gitRun(['cat-file', '-t', oid]).trim();
    } catch {
      continue;
    }
    if (type !== 'blob') continue;
    blobCount += 1;
    const content = execFileSync('git', ['cat-file', 'blob', oid], {
      cwd: rootDir,
      maxBuffer: 256 * 1024 * 1024,
    });
    if (looksBinary(content)) {
      associationCount += paths.size;
      continue;
    }
    const blobFindings = scanText(content.toString('utf8'), SECRET_PATTERNS, '');
    for (const blobPath of paths) {
      associationCount += 1;
      for (const finding of blobFindings) {
        findings.push({
          ...finding,
          file: `history:${oid.slice(0, 12)}:${blobPath}`,
          blob: oid,
          blobPath,
        });
      }
    }
  }
  return { findings, blobCount, associationCount };
}
