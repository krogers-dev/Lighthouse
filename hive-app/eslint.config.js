// ESLint flat config. eslint-config-expo supplies the Expo/React Native
// baseline; the additions below enforce Work Order 001 acceptance rules
// (no `any`, no console output outside the diagnostics interface).
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.expo/**',
      'coverage/**',
      'supabase/.temp/**',
      'expo-env.d.ts',
    ],
  },
  ...expoConfig,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'tests/scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
]);
