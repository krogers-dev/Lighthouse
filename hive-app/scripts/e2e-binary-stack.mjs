#!/usr/bin/env node
/**
 * e2e-binary-stack — the black-box auth lane WITHOUT Docker.
 *
 * The authorized evidence lane for A3 is the Supabase CLI stack
 * (`local-supabase.mjs`), which needs Docker images this container's
 * network policy cannot pull. This stack runs the SAME serving software
 * as real processes on loopback instead:
 *
 *   - GoTrue (supabase/auth) v2.196.0, built from the pinned source tag
 *   - PostgREST v13.0.8, the official static binary
 *   - Mailpit v1.31.0, the official binary
 *   - PostgreSQL 16 (the system install this repo's pgTAP lane uses)
 *   - a ~100-line loopback path router standing where Kong stands
 *
 * What this lane proves: the real GoTrue OTP/TOTP/AAL semantics, the
 * real PostgREST JWT-to-role switching, and this repository's actual
 * migrations, RLS policies, and seed — exercised end to end by the
 * UNMODIFIED `e2e-local-auth.mjs` harness over HTTP.
 *
 * What it deliberately does NOT claim: Kong's gateway behavior, the
 * Supabase CLI's composition, or the publishable-key front door. The
 * router is a named synthetic adapter (loopback-only, refuses anything
 * else); keys are legacy JWT-shaped, which policy permits ONLY for
 * loopback development and the release gates reject. Evidence from this
 * lane is labeled "binary stack", never "CLI stack".
 *
 * Binaries live in .cache/e2e-bin (gitignored, never committed); their
 * versions and sha256 digests are pinned below and verified before use.
 *
 * Usage: node scripts/e2e-binary-stack.mjs <run|up|seed|e2e|stop>
 *   run = up + seed + e2e + stop, exiting with the harness's code.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binDir = path.join(appRoot, '.cache', 'e2e-bin');
const stateDir = path.join(appRoot, '.cache', 'e2e-stack');
const logDir = path.join(stateDir, 'logs');
const pgDir = path.join(stateDir, 'pg');
const pidsPath = path.join(stateDir, 'pids.json');
const secretsPath = path.join(stateDir, 'secrets.json');

/** Pinned components. The digests are of the exact binaries this lane
 * was brought up and evidenced with; a mismatch is a different stack. */
const PINS = {
  gotrue: {
    version: 'v2.196.0 (built from source tag, commit 0204331ca41a)',
    sha256: '708714b1a3e814a9d694797d1d84d9378da93908e14936e7b9ed5776e124ec7d',
  },
  postgrest: {
    version: 'v13.0.8 (official static linux-x86-64)',
    sha256: '43762bcbf9cc4ffa6cc803a54b425c10d48324ea1163544456112e11bc3e0b97',
  },
  mailpit: {
    version: 'v1.31.0 (official linux-amd64)',
    sha256: 'bfdbc6608241f983636bfa0d331b7b4fee1736210eca03ae3d5630e64290e1f9',
  },
};

const PORTS = {
  router: 54321, // what the harness and app call the Supabase URL
  mailpitHttp: 54324, // the harness's default Mailpit URL
  mailpitSmtp: 54325,
  gotrue: 55441,
  postgrest: 55442,
  postgres: 55434, // own cluster: never fights the pgTAP lane on 55433
};

const PG_BIN = '/usr/lib/postgresql/16/bin';
const SUPERUSER = 'hivee2e';
const DB = 'hive_e2e';
/** Same pattern as db-local.mjs: postgres refuses root, so in root
 * sandboxes every server-side pg command runs as this system user, and
 * the socket lives in a short /tmp path (107-byte AF_UNIX ceiling). */
const PG_OS_USER = 'hivepg';
const PG_SOCK_DIR = `/tmp/hive-e2e-pg-${PORTS.postgres}`;
const BASE_URL = `http://127.0.0.1:${PORTS.router}`;

// ---------------------------------------------------------------- utils

function log(message) {
  console.log(`e2e-binary-stack: ${message}`);
}

function fail(message, code = 2) {
  console.error(`e2e-binary-stack: ${message}`);
  process.exit(code);
}

function sh(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options });
}

/** Server-side postgres tooling, dropped to the dedicated system user
 * when running as root (initdb/pg_ctl refuse root outright). */
function shAsPg(command, args, options = {}) {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    return sh('runuser', ['-u', PG_OS_USER, '--', command, ...args], options);
  }
  return sh(command, args, options);
}

function psql(sql, database = DB) {
  return sh(path.join(PG_BIN, 'psql'), [
    '-v',
    'ON_ERROR_STOP=1',
    '-h',
    '127.0.0.1',
    '-p',
    String(PORTS.postgres),
    '-U',
    SUPERUSER,
    '-d',
    database,
    '-q',
    '-c',
    sql,
  ]);
}

function psqlFile(file, database = DB) {
  return sh(path.join(PG_BIN, 'psql'), [
    '-v',
    'ON_ERROR_STOP=1',
    '-h',
    '127.0.0.1',
    '-p',
    String(PORTS.postgres),
    '-U',
    SUPERUSER,
    '-d',
    database,
    '-q',
    '-f',
    file,
  ]);
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

/** Legacy JWT-shaped keys, HS256-signed with the run's own random
 * secret. Policy: loopback development only; release gates reject the
 * shape outright, and the harness itself refuses non-loopback URLs. */
function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyPins() {
  for (const [name, pin] of Object.entries(PINS)) {
    const file = path.join(binDir, name);
    if (!existsSync(file)) fail(`${file} is missing — the pinned ${name} binary is not in place`);
    const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (digest !== pin.sha256) {
      fail(
        `${name} digest mismatch: expected ${pin.sha256}, found ${digest} — refusing a binary that is not the pinned ${pin.version}`,
      );
    }
  }
  log(
    `pins verified: gotrue ${PINS.gotrue.version}; postgrest ${PINS.postgrest.version}; mailpit ${PINS.mailpit.version}`,
  );
}

function loadOrCreateSecrets() {
  if (existsSync(secretsPath)) return JSON.parse(readFileSync(secretsPath, 'utf8'));
  const jwtSecret = randomBytes(48).toString('base64url');
  const dbPassword = randomBytes(24).toString('base64url');
  const nowSeconds = Math.floor(Date.now() / 1000);
  const exp = nowSeconds + 48 * 3600;
  const secrets = {
    jwtSecret,
    dbPassword,
    anonKey: signJwt(
      { role: 'anon', iss: 'hive-local-binary-stack', iat: nowSeconds, exp },
      jwtSecret,
    ),
    serviceKey: signJwt(
      { role: 'service_role', iss: 'hive-local-binary-stack', iat: nowSeconds, exp },
      jwtSecret,
    ),
  };
  writeFileSync(secretsPath, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  return secrets;
}

function readPids() {
  return existsSync(pidsPath) ? JSON.parse(readFileSync(pidsPath, 'utf8')) : {};
}

function writePids(pids) {
  writeFileSync(pidsPath, JSON.stringify(pids, null, 2));
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function spawnLogged(name, command, args, env) {
  const out = path.join(logDir, `${name}.log`);
  // Append so a crash's last lines survive a restart attempt.
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', openSync(out, 'a'), openSync(out, 'a')],
    detached: true,
  });
  child.unref();
  return child.pid;
}

async function waitHttp(url, name, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail(`${name} did not become ready at ${url}; see ${logDir}`);
}

// ------------------------------------------------------------- postgres

function pgRunning() {
  try {
    sh(path.join(PG_BIN, 'pg_isready'), ['-h', '127.0.0.1', '-p', String(PORTS.postgres)]);
    return true;
  } catch {
    return false;
  }
}

function startPostgres() {
  if (pgRunning()) return;
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    if (sh('bash', ['-c', `id -u ${PG_OS_USER} >/dev/null 2>&1; echo $?`]).trim() !== '0') {
      sh('useradd', ['--system', '--no-create-home', '--shell', '/usr/sbin/nologin', PG_OS_USER]);
    }
    mkdirSync(pgDir, { recursive: true });
    mkdirSync(PG_SOCK_DIR, { recursive: true });
    sh('chown', ['-R', PG_OS_USER, pgDir, PG_SOCK_DIR]);
  } else {
    mkdirSync(pgDir, { recursive: true });
    mkdirSync(PG_SOCK_DIR, { recursive: true });
  }
  if (!existsSync(path.join(pgDir, 'PG_VERSION'))) {
    shAsPg(path.join(PG_BIN, 'initdb'), [
      '-D',
      pgDir,
      '-U',
      SUPERUSER,
      '-A',
      'trust',
      '-E',
      'UTF8',
    ]);
  }
  shAsPg(path.join(PG_BIN, 'pg_ctl'), [
    '-D',
    pgDir,
    '-l',
    path.join(PG_SOCK_DIR, 'postgres.log'),
    '-o',
    `-p ${PORTS.postgres} -c listen_addresses=127.0.0.1 -c unix_socket_directories='${PG_SOCK_DIR}'`,
    'start',
  ]);
  for (let i = 0; i < 20 && !pgRunning(); i += 1) sh('sleep', ['0.5']);
  if (!pgRunning()) fail(`postgres did not start; see ${PG_SOCK_DIR}/postgres.log`);
}

function initDatabase(secrets) {
  // Fresh database every bring-up: the lane's evidence is only meaningful
  // from a known state, exactly like `db-local.mjs reset`.
  psql(`drop database if exists ${DB} with (force);`, 'postgres');
  psql(
    `
    do $$ begin
      if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
      if not exists (select from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
      if not exists (select from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin login; end if;
      -- The platform image always has these; GoTrue's own migrations
      -- grant to them and fail on a cluster where they are absent.
      if not exists (select from pg_roles where rolname = 'postgres') then create role postgres nologin; end if;
      if not exists (select from pg_roles where rolname = 'supabase_admin') then create role supabase_admin nologin; end if;
    end $$;
    alter role authenticator password '${secrets.dbPassword}';
    alter role supabase_auth_admin password '${secrets.dbPassword}';
    grant anon, authenticated, service_role to authenticator;
    -- The platform gives service_role BYPASSRLS; grants still apply.
    alter role service_role bypassrls;
  `,
    'postgres',
  );
  psql(`create database ${DB} owner ${SUPERUSER};`, 'postgres');
  psql(`
    create extension if not exists pgcrypto;
    create schema if not exists auth authorization supabase_auth_admin;
    grant usage on schema auth to anon, authenticated, service_role;
  `);
}

/** The auth helper functions PostgREST-side policies call. These are the
 * SAME definitions the pgTAP shim uses (scripts/sql/supabase-shim.sql):
 * on the platform they come from the supabase/postgres image, not from
 * GoTrue, so a GoTrue-migrated schema does not have them. */
function installAuthHelpers() {
  psql(`
    create or replace function auth.uid() returns uuid language sql stable as $$
      select coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
      )::uuid
    $$;
    create or replace function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb,
        '{}'::jsonb
      )
    $$;
    create or replace function auth.role() returns text language sql stable as $$
      select coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
      )
    $$;
    grant execute on function auth.uid() to public;
    grant execute on function auth.jwt() to public;
    grant execute on function auth.role() to public;
  `);
}

function applyMigrationsAndSeed() {
  const migrationsDir = path.join(appRoot, 'supabase', 'migrations');
  const files = sh('bash', ['-c', `ls ${JSON.stringify(migrationsDir)}/*.sql | sort`])
    .trim()
    .split('\n');
  for (const file of files) {
    psqlFile(file);
    log(`applied ${path.basename(file)}`);
  }
  psqlFile(path.join(appRoot, 'supabase', 'seed.sql'));
  log('seed.sql applied (domain rows)');
  // The platform's default privileges give service_role full table access
  // (grants, not RLS: BYPASSRLS alone opens no table). The repository's
  // migrations assume that platform baseline, so it is reproduced here.
  psql(`
    grant usage on schema public to service_role;
    grant all on all tables in schema public to service_role;
    grant all on all sequences in schema public to service_role;
  `);
}

// ------------------------------------------------------------- services

function gotrueEnv(secrets, forServe) {
  const dbUrl = `postgres://supabase_auth_admin:${secrets.dbPassword}@127.0.0.1:${PORTS.postgres}/${DB}?search_path=auth&sslmode=disable`;
  const templates = `${BASE_URL}/e2e-templates/magic_link.html`;
  return {
    GOTRUE_API_HOST: '127.0.0.1',
    PORT: String(PORTS.gotrue),
    API_EXTERNAL_URL: `${BASE_URL}/auth/v1`,
    GOTRUE_SITE_URL: 'http://127.0.0.1:3000',
    GOTRUE_URI_ALLOW_LIST: '',
    GOTRUE_DB_DRIVER: 'postgres',
    GOTRUE_DB_DATABASE_URL: dbUrl,
    DATABASE_URL: dbUrl,
    GOTRUE_JWT_SECRET: secrets.jwtSecret,
    GOTRUE_JWT_EXP: '3600',
    GOTRUE_JWT_AUD: 'authenticated',
    GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
    GOTRUE_JWT_ADMIN_ROLES: 'service_role',
    // Self-registration is disabled (brief). Seeded users still receive
    // OTP: DISABLE_SIGNUP only blocks new-user creation.
    GOTRUE_DISABLE_SIGNUP: 'true',
    GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
    GOTRUE_MAILER_AUTOCONFIRM: 'false',
    GOTRUE_SMTP_HOST: '127.0.0.1',
    GOTRUE_SMTP_PORT: String(PORTS.mailpitSmtp),
    GOTRUE_SMTP_ADMIN_EMAIL: 'hive-local@example.invalid',
    GOTRUE_SMTP_SENDER_NAME: 'HIVE Local',
    // P0-1 contract: the OTP arrives as a six-digit code under this exact
    // subject; the harness asserts both. Both env spellings are set
    // because GoTrue has used each across versions.
    GOTRUE_MAILER_SUBJECTS_MAGIC_LINK: 'Your HIVE sign-in code',
    GOTRUE_MAILER_SUBJECTS_MAGICLINK: 'Your HIVE sign-in code',
    GOTRUE_MAILER_TEMPLATES_MAGIC_LINK: templates,
    GOTRUE_MAILER_TEMPLATES_MAGICLINK: templates,
    GOTRUE_MAILER_OTP_LENGTH: '6',
    GOTRUE_MFA_TOTP_ENROLL_ENABLED: 'true',
    GOTRUE_MFA_TOTP_VERIFY_ENABLED: 'true',
    GOTRUE_MFA_MAX_ENROLLED_FACTORS: '10',
    // Mirrors supabase/config.toml's raised local limits: nine synthetic
    // accounts sign in repeatedly during one evidence run, and the
    // harness deliberately requests a SECOND code for the same address
    // (fresh-code-wins is one of its assertions). config.toml sets
    // [auth.email] max_frequency = "1s"; GoTrue's default of a minute
    // fails exactly those repeat requests.
    GOTRUE_SMTP_MAX_FREQUENCY: '1s',
    GOTRUE_RATE_LIMIT_EMAIL_SENT: '360',
    GOTRUE_RATE_LIMIT_VERIFY: '360',
    GOTRUE_RATE_LIMIT_TOKEN_REFRESH: '360',
    GOTRUE_RATE_LIMIT_OTP: '360',
    GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED: 'true',
    GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL: '10',
    GOTRUE_LOG_LEVEL: forServe ? 'info' : 'warn',
  };
}

function startMailpit(pids) {
  pids.mailpit = spawnLogged(
    'mailpit',
    path.join(binDir, 'mailpit'),
    [
      '--listen',
      `127.0.0.1:${PORTS.mailpitHttp}`,
      '--smtp',
      `127.0.0.1:${PORTS.mailpitSmtp}`,
      '--disable-version-check',
    ],
    {},
  );
}

function startGotrue(pids, secrets) {
  sh(path.join(binDir, 'gotrue'), ['migrate'], {
    env: { ...process.env, ...gotrueEnv(secrets, false) },
  });
  log('gotrue migrations applied (real auth schema)');
  installAuthHelpers();
  pids.gotrue = spawnLogged(
    'gotrue',
    path.join(binDir, 'gotrue'),
    ['serve'],
    gotrueEnv(secrets, true),
  );
}

function startPostgrest(pids, secrets) {
  pids.postgrest = spawnLogged('postgrest', path.join(binDir, 'postgrest'), [], {
    PGRST_SERVER_HOST: '127.0.0.1',
    PGRST_SERVER_PORT: String(PORTS.postgrest),
    PGRST_DB_URI: `postgres://authenticator:${secrets.dbPassword}@127.0.0.1:${PORTS.postgres}/${DB}`,
    PGRST_DB_SCHEMAS: 'public',
    PGRST_DB_ANON_ROLE: 'anon',
    PGRST_JWT_SECRET: secrets.jwtSecret,
    PGRST_DB_POOL: '5',
    PGRST_LOG_LEVEL: 'info',
  });
}

/** The router: /auth/v1/* to GoTrue, /rest/v1/* to PostgREST, and the
 * OTP email template served to GoTrue. It stands where Kong stands and
 * claims none of Kong's behavior; it binds loopback and refuses any
 * non-loopback peer outright. */
const ROUTER_SOURCE = `
const http = require('node:http');
const { readFileSync } = require('node:fs');
const TEMPLATE = readFileSync(process.env.TEMPLATE_PATH, 'utf8');
const GOTRUE = Number(process.env.GOTRUE_PORT);
const POSTGREST = Number(process.env.POSTGREST_PORT);
const server = http.createServer((req, res) => {
  const peer = req.socket.remoteAddress ?? '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) {
    res.writeHead(403); res.end('loopback only'); return;
  }
  if (req.url.startsWith('/e2e-templates/magic_link.html')) {
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(TEMPLATE); return;
  }
  let target = null; let stripped = null;
  if (req.url.startsWith('/auth/v1/')) { target = GOTRUE; stripped = req.url.slice('/auth/v1'.length); }
  else if (req.url.startsWith('/rest/v1/')) { target = POSTGREST; stripped = req.url.slice('/rest/v1'.length); }
  if (target === null) { res.writeHead(404); res.end('unknown path'); return; }
  const upstream = http.request(
    { host: '127.0.0.1', port: target, path: stripped, method: req.method, headers: { ...req.headers, host: '127.0.0.1' } },
    (up) => { res.writeHead(up.statusCode, up.headers); up.pipe(res); },
  );
  upstream.on('error', () => { res.writeHead(502); res.end('upstream unavailable'); });
  req.pipe(upstream);
});
server.listen(Number(process.env.ROUTER_PORT), '127.0.0.1');
`;

function startRouter(pids) {
  const routerFile = path.join(stateDir, 'router.cjs');
  writeFileSync(routerFile, ROUTER_SOURCE);
  pids.router = spawnLogged('router', process.execPath, [routerFile], {
    ROUTER_PORT: String(PORTS.router),
    GOTRUE_PORT: String(PORTS.gotrue),
    POSTGREST_PORT: String(PORTS.postgrest),
    TEMPLATE_PATH: path.join(appRoot, 'supabase', 'templates', 'magic_link.html'),
  });
}

function harnessEnv(secrets) {
  return {
    HIVE_LOCAL_SUPABASE_URL: BASE_URL,
    HIVE_LOCAL_SERVICE_KEY: secrets.serviceKey,
    HIVE_LOCAL_CLIENT_KEY: secrets.anonKey,
    HIVE_LOCAL_MAILPIT_URL: `http://127.0.0.1:${PORTS.mailpitHttp}`,
  };
}

// ------------------------------------------------------------- commands

async function up() {
  mkdirSync(logDir, { recursive: true });
  verifyPins();
  const secrets = loadOrCreateSecrets();
  stop(true);
  startPostgres();
  initDatabase(secrets);
  const pids = {};
  startMailpit(pids);
  startGotrue(pids, secrets);
  applyMigrationsAndSeed();
  startPostgrest(pids, secrets);
  startRouter(pids);
  writePids(pids);
  await waitHttp(`http://127.0.0.1:${PORTS.mailpitHttp}/api/v1/messages`, 'mailpit');
  await waitHttp(`http://127.0.0.1:${PORTS.gotrue}/health`, 'gotrue');
  await waitHttp(`http://127.0.0.1:${PORTS.postgrest}/`, 'postgrest');
  await waitHttp(`${BASE_URL}/auth/v1/health`, 'router->gotrue');
  log(
    `up: ${BASE_URL} (auth+rest), mailpit http://127.0.0.1:${PORTS.mailpitHttp} — binary stack, loopback only`,
  );
}

/** Run a harness script with the stack's env, streaming its output while
 * also capturing it so `run` can parse the pass/fail counts into the
 * evidence record. A nonzero exit becomes OUR exit code, without the
 * unhandled-throw stack noise execFileSync produces. */
function runChild(script, secrets) {
  const result = spawnSyncChild(script, secrets);
  process.stdout.write(result.output);
  if (result.status !== 0) {
    log(`${script} exited ${result.status}`);
    process.exit(result.status ?? 1);
  }
  return result.output;
}

function spawnSyncChild(script, secrets) {
  try {
    const output = execFileSync(process.execPath, [path.join(appRoot, 'scripts', script)], {
      env: { ...process.env, ...harnessEnv(secrets) },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    return { status: 0, output };
  } catch (error) {
    return { status: error.status ?? 1, output: error.stdout ?? '' };
  }
}

/** The run record, alongside the candidate-export evidence: which pinned
 * binaries produced which counts, when. The lane name is in the file so
 * the evidence can never silently pass as CLI-stack evidence. */
function writeEvidence(harnessOutput) {
  const counts = harnessOutput.match(/e2e-local-auth: (\d+) passed, (\d+) failed/);
  const record = {
    lane: 'binary stack — real GoTrue/PostgREST/Mailpit on loopback, NOT the Supabase CLI composition; synthetic data only',
    completedAt: new Date().toISOString(),
    components: PINS,
    postgres: 'system PostgreSQL 16, dedicated cluster (port 55434)',
    router: 'loopback path router (scripts/e2e-binary-stack.mjs), stands where Kong stands',
    keys: 'legacy JWT-shaped, run-local random secret — loopback development only, release-rejected by shape',
    harness:
      'scripts/e2e-local-auth.mjs (unmodified), seed via scripts/seed-local.mjs (unmodified)',
    result: counts
      ? { passed: Number(counts[1]), failed: Number(counts[2]) }
      : { passed: null, failed: null, note: 'counts line not found in harness output' },
  };
  const evidencePath = path.join(appRoot, 'security', 'evidence', 'e2e-binary-stack.json');
  writeFileSync(evidencePath, `${JSON.stringify(record, null, 2)}\n`);
  log(`run record written to ${path.relative(appRoot, evidencePath)}`);
}

function stop(quiet = false) {
  const pids = readPids();
  for (const [name, pid] of Object.entries(pids)) {
    if (alive(pid)) {
      try {
        process.kill(pid);
      } catch {
        /* raced */
      }
      if (!quiet) log(`stopped ${name} (pid ${pid})`);
    }
  }
  // WAIT for them to actually be gone: a back-to-back `run` otherwise
  // races the old mailpit for its SMTP port and the new one dies on
  // bind. SIGTERM first, SIGKILL for anything still alive after 5s.
  const deadline = Date.now() + 5000;
  let stragglers = Object.values(pids).filter(alive);
  while (stragglers.length > 0 && Date.now() < deadline) {
    sh('sleep', ['0.2']);
    stragglers = Object.values(pids).filter(alive);
  }
  for (const pid of stragglers) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* raced */
    }
  }
  // Bounded, never a loop-until-gone: these are OUR detached children,
  // and a killed child stays a ZOMBIE (kill(pid, 0) still succeeds)
  // until reaped, which a detached parent never does. Its sockets are
  // released at death, which is all the next bring-up needs.
  if (stragglers.length > 0) sh('sleep', ['0.5']);
  if (existsSync(pidsPath)) rmSync(pidsPath);
  // Postgres is left running between runs (like db-local); `stop` halts it.
  if (!quiet && existsSync(path.join(pgDir, 'PG_VERSION')) && pgRunning()) {
    shAsPg(path.join(PG_BIN, 'pg_ctl'), ['-D', pgDir, 'stop', '-m', 'fast']);
    log('stopped postgres');
  }
}

const command = process.argv[2];
switch (command) {
  case 'up':
    await up();
    break;
  case 'seed': {
    const secrets = loadOrCreateSecrets();
    runChild('seed-local.mjs', secrets);
    break;
  }
  case 'e2e': {
    const secrets = loadOrCreateSecrets();
    runChild('e2e-local-auth.mjs', secrets);
    break;
  }
  case 'run': {
    await up();
    const secrets = loadOrCreateSecrets();
    try {
      runChild('seed-local.mjs', secrets);
      const harnessOutput = runChild('e2e-local-auth.mjs', secrets);
      writeEvidence(harnessOutput);
      log('RUN COMPLETE — harness exit 0 (binary stack)');
    } finally {
      stop(true);
    }
    break;
  }
  case 'stop':
    stop();
    break;
  default:
    fail('usage: e2e-binary-stack.mjs <run|up|seed|e2e|stop>');
}
