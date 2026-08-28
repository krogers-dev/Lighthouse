/** preflight:device parsers.
 *
 * These exist because the machine that runs this suite is not the machine
 * the parsers describe: there is no macOS and no Android SDK in CI or in
 * the build container, so the only way the simctl and emulator parsing is
 * ever exercised is against recorded output. Both failure modes below
 * report a lane as READY when it cannot run, which is the direction that
 * costs someone a wasted afternoon.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  countIosSimulators,
  deviceLanePlan,
  parseAccelCheck,
  parseAvdNames,
  parseJavaMajor,
  resolveJdk,
} from '../../scripts/preflight-device.mjs';

/** Trimmed but structurally faithful `xcrun simctl list devices available
 * --json`: two iOS devices, plus a watchOS and a tvOS device that a
 * line-wise match would have counted as iOS simulators. */
const SIMCTL_JSON = JSON.stringify({
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [
      { name: 'iPhone 15', udid: 'A1', isAvailable: true, state: 'Shutdown' },
      { name: 'iPhone 15 Pro', udid: 'A2', isAvailable: true, state: 'Booted' },
    ],
    'com.apple.CoreSimulator.SimRuntime.watchOS-10-0': [
      { name: 'Apple Watch Series 9 (45mm)', udid: 'B1', isAvailable: true, state: 'Shutdown' },
    ],
    'com.apple.CoreSimulator.SimRuntime.tvOS-17-0': [
      { name: 'Apple TV', udid: 'C1', isAvailable: true, state: 'Shutdown' },
    ],
  },
});

test('counts only iOS simulators, never a watch or a TV', () => {
  assert.equal(countIosSimulators(SIMCTL_JSON), 2);
});

test('a device that is present but unavailable does not count', () => {
  const json = JSON.stringify({
    devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [
        { name: 'iPhone 15', udid: 'A1', isAvailable: false, state: 'Shutdown' },
      ],
    },
  });
  assert.equal(countIosSimulators(json), 0);
});

test('a runtime that merely mentions iOS in a device name is not an iOS runtime', () => {
  const json = JSON.stringify({
    devices: {
      'com.apple.CoreSimulator.SimRuntime.watchOS-10-0': [
        { name: 'Watch paired with iOS-17', udid: 'B1', isAvailable: true },
      ],
    },
  });
  assert.equal(countIosSimulators(json), 0);
});

test('NEGATIVE: unusable simctl output reports zero, never a false ready', () => {
  // Each of these is something the command really can produce: a machine
  // without Xcode, a command that failed (run() returns null), a partial
  // write, or a shape change. None may be read as "a simulator exists".
  for (const input of [
    '',
    '   ',
    'xcrun: error: unable to find utility',
    '{"devices":',
    null,
    undefined,
    '{}',
    '{"devices":null}',
  ]) {
    assert.equal(countIosSimulators(input), 0, `input: ${String(input)}`);
  }
});

test('reads AVD names, one per line', () => {
  assert.deepEqual(parseAvdNames('Pixel_7_API_34\nPixel_Tablet_API_34\n'), [
    'Pixel_7_API_34',
    'Pixel_Tablet_API_34',
  ]);
});

test('drops the advisory lines the emulator prints onto the same stream', () => {
  // Real output when a snapshot is stale: the notice precedes the names.
  const output = ['INFO    | Storing crashdata in: /tmp/avd/emu-crash.db', 'Pixel_7_API_34'].join(
    '\n',
  );
  assert.deepEqual(parseAvdNames(output), ['Pixel_7_API_34']);
});

test('NEGATIVE: no AVDs and no output both read as none', () => {
  for (const input of ['', '\n\n', null, undefined]) {
    assert.deepEqual(parseAvdNames(input), [], `input: ${String(input)}`);
  }
});

test('importing the module runs no probes and does not exit', () => {
  // The guard matters: without it, importing for the parsers would shell
  // out to docker/xcrun/adb and then call process.exit on the test run.
  assert.equal(typeof countIosSimulators, 'function');
  assert.equal(typeof parseAvdNames, 'function');
});

// ---- which lanes a platform can run at all ----
// The reason these are unit tests rather than an observation: the machine
// running this suite is Linux, so the macOS and Windows answers are never
// exercised by simply running the script. Getting `ios.runnable` wrong on
// Windows would print an Xcode line on a machine that cannot have Xcode.

test('iOS is runnable on macOS and unreachable everywhere else', () => {
  assert.equal(deviceLanePlan('darwin').ios.runnable, true);
  for (const platform of ['win32', 'linux', 'freebsd']) {
    const ios = deviceLanePlan(platform).ios;
    assert.equal(ios.runnable, false, platform);
    // The distinction that matters: unreachable, not "install something".
    assert.match(ios.reason, /macOS-only/);
    assert.match(ios.clears, /Mac/);
  }
});

test('Android and the local stack are runnable on every platform', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    assert.equal(deviceLanePlan(platform).android.runnable, true, platform);
    assert.equal(deviceLanePlan(platform).supabaseStack.runnable, true, platform);
  }
});

// ---- emulator acceleration ----

test('accel-check reads code 0 as available and any other code as not', () => {
  // The real output puts the code on its own line under `accel:`, which
  // is why the pattern spans whitespace rather than expecting `accel: 0`.
  const windowsOk = 'accel:\n0\nWHPX (10.0.22631) is installed and usable.\naccel\n';
  const linuxOk = 'accel:\n0\nKVM (version 12) is installed and usable.\naccel\n';
  const windowsOff = 'accel:\n1\nWHPX is not installed on this machine\naccel\n';
  const noVirt = 'accel:\n3\nKVM requires a CPU that supports vmx or svm\naccel\n';
  assert.equal(parseAccelCheck(windowsOk), true);
  assert.equal(parseAccelCheck(linuxOk), true);
  assert.equal(parseAccelCheck(windowsOff), false);
  assert.equal(parseAccelCheck(noVirt), false);
  // The single-line form is accepted too, so a format change in either
  // direction does not turn an "off" answer into an unknown one.
  assert.equal(parseAccelCheck('accel: 0'), true);
  assert.equal(parseAccelCheck('accel: 1'), false);
});

test('NEGATIVE: a multi-digit refusal code reads as unavailable', () => {
  // Pins the outcome, not a mechanism: reporting acceleration on a
  // machine that refused it is the expensive direction of this check.
  // (Mutation-tested: dropping the pattern's \b does NOT break this —
  // requiring 0 immediately after the whitespace is what excludes 10.
  // The \b is defensive, and this test does not prove it.)
  assert.equal(parseAccelCheck('accel:\n10\nsomething refused it\naccel\n'), false);
  assert.equal(parseAccelCheck('accel:\n2\nHAXM is not installed\naccel\n'), false);
});

test('NEGATIVE: an undeterminable accel answer is null, never a silent true', () => {
  // null must stay distinct from false: false says "acceleration is off",
  // null says "nobody asked the emulator yet". Collapsing them would
  // either invent a failure or hide a real one.
  for (const input of ['', '   ', 'emulator: command not found', null, undefined, 'accel: yes']) {
    assert.equal(parseAccelCheck(input), null, `input: ${String(input)}`);
  }
  assert.notEqual(parseAccelCheck('accel: 1'), null);
});

// ---- the JDK Gradle builds with ----
// Both halves of this check were found the expensive way on the first
// Windows bring-up (2026-08-28). Presence: every Android line was green
// — SDK, adb, AVD, WHPX — and `expo run:android` would still have died
// in its first minute, because Android Studio ships a JDK without
// exporting JAVA_HOME or touching PATH. Version: once JAVA_HOME pointed
// at that bundled JBR, the build ran EIGHTEEN MINUTES and then failed
// its configureCMake tasks with JEP-472 restricted-method errors — the
// JBR was newer than the Android Gradle Plugin supports. The probe
// mirrors gradlew's own resolution order; these tests pin the order and
// the version boundary.

test('a valid 17–21 JAVA_HOME answers, naming the path and the version', () => {
  const jdk = resolveJdk({
    javaHome: 'C:\\jdk-21',
    javaHomeValid: true,
    javaHomeVersionOutput: 'openjdk 21.0.5 2024-10-15 LTS\nOpenJDK Runtime Environment\n',
    pathJavaVersion: null,
  });
  assert.equal(jdk.ok, true);
  assert.equal(jdk.detail, 'JAVA_HOME=C:\\jdk-21 (openjdk 21.0.5 2024-10-15 LTS)');
});

test("NEGATIVE: a JAVA_HOME past the supported range is a miss — the desktop's exact failure", () => {
  const jdk = resolveJdk({
    javaHome: 'C:\\Program Files\\Android\\Android Studio\\jbr',
    javaHomeValid: true,
    javaHomeVersionOutput: 'openjdk 25 2025-09-16\nOpenJDK Runtime Environment JBR\n',
    pathJavaVersion: null,
  });
  assert.equal(jdk.ok, false);
  assert.match(jdk.detail, /JDK 25 is too new/);
  assert.match(jdk.detail, /17–21/);
});

test('NEGATIVE: a JDK below 17 is a miss', () => {
  const jdk = resolveJdk({
    javaHome: '/opt/jdk8',
    javaHomeValid: true,
    javaHomeVersionOutput: 'openjdk 11.0.2 2019-01-15',
    pathJavaVersion: null,
  });
  assert.equal(jdk.ok, false);
  assert.match(jdk.detail, /below React Native's minimum/);
});

test('NEGATIVE: a broken JAVA_HOME fails even when java is on PATH', () => {
  // gradlew errors out on an invalid JAVA_HOME instead of falling back,
  // so reporting ok from the PATH java here would be a false ready.
  const jdk = resolveJdk({
    javaHome: '/uninstalled/jdk',
    javaHomeValid: false,
    javaHomeVersionOutput: null,
    pathJavaVersion: 'openjdk 21.0.5 2024-10-15 LTS',
  });
  assert.equal(jdk.ok, false);
  assert.match(jdk.detail, /JAVA_HOME=\/uninstalled\/jdk/);
});

test("NEGATIVE: a JAVA_HOME whose java won't answer --version is a miss, not a silent ok", () => {
  for (const javaHomeVersionOutput of [null, '', '   ']) {
    const jdk = resolveJdk({
      javaHome: '/broken/jdk',
      javaHomeValid: true,
      javaHomeVersionOutput,
      pathJavaVersion: null,
    });
    assert.equal(jdk.ok, false, `output: ${String(javaHomeVersionOutput)}`);
    assert.match(jdk.detail, /did not answer --version/);
  }
});

test('no JAVA_HOME defers to java on PATH, with the same version boundary', () => {
  const ok = resolveJdk({
    javaHome: null,
    javaHomeValid: false,
    javaHomeVersionOutput: null,
    pathJavaVersion: 'openjdk 17.0.11 2024-04-16\nOpenJDK Runtime Environment Temurin-17\n',
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.detail, 'openjdk 17.0.11 2024-04-16');

  const tooNew = resolveJdk({
    javaHome: null,
    javaHomeValid: false,
    javaHomeVersionOutput: null,
    pathJavaVersion: 'openjdk 24.0.1 2025-04-15',
  });
  assert.equal(tooNew.ok, false);
  assert.match(tooNew.detail, /too new/);
});

test('an unreadable version string reports what it saw rather than inventing a verdict', () => {
  // A vendor string the parser cannot read is not evidence of a bad JDK;
  // failing there would block a working machine on a formatting change.
  const jdk = resolveJdk({
    javaHome: '/opt/some-jdk',
    javaHomeValid: true,
    javaHomeVersionOutput: 'Vendor Custom JDK build 9999',
    pathJavaVersion: null,
  });
  assert.equal(jdk.ok, true);
  assert.match(jdk.detail, /Vendor Custom JDK build 9999/);
});

test('NEGATIVE: neither JAVA_HOME nor a PATH java is a miss, never a silent ok', () => {
  // run() returns null for a missing command; '' guards a probe that ran
  // and printed nothing. Both must read as absent.
  for (const pathJavaVersion of [null, undefined, '', '   ']) {
    const jdk = resolveJdk({
      javaHome: null,
      javaHomeValid: false,
      javaHomeVersionOutput: null,
      pathJavaVersion,
    });
    assert.equal(jdk.ok, false, `pathJavaVersion: ${String(pathJavaVersion)}`);
    assert.match(jdk.detail, /JAVA_HOME is not set/);
  }
});

test('parseJavaMajor reads the shapes java --version really prints', () => {
  assert.equal(parseJavaMajor('openjdk 21.0.5 2024-10-15 LTS'), 21);
  assert.equal(parseJavaMajor('openjdk 25 2025-09-16'), 25);
  assert.equal(parseJavaMajor('java 24.0.1 2025-04-15'), 24);
  assert.equal(parseJavaMajor('openjdk version "17.0.11" 2024-04-16'), 17);
});

test('NEGATIVE: parseJavaMajor yields null for unreadable output, never a guess', () => {
  for (const input of [null, undefined, '', 'no digits here', 'Vendor Custom JDK build']) {
    assert.equal(parseJavaMajor(input), null, `input: ${String(input)}`);
  }
});
