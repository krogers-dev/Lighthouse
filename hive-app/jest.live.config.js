/** The live-bridge lane's jest project.
 *
 * Separate from jest.config.js on purpose: `npm test` must stay
 * deterministic and offline, and this lane is neither — it drives the
 * app's real composition against the live local stack over real HTTP.
 * Only `e2e-binary-stack.mjs bridge` invokes it, with the stack up and
 * the loopback environment injected.
 */
const expoPreset = require('jest-expo/jest-preset');

module.exports = {
  ...expoPreset,
  testMatch: ['<rootDir>/tests/live/**/*.test.ts?(x)'],
  moduleNameMapper: {
    ...(expoPreset.moduleNameMapper ?? {}),
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // The lane reuses scripts/lib/totp.mjs (the reviewed TOTP math) rather
  // than duplicating it. The preset's transform does not cover .mjs, and
  // a BARE 'babel-jest' entry would transform nothing (this repo has no
  // root babel config — the preset carries its own options), so .mjs
  // gets the exact same configured entry the preset uses for [jt]sx.
  transform: {
    ...(expoPreset.transform ?? {}),
    '\\.mjs$': expoPreset.transform['\\.[jt]sx?$'],
  },
  moduleFileExtensions: [...(expoPreset.moduleFileExtensions ?? ['js', 'ts', 'tsx']), 'mjs'],
  // Node's real fetch, captured before Expo's winter polyfill loads and
  // restored after: the polyfill's jest path cannot reach a network.
  setupFiles: [
    '<rootDir>/tests/live/capture-node-fetch.js',
    ...(expoPreset.setupFiles ?? []),
    '<rootDir>/tests/live/restore-node-fetch.js',
  ],
  // Serial: the journeys share one Mailpit and one auth backend; parallel
  // sign-ins would race each other's snapshot windows.
  maxWorkers: 1,
  // Real network needs real time; fake timers would deadlock the polls.
  fakeTimers: { enableGlobally: false },
};
