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

import { countIosSimulators, parseAvdNames } from '../../scripts/preflight-device.mjs';

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
