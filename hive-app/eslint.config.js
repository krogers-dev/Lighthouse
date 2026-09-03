// ESLint flat config. eslint-config-expo supplies the Expo/React Native
// baseline; the additions below enforce Work Order 001 acceptance rules
// (no `any`, no console output outside the diagnostics interface).
const { defineConfig } = require('eslint/config');
const js = require('@eslint/js');
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
  {
    // Maestro's GraalJS helper scripts. Two layers had let them escape:
    // the dot-folder is invisible to `eslint .` (the lint script names
    // it explicitly now), and no baseline applied even when linted
    // directly — so the first REAL flow execution (Windows desktop,
    // 2026-09-03) crashed on a const reassignment that
    // js/recommended's no-const-assign flags statically. Their injected
    // globals are declared per-file with /* global */ comments.
    files: ['.maestro/**/*.js'],
    languageOptions: {
      sourceType: 'script',
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },
]);
