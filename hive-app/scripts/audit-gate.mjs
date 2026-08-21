#!/usr/bin/env node
/**
 * audit:gate — npm audit with recorded waivers.
 *
 * `npm audit --audit-level=high` has no ignore mechanism, so this gate runs
 * the audit itself and fails on any high/critical advisory that is not
 * covered by an unexpired waiver in security/waivers.json. Expired waivers
 * fail the gate, which is what forces the retest.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function evaluateAudit(auditReport, waiverFile, today) {
  const failures = [];
  const notes = [];
  const waivers = new Map(
    (waiverFile.waivers ?? []).map((w) => [w.advisory, w]),
  );
  const seen = new Set();
  for (const vuln of Object.values(auditReport.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via !== 'object' || via === null) continue;
      const ghsa = (via.url ?? '').split('/').pop() ?? '';
      if (seen.has(ghsa)) continue;
      seen.add(ghsa);
      if (via.severity !== 'high' && via.severity !== 'critical') {
        notes.push(`info: ${via.severity} ${ghsa} (${via.name}) below the high gate`);
        continue;
      }
      const waiver = waivers.get(ghsa);
      if (!waiver) {
        failures.push(`unwaived ${via.severity} advisory ${ghsa} (${via.name})`);
      } else if (waiver.expires < today) {
        failures.push(
          `waiver for ${ghsa} (${via.name}) expired ${waiver.expires} — retest required (owner ${waiver.owner})`,
        );
      } else {
        notes.push(
          `waived: ${ghsa} (${via.name}) by ${waiver.owner} until ${waiver.expires}`,
        );
      }
    }
  }
  return { failures, notes };
}

function main() {
  let raw;
  try {
    raw = execFileSync('npm', ['audit', '--json'], {
      cwd: appRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // npm audit exits 1 when vulnerabilities exist; the JSON is still on stdout.
    raw = error.stdout;
    if (!raw) {
      console.error('audit:gate could not run npm audit');
      process.exit(1);
    }
  }
  const report = JSON.parse(raw);
  const waiverFile = JSON.parse(
    readFileSync(path.join(appRoot, 'security', 'waivers.json'), 'utf8'),
  );
  const today = new Date().toISOString().slice(0, 10);
  const { failures, notes } = evaluateAudit(report, waiverFile, today);
  for (const note of notes) console.log(note);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exit(1);
  }
  console.log('audit:gate OK (high/critical advisories all covered by unexpired waivers)');
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
