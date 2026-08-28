#!/usr/bin/env node
/**
 * preflight:device — reports whether THIS machine can run the lanes that
 * no container here can: the local Supabase stack, an iOS or Android
 * development build, and Maestro flows on a device.
 *
 * `verify:toolchain` already pins the JavaScript side. This checks the
 * things it deliberately does not: a Docker daemon that actually answers,
 * a real simulator or emulator, hardware acceleration, the JDK Gradle
 * needs, and Maestro.
 *
 * It NEVER installs anything. Installing developer tooling on someone's
 * machine is their decision, and a script that did it silently would be
 * the wrong shape. This reports; you install.
 *
 * Two categories, deliberately distinct:
 *  - MISS is fixable on this machine and sets the exit code;
 *  - BLOCKED cannot be fixed here at all (iOS off macOS) and does not,
 *    because failing forever on something nobody can install teaches
 *    people to ignore the check. Blocked lanes are still printed, and the
 *    summary names them, so exit 0 never reads as "every lane runs".
 *
 * Exit codes follow the repository contract: 0 nothing missing that this
 * machine could supply, 1 something is missing, 2 the check could not run.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const isWindows = process.platform === 'win32';

/** Run a command and return its trimmed output, or null if it is missing,
 * fails, or hangs. A tool that does not answer is not a tool you have.
 *
 * `shell` on Windows is required, not a convenience: `npx` and `maestro`
 * ship there as `.cmd` wrappers, and CreateProcess cannot execute a batch
 * file directly, so every such probe would report "not installed" on a
 * machine where the tool is present and working. It is safe here because
 * every command and argument in this file is a hardcoded literal — no
 * environment value, argv entry, or file content is ever interpolated. */
function run(command, args, timeoutMs = 20_000) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      shell: isWindows,
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

/** Which device lanes a given platform can run at all.
 *
 * Split out so the Windows and Linux answers are provable from a machine
 * that is neither. The iOS entry is the one that matters: Xcode is
 * macOS-only, so on any other platform the lane is not "missing a tool" —
 * it is unreachable, and no install on that machine changes it. */
export function deviceLanePlan(platform) {
  const mac = platform === 'darwin';
  return {
    ios: mac
      ? { runnable: true }
      : {
          runnable: false,
          reason: `Xcode is macOS-only; this is ${platform}`,
          clears: 'a Mac, a hosted Mac runner, or a cloud build service',
        },
    // Android Studio and the SDK run on macOS, Windows, and Linux alike.
    android: { runnable: true },
    // Docker Desktop covers macOS and Windows; Linux runs the engine
    // directly. Every platform can host the local stack somehow.
    supabaseStack: { runnable: true },
  };
}

/** Read `emulator -accel-check` output.
 *
 * Preferred over probing for /dev/kvm everywhere, because that node does
 * not exist on Windows, where acceleration is WHPX or Hyper-V — a
 * Linux-only check silently skips the question on the one platform where
 * it most often bites. Returns null when the answer is not determinable,
 * which is NOT the same as "unavailable". */
export function parseAccelCheck(output) {
  if (typeof output !== 'string' || output.trim() === '') return null;
  if (/accel:\s*0\b/i.test(output)) return true;
  // Any non-zero accel code is a refusal, and the emulator explains it on
  // the same stream ("is not installed", "is not enabled", "requires").
  if (/accel:\s*\d+\b/i.test(output)) return false;
  return null;
}

/** How Gradle finds a JDK, resolved the way gradlew itself does: an
 * explicit JAVA_HOME wins even when broken — gradlew errors out on an
 * invalid JAVA_HOME rather than falling back to PATH — and only an unset
 * JAVA_HOME defers to `java` on PATH.
 *
 * Exists because the Android section can be fully green — SDK, adb, AVD,
 * acceleration — on a machine where `expo run:android` still dies in its
 * first minute: Android Studio ships a JDK but exports no JAVA_HOME and
 * touches no PATH, so a fresh machine fails exactly there. Observed on
 * the first Windows bring-up, 2026-08-28. */
export function resolveJdk({ javaHome, javaHomeValid, pathJavaVersion }) {
  if (javaHome) {
    return javaHomeValid
      ? { ok: true, detail: `JAVA_HOME=${javaHome}` }
      : {
          ok: false,
          detail: `JAVA_HOME=${javaHome} has no bin/java — gradlew refuses an invalid JAVA_HOME even when java is on PATH`,
        };
  }
  if (typeof pathJavaVersion === 'string' && pathJavaVersion.trim() !== '') {
    return { ok: true, detail: pathJavaVersion.split('\n')[0].trim() };
  }
  return { ok: false, detail: 'JAVA_HOME is not set and no java answers on PATH' };
}

/** The whole check. Guarded below so importing this module for its
 * parsers does not run probes or exit the importing process. */
function main() {
  const platform = os.platform();
  const isLinux = platform === 'linux';
  const plan = deviceLanePlan(platform);

  const findings = [];
  const blocked = [];
  const lines = [];

  /** `remedy` is only ever a tool name or an official vendor page. It
   * never asserts a version, a licence, or that an install will succeed. */
  const record = (name, ok, detail, remedy) => {
    lines.push(`${ok ? 'ok  ' : 'MISS'} ${name}: ${detail}`);
    if (!ok) findings.push({ name, remedy });
  };

  /** A lane this machine cannot run at all. Reported, never a finding. */
  const block = (name, reason, clears) => {
    lines.push(`BLOCKED ${name}: ${reason}`);
    blocked.push({ name, clears });
  };

  // ---------------------------------------------------------------- host

  lines.push(`host: ${platform} ${os.arch()} (${os.release()})`);

  // -------------------------------------------------------------- Docker

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
    isWindows
      ? 'Docker Desktop with the WSL2 backend — https://www.docker.com/products/docker-desktop/'
      : 'Docker Desktop — https://www.docker.com/products/docker-desktop/',
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

  if (plan.ios.runnable) {
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
    block('iOS lane', plan.ios.reason, plan.ios.clears);
  }

  // -------------------------------------------------------------- Android

  const androidHome = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? null;
  record(
    'Android SDK',
    Boolean(androidHome && existsSync(androidHome)),
    androidHome ? `ANDROID_HOME=${androidHome}` : 'ANDROID_HOME / ANDROID_SDK_ROOT is not set',
    'Android Studio — https://developer.android.com/studio (then set ANDROID_HOME)',
  );

  // `--version`, not `-version`: the single-dash form prints to stderr,
  // which run() discards, so a working JDK would read as absent. Every
  // JDK Gradle accepts here understands the double-dash form. The PATH
  // probe is skipped when JAVA_HOME is set because JAVA_HOME decides
  // alone either way.
  const javaHome = process.env.JAVA_HOME ?? null;
  const jdk = resolveJdk({
    javaHome,
    javaHomeValid: Boolean(
      javaHome && existsSync(path.join(javaHome, 'bin', isWindows ? 'java.exe' : 'java')),
    ),
    pathJavaVersion: javaHome ? null : run('java', ['--version']),
  });
  record(
    'JDK (Gradle builds with it)',
    jdk.ok,
    jdk.detail,
    'a JDK — Android Studio bundles one (set JAVA_HOME to its "jbr" folder), or https://adoptium.net',
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

  // An emulator without hardware acceleration either refuses to boot or
  // runs unusably slowly, which presents as a hung test rather than as a
  // missing prerequisite. Worth naming before someone loses an afternoon.
  const accel = parseAccelCheck(run('emulator', ['-accel-check']));
  if (accel !== null) {
    record(
      'Emulator hardware acceleration',
      accel,
      accel ? 'available' : 'unavailable — the emulator cannot boot usably',
      isWindows
        ? 'enable WHPX (Windows Features → Windows Hypervisor Platform), or use a physical device over adb'
        : 'enable virtualisation on the host, or use a physical device over adb',
    );
  } else if (isLinux) {
    // Falls back to the device node, which answers even when the SDK is
    // not installed yet. There is no Windows equivalent to stat.
    const kvm = existsSync('/dev/kvm');
    record(
      'Hardware virtualisation (/dev/kvm)',
      kvm,
      kvm ? 'present' : 'absent — an Android emulator cannot boot usably here',
      'a host with nested virtualisation enabled, or a physical Android device over adb',
    );
  } else {
    // Explicitly unknown, not silently ok: the emulator binary is what
    // answers this, and it is not here yet.
    lines.push('?    Emulator hardware acceleration: needs the emulator binary to determine');
  }

  // ------------------------------------------------------------- Maestro

  const maestro = run('maestro', ['--version']);
  record(
    'Maestro',
    Boolean(maestro),
    maestro ? `v${maestro.replace(/^v/, '')}` : 'not on PATH',
    // Deliberately not asserting HOW to install it on this platform:
    // Maestro's supported install paths differ per OS and change, and
    // naming a wrong one is worse than naming none.
    'Maestro, per its official install instructions for this platform',
  );

  // -------------------------------------------------------------- report

  console.log(lines.join('\n'));

  if (findings.length > 0) {
    console.log(`\npreflight:device: ${findings.length} prerequisite(s) missing`);
    for (const finding of findings) console.log(`  - ${finding.name}: ${finding.remedy}`);
  } else {
    console.log('\npreflight:device OK — nothing missing that this machine could supply.');
  }

  // Printed in BOTH branches: a blocked lane is still a gap in the
  // project's evidence, and exit 0 must never be read as "every lane runs".
  if (blocked.length > 0) {
    console.log(`\nNot runnable on this machine at all (${blocked.length}):`);
    for (const item of blocked) console.log(`  - ${item.name}: needs ${item.clears}`);
  }

  if (findings.length === 0) {
    console.log('\nNext: npm run env:synthetic && node scripts/local-supabase.mjs up');
  }
  console.log('\nNothing was installed. This check reports only.');
  process.exit(findings.length === 0 ? 0 : 1);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) main();
