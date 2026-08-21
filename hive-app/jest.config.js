/** Jest configuration. jest-expo supplies the React Native / Expo transform
 * and native-module mocks; tests live beside sources and in tests/. */
module.exports = {
  preset: 'jest-expo',
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.test.ts?(x)',
    '<rootDir>/tests/**/*.test.ts?(x)',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  clearMocks: true,
  // Native/store behavior is exercised through injected fakes, never through
  // real device APIs, so tests stay deterministic in CI.
};
