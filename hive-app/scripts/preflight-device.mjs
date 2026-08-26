#!/usr/bin/env node
/**
 * preflight:device — reports whether THIS machine can run the lanes that
 * no container here can: the local Supabase stack, an iOS or Android
 * development build, and Maestro flows on a device.
 *
 * `verify:toolchain` already pins the JavaScript side. This checks the
 * things it deliberately does not: a Docker daemon that actually answers,
 * a real simulator or emulator, and the Maestro binary.
 *
 * It NEVER installs anything. Installing developer tooling on someone's
 * machine is their decision, and a script that did it silently would be
 * the wrong shape. This reports; you install.
 *
 * Exit codes follow the repository contract: 0 every lane is runnable,
 * 1 something is missing, 2 the check itself could not run.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import process from 'node:process';

/** Run a command and return its trimmed output, or null if it is missing,
 * fails, or hangs. A tool that does not answer is not a tool you have. */
function run(command, args, timeoutMs = 20_000) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
    }).trim();
  } catch {
    return null;
  }
}

/** Count the bootable iOS simulators in `xcrun simctl list --json` output.
 *
 * Parsed from JSON rather than the tabular form: the table interleaves
 * watchOS and tvOS devices under their own runtime headings, so a
 * line-wise match counts an Apple Watch as an iOS simulator and reports a
 * lane as ready when it cannot run. Runtime keys look like
 * `com.apple.CoreSimulator.SimRuntime.iOS-17-0`. */
export function countIosSimulators(json) {
  if (typeof json !== 'string' || json.trim() === '') return 0;
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return 0;
  }
  const byRuntime = parsed?.devices;
  if (!byRuntime || typeof byRuntime !== 'object') return 0;
  let count = 0;
  for (const [runtime, devices] of Object.entries(byRuntime)) {
    // `.iOS-` anchors on the runtime segment, so a device named "iOS" on
    // a watchOS runtime cannot be miscounted.
    if (!/\.SimRuntime\.iOS-/.test(runtime)) continue;
    if (!Array.isArray(devices)) continue;
    // `--available` already filters unusable runtimes; isAvailable is
    // still checked because a device can be present and unusable.
    count += devices.filter((device) => device?.isAvailable !== false).length;
  }
  return count;
}

/** Named AVDs from `emulator -list-avds`. The command prints one name per
 * line and prints nothing at all when none are defined. */
export function parseAvdNames(output) {
  if (typeof output !== 'string') return [];
  return (
    output
      .split('\n')
      .map((line) => line.trim())
      // The emulator prepends advisory lines (a missing snapshot, a stale
      // lock) to the same stream; a real AVD name has no spaces.
      .filter((line) => line !== '' && !line.includes(' '))
  );
}

/** The whole check. Guarded below so importing this module for its
 * parsers does not run probes or exit the importing process. */
function main() {
  const platform = os.platform();
  const isMac = platform === 'darwin';
  const isLinux = platform === 'linux';

  const findings = [];
  const lines = [];

  /** `remedy` is only ever a tool name or an official vendor page. It
   * never asserts a version, a licence, or that an install will succeed. */
  const record = (name, ok, detail, remedy) => {
    lines.push(`${ok ? 'ok  ' : 'MISS'} ${name}: ${detail}`);
    if (!ok) findings.push({ name, remedy });
  };

  // ---------------------------------------------------------------- host

  lines.push(`host: ${platform} ${os.arch()} (${os.release()})`);

  // ---------------------------------------------------------- Docker

  const dockerClient = run('docker', ['--version']);
  // The trap this check exists for: the client can be installed and the
  // socket file can exist while nothing is listening on it. `docker info`
  // is the only answer that means the daemon is actually up.
  const dockerDaemon = dockerClient
    ? run('docker', ['info', '--format', '{{.ServerVersion}}'])
    : null;
  record(
    'Docker daemon',
    Boolean(dockerDaemon),
    dockerDaemon
      ? `server ${dockerDaemon}`
      : dockerClient
        ? `client present (${dockerClient.replace(/^Docker version /, '')}) but no daemon is answering`
        : 'not installed',
    'Docker Desktop — https://www.docker.com/products/docker-desktop/',
  );

  // The Supabase CLI drives the local stack; it is pinned by
  // verify:toolchain, so this only confirms it is callable here.
  const supabase = run('npx', ['--no-install', 'supabase', '--version']);
  record(
    'Supabase CLI',
    Boolean(supabase),
    supabase ? `v${supabase.replace(/^v/, '')}` : 'not callable — run npm ci first',
    'npm ci (the CLI is a pinned dev dependency)',
  );

  // ------------------------------------------------------------------ iOS

  if (isMac) {
    const xcode = run('xcodebuild', ['-version']);
    record(
      'Xcode',
      Boolean(xcode),
      xcode ? xcode.split('\n')[0] : 'not installed, or command line tools are not selected',
      'Xcode from the Mac App Store, then: sudo xcode-select --switch /Applications/Xcode.app',
    );

    const simulators = run('xcrun', ['simctl', 'list', 'devices', 'available', '--json']);
    const iosDevices = countIosSimulators(simulators);
    record(
      'iOS simulator',
      iosDevices > 0,
      iosDevices > 0 ? `${iosDevices} available` : 'none available',
      'Xcode → Settings → Platforms → install an iOS runtime',
    );
  } else {
    // Not a finding: it is a fact about the machine, not a missing install.
    lines.push(`n/a  iOS lane: needs macOS; this is ${platform}`);
  }

  // -------------------------------------------------------------- Android

  const androidHome = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? null;
  record(
    'Android SDK',
    Boolean(androidHome && existsSync(androidHome)),
    androidHome ? `ANDROID_HOME=${androidHome}` : 'ANDROID_HOME / ANDROID_SDK_ROOT is not set',
    'Android Studio — https://developer.android.com/studio (then set ANDROID_HOME)',
  );

  const adb = run('adb', ['version']);
  record(
    'adb',
    Boolean(adb),
    adb ? adb.split('\n')[0] : 'not on PATH',
    'Android Studio → SDK Manager → Android SDK Platform-Tools',
  );

  const avds = run('emulator', ['-list-avds']);
  const avdNames = parseAvdNames(avds);
  record(
    'Android emulator image',
    avdNames.length > 0,
    avdNames.length > 0 ? `${avdNames.length} AVD(s): ${avdNames.join(', ')}` : 'no AVD defined',
    'Android Studio → Device Manager → create a virtual device',
  );

  // An x86 emulator without hardware virtualisation either refuses to boot
  // or runs unusably slowly, which reads as a hung test rather than a
  // missing prerequisite. Worth naming before someone loses an afternoon.
  if (isLinux) {
    const kvm = existsSync('/dev/kvm');
    record(
      'Hardware virtualisation (/dev/kvm)',
      kvm,
      kvm ? 'present' : 'absent — an Android emulator cannot boot usably here',
      'a host with nested virtualisation enabled, or a physical Android device over adb',
    );
  }

  // ------------------------------------------------------------- Maestro

  const maestro = run('maestro', ['--version']);
  record(
    'Maestro',
    Boolean(maestro),
    maestro ? `v${maestro.replace(/^v/, '')}` : 'not on PATH',
    'Maestro, per its official install instructions',
  );

  // -------------------------------------------------------------- report

  console.log(lines.join('\n'));

  if (findings.length === 0) {
    console.log(
      '\npreflight:device OK — every device-lane prerequisite is present on this machine.',
    );
    console.log('Next: npm ci && npm run env:synthetic && node scripts/local-supabase.mjs up');
    process.exit(0);
  }

  console.log(`\npreflight:device: ${findings.length} prerequisite(s) missing`);
  for (const finding of findings) console.log(`  - ${finding.name}: ${finding.remedy}`);
  console.log(
    '\nNothing was installed. This check reports only — what goes on your machine is your call.',
  );
  process.exit(1);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) main();
