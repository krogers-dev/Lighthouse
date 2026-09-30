#!/usr/bin/env node
/**
 * backup-drill — the backup and restore drill on the local stack (WO-007).
 *
 *   node scripts/local-supabase.mjs drill-backup
 *
 * Dumps the running database inside its own container, restores the dump
 * into a scratch database in the same container, compares the row count
 * of every protected table, the memberships, the audit receipts, and the
 * release-control tables between the two, and drops the scratch
 * database. Nothing leaves the container: the dump is written to the
 * container's own temporary storage and removed at the end. Output is
 * table names and counts; never a row.
 *
 * What it proves: a backup taken with the platform's own tool restores
 * completely, including the append-only audit history, which is the
 * precondition the rollback runbook rests on. What it does not prove:
 * anything about a hosted project's managed backups (HOLD until one
 * exists).
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

export const CONTAINER = 'supabase_db_hive-app';
export const SCRATCH_DB = 'hive_backup_drill';
export const COUNTED_TABLES = [
  'environments',
  'clients',
  'entities',
  'memberships',
  'cases',
  'case_attention_items',
  'case_next_actions',
  'requests',
  'activity_events',
  'document_uploads',
  'request_answers',
  'request_answer_citations',
  'case_review_packages',
  'case_reviews',
  'case_approvals',
  'ledger_references',
  'filing_receipts',
  'audit_receipts',
  'service_status',
  'service_status_changes',
  'account_deletion_requests',
];

export function countsQuery() {
  return COUNTED_TABLES.map(
    (table) => `select '${table}' as table_name, count(*)::int as rows from public.${table}`,
  ).join(' union all ');
}

/** Parses "table|count" lines into a map. */
export function parseCounts(output) {
  const counts = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = /^([a-z_]+)\|(\d+)$/.exec(line.trim());
    if (match) counts.set(match[1], Number(match[2]));
  }
  return counts;
}

/** The comparison: every counted table present on both sides with the
 * same count; anything else is a named problem. */
export function compareCounts(source, restored) {
  const problems = [];
  for (const table of COUNTED_TABLES) {
    if (!source.has(table)) problems.push(`${table}: missing from the source counts`);
    else if (!restored.has(table)) problems.push(`${table}: missing from the restored counts`);
    else if (source.get(table) !== restored.get(table)) {
      problems.push(
        `${table}: ${source.get(table)} row(s) in the source, ${restored.get(table)} restored`,
      );
    }
  }
  return problems;
}

function docker(args, options = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', ...options });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function psql(database, sql) {
  return docker(['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', database, '-Atc', sql]);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const started = Date.now();
  const source = psql('postgres', countsQuery());
  if (source.status !== 0) {
    console.error('backup-drill: the source counts could not be read');
    console.error(source.stderr.trim());
    process.exit(1);
  }
  const dump = docker([
    'exec',
    CONTAINER,
    'pg_dump',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-Fc',
    '-f',
    '/tmp/hive-backup-drill.dump',
  ]);
  if (dump.status !== 0) {
    console.error('backup-drill: pg_dump failed');
    console.error(dump.stderr.trim());
    process.exit(1);
  }
  psql('postgres', `drop database if exists ${SCRATCH_DB}`);
  const created = psql('postgres', `create database ${SCRATCH_DB}`);
  if (created.status !== 0) {
    console.error('backup-drill: the scratch database could not be created');
    process.exit(1);
  }
  let exitCode = 0;
  try {
    const restore = docker([
      'exec',
      CONTAINER,
      'pg_restore',
      '-U',
      'postgres',
      '-d',
      SCRATCH_DB,
      '--no-owner',
      '--no-privileges',
      '/tmp/hive-backup-drill.dump',
    ]);
    // pg_restore reports non-fatal notices (extension members, roles it does
    // not create) as warnings with exit 1; the counts decide, not the code.
    const restored = psql(SCRATCH_DB, countsQuery());
    if (restored.status !== 0) {
      console.error('backup-drill: the restored counts could not be read');
      console.error(restored.stderr.trim());
      console.error(restore.stderr.trim().split('\n').slice(-5).join('\n'));
      exitCode = 1;
    } else {
      const sourceCounts = parseCounts(source.stdout);
      const restoredCounts = parseCounts(restored.stdout);
      const problems = compareCounts(sourceCounts, restoredCounts);
      for (const table of COUNTED_TABLES) {
        console.log(
          `backup-drill: ${table.padEnd(26)} source ${String(sourceCounts.get(table) ?? '-').padStart(4)}  restored ${String(restoredCounts.get(table) ?? '-').padStart(4)}`,
        );
      }
      if (problems.length > 0) {
        for (const problem of problems) console.error(`  - ${problem}`);
        console.error('backup-drill: the restore does not match the source');
        exitCode = 1;
      } else {
        console.log(
          `backup-drill: OK — ${COUNTED_TABLES.length} tables restored with identical counts in ${Math.round((Date.now() - started) / 1000)}s (pg_restore exit ${restore.status})`,
        );
      }
    }
  } finally {
    psql('postgres', `drop database if exists ${SCRATCH_DB}`);
    docker(['exec', CONTAINER, 'rm', '-f', '/tmp/hive-backup-drill.dump']);
  }
  process.exit(exitCode);
}
