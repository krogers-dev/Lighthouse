#!/usr/bin/env node
/**
 * fetch-e2e-binaries — put the binary stack's pinned components in place.
 *
 * e2e-binary-stack.mjs refuses to start unless .cache/e2e-bin holds
 * exactly the pinned binaries (sha256-verified). This script is the one
 * sanctioned way to produce them on a new machine:
 *
 *  - postgrest and mailpit: downloaded from their pinned GitHub release
 *    assets and verified against the recorded digests before install;
 *  - gotrue: BUILT from the pinned source tag with a local Go toolchain
 *    (supabase/auth ships no static linux binary we can pin the same
 *    way). A locally built binary embeds local paths, so its digest is
 *    machine-specific: the build is verified by tag and commit, and the
 *    resulting digest is written into .cache/e2e-bin/gotrue.sha256 for
 *    e2e-binary-stack to accept alongside the canonical one.
 *
 * Nothing is installed system-wide; everything lands in the gitignored
 * .cache/. Linux x86_64 only, matching the stack itself.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binDir = path.join(appRoot, '.cache', 'e2e-bin');
const workDir = path.join(appRoot, '.cache', 'e2e-bin-fetch');

/** Download pins: exact release asset and the digest of the ARCHIVE, so
 * tampering is caught before anything is extracted or executed. */
const DOWNLOADS = {
  postgrest: {
    url: 'https://github.com/PostgREST/postgrest/releases/download/v13.0.8/postgrest-v13.0.8-linux-static-x86-64.tar.xz',
    archiveSha256: 'eb4471a7b8112a54e103539f2348c4d7f1c5b9b390649700ad62836e9211e279',
    extract: (archive) => run('tar', ['-xJf', archive, '-C', workDir]),
    binary: 'postgrest',
  },
  mailpit: {
    url: 'https://github.com/axllent/mailpit/releases/download/v1.31.0/mailpit-linux-amd64.tar.gz',
    archiveSha256: '076b5ded9a2182842b93e761b9586a1a251445bffe2666f9f22a6dc14470237d',
    extract: (archive) => run('tar', ['-xzf', archive, '-C', workDir]),
    binary: 'mailpit',
  },
};

const GOTRUE = {
  repo: 'https://github.com/supabase/auth',
  tag: 'v2.196.0',
  commit: '0204331ca41a5b49f076b6fa3dc6c0d20b996590',
};

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: 'inherit', ...options });
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`download failed (${response.status}) for ${url}`);
  }
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

async function main() {
  if (os.platform() !== 'linux' || os.arch() !== 'x64') {
    console.error(
      `fetch-e2e-binaries: the binary stack is linux/x64 only; this is ${os.platform()}/${os.arch()}. On Windows, use Docker Desktop and the CLI lane instead.`,
    );
    process.exit(1);
  }
  mkdirSync(binDir, { recursive: true });
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  for (const [name, pin] of Object.entries(DOWNLOADS)) {
    const target = path.join(binDir, name);
    const archive = path.join(workDir, path.basename(pin.url));
    console.log(`fetch-e2e-binaries: downloading ${name} from the pinned release…`);
    await download(pin.url, archive);
    const digest = sha256File(archive);
    if (digest !== pin.archiveSha256) {
      console.error(
        `fetch-e2e-binaries: ${name} archive digest mismatch — expected ${pin.archiveSha256}, got ${digest}. Refusing to extract.`,
      );
      process.exit(1);
    }
    pin.extract(archive);
    const extracted = path.join(workDir, pin.binary);
    writeFileSync(target, readFileSync(extracted));
    chmodSync(target, 0o755);
    console.log(`fetch-e2e-binaries: ${name} installed (${digest.slice(0, 12)}…)`);
  }

  const gotrueTarget = path.join(binDir, 'gotrue');
  if (!existsSync(gotrueTarget)) {
    let goVersion = null;
    try {
      goVersion = execFileSync('go', ['version'], { encoding: 'utf8' }).trim();
    } catch {
      // handled below
    }
    if (!goVersion) {
      console.error(
        `fetch-e2e-binaries: gotrue must be BUILT from the pinned tag and no Go toolchain is on PATH.\n` +
          `Install Go, then re-run — or build manually:\n` +
          `  git clone --depth 1 --branch ${GOTRUE.tag} ${GOTRUE.repo} /tmp/supabase-auth\n` +
          `  (cd /tmp/supabase-auth && go build -o ${gotrueTarget} .)`,
      );
      process.exit(1);
    }
    const srcDir = path.join(workDir, 'supabase-auth');
    console.log(`fetch-e2e-binaries: cloning supabase/auth at ${GOTRUE.tag}…`);
    run('git', ['clone', '--depth', '1', '--branch', GOTRUE.tag, GOTRUE.repo, srcDir]);
    const head = execFileSync('git', ['-C', srcDir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    if (head !== GOTRUE.commit) {
      console.error(
        `fetch-e2e-binaries: tag ${GOTRUE.tag} resolves to ${head}, expected ${GOTRUE.commit} — the tag MOVED upstream. Refusing to build it.`,
      );
      process.exit(1);
    }
    console.log(`fetch-e2e-binaries: building gotrue (${goVersion})…`);
    run('go', ['build', '-o', gotrueTarget, '.'], { cwd: srcDir });
  }
  // A locally built Go binary embeds local paths, so its digest is
  // machine-specific; record it for e2e-binary-stack's pin check.
  writeFileSync(path.join(binDir, 'gotrue.sha256'), `${sha256File(gotrueTarget)}\n`);
  console.log('fetch-e2e-binaries: gotrue in place; local digest recorded');

  rmSync(workDir, { recursive: true, force: true });
  console.log('fetch-e2e-binaries: DONE — run `node scripts/e2e-binary-stack.mjs run`');
}

await main();
