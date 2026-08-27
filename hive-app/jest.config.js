/** Jest configuration. jest-expo supplies the React Native / Expo transform
 * and native-module mocks; tests live beside sources and in tests/. */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts?(x)', '<rootDir>/tests/**/*.test.ts?(x)'],
  // The live-bridge lane needs the local stack up and real network; it
  // runs ONLY via `e2e-binary-stack.mjs bridge` (jest.live.config.js).
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/live/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  clearMocks: true,
  // Native/store behavior is exercised through injected fakes, never through
  // real device APIs, so tests stay deterministic in CI.
};
