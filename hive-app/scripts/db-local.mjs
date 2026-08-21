#!/usr/bin/env node
/**
 * db-local — plain-PostgreSQL fallback lane for the HIVE database.
 *
 * The canonical database lane is the pinned Supabase CLI against Docker
 * (scripts/local-supabase.mjs). In environments where container images
 * cannot be pulled, this harness runs the same migrations, seed, and pgTAP
 * suites against a system PostgreSQL (16+) with the Supabase platform
 * baseline shimmed in (scripts/sql/supabase-shim.sql), so RLS and grant
 * evidence stays executable. It listens on loopback only, with synthetic
 * data only.
 *
 * Commands:
 *   node scripts/db-local.mjs reset    # init + start + shim + migrations + seed
 *   node scripts/db-local.mjs test     # reset, then run pgTAP via pg_prove
 *   node scripts/db-local.mjs stop     # stop the cluster
 *   node scripts/db-local.mjs url      # print the loopback connection URL
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PG_BIN = process.env.HIVE_PG_BIN ?? '/usr/lib/postgresql/16/bin';
const CACHE = path.join(appRoot, '.cache', 'hive-pg');
const DATA = path.join(CACHE, 'data');
const PORT = process.env.HIVE_PG_PORT ?? '55433';
const DB = 'hive_local';
const PG_USER = 'hivepg';

export const DB_URL = `postgresql://${PG_USER}@127.0.0.1:${PORT}/${DB}`;

function asPgUser(cmd, args, options = {}) {
  // postgres refuses to run as root; in root sandboxes everything runs via
  // a dedicated system user.
  const base = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options };
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    return spawnSync('runuser', ['-u', PG_USER, '--', cmd, ...args], base);
  }
  return spawnSync(cmd, [...args], base);
}

function ensureUser() {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return;
  const check = spawnSync('id', ['-u', PG_USER], { encoding: 'utf8' });
  if (check.status !== 0) {
    execFileSync('useradd', ['--system', '--no-create-home', '--shell', '/usr/sbin/nologin', PG_USER]);
  }
}

function fail(message, output) {
  if (output) console.error(output);
  console.error(`db-local: ${message}`);
  process.exit(1);
}

function run(label, cmd, args, options = {}) {
  const result = asPgUser(cmd, args, options);
  if (result.status !== 0) {
    fail(`${label} failed (exit ${result.status})`, `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
  return result.stdout ?? '';
}

function serverRunning() {
  const result = asPgUser(path.join(PG_BIN, 'pg_isready'), ['-h', '127.0.0.1', '-p', PORT]);
  return result.status === 0;
}

function initCluster() {
  ensureUser();
  mkdirSync(CACHE, { recursive: true });
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    execFileSync('chown', ['-R', `${PG_USER}:${PG_USER}`, CACHE]);
  }
  if (!existsSync(path.join(DATA, 'PG_VERSION'))) {
    run('initdb', path.join(PG_BIN, 'initdb'), ['-D', DATA, '--auth-local=trust', '--auth-host=trust', '-U', PG_USER]);
  }
  if (!serverRunning()) {
    run('pg_ctl start', path.join(PG_BIN, 'pg_ctl'), [
      'start', '-D', DATA, '-w', '-l', path.join(CACHE, 'postgres.log'), '-o',
      `-p ${PORT} -c listen_addresses=127.0.0.1 -k ${CACHE}`,
    ]);
  }
}

function psql(args, options = {}) {
  return run('psql', path.join(PG_BIN, 'psql'), [
    '-h', '127.0.0.1', '-p', PORT, '-U', PG_USER, '-v', 'ON_ERROR_STOP=1', ...args,
  ], options);
}

function migrationFiles() {
  return readdirSync(path.join(appRoot, 'supabase', 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => path.join(appRoot, 'supabase', 'migrations', f));
}

function reset() {
  initCluster();
  psql(['-d', 'postgres', '-c', `drop database if exists ${DB}`]);
  psql(['-d', 'postgres', '-c', `create database ${DB}`]);
  psql(['-d', DB, '-f', path.join(appRoot, 'scripts', 'sql', 'supabase-shim.sql')]);
  for (const file of migrationFiles()) {
    psql(['-d', DB, '-f', file]);
    console.log(`applied ${path.basename(file)}`);
  }
  psql(['-d', DB, '-f', path.join(appRoot, 'supabase', 'seed.sql')]);
  console.log('seed applied');
  console.log(`db-local reset OK on ${DB_URL}`);
}

function test() {
  reset();
  const testDir = path.join(appRoot, 'supabase', 'tests');
  const files = readdirSync(testDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => path.join(testDir, f));
  if (files.length === 0) fail('no pgTAP test files found');
  const result = asPgUser('pg_prove', [
    '--host', '127.0.0.1', '--port', PORT, '--username', PG_USER, '--dbname', DB,
    '--verbose', ...files,
  ], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (result.status !== 0) fail(`pg_prove failed (exit ${result.status})`);
  console.log('db-local pgTAP suite OK');
}

function stop() {
  if (!existsSync(path.join(DATA, 'PG_VERSION'))) return;
  asPgUser(path.join(PG_BIN, 'pg_ctl'), ['-D', DATA, '-m', 'fast', 'stop']);
  console.log('db-local stopped');
}

const command = process.argv[2];
switch (command) {
  case 'reset':
    reset();
    break;
  case 'test':
    test();
    break;
  case 'stop':
    stop();
    break;
  case 'url':
    console.log(DB_URL);
    break;
  default:
    fail('usage: db-local.mjs <reset|test|stop|url>');
}
