import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEV_APP_ID,
  DEV_APP_NAME,
  checkAppConfig,
  checkEnvValues,
} from '../../scripts/candidate-config-check.mjs';

const devExpo = {
  name: DEV_APP_NAME,
  ios: { bundleIdentifier: DEV_APP_ID },
  android: { package: DEV_APP_ID },
  plugins: [
    'expo-router',
    [
      'expo-build-properties',
      {
        ios: { deploymentTarget: '16.4' },
        android: { compileSdkVersion: 36, targetSdkVersion: 36 },
      },
    ],
    './plugins/with-android-no-backup',
  ],
};

test('development profile accepts the development identifiers', () => {
  assert.deepEqual(checkAppConfig(devExpo, 'development'), []);
});

test('release profile rejects development identifiers', () => {
  const problems = checkAppConfig(devExpo, 'release');
  assert.ok(problems.some((p) => p.includes('development iOS bundle identifier')));
  assert.ok(problems.some((p) => p.includes('development Android application id')));
  assert.ok(problems.some((p) => p.includes('development display name')));
});

test('android API 36, the no-backup plugin, and iOS 16.4 are enforced', () => {
  const stale = {
    ...devExpo,
    plugins: [
      [
        'expo-build-properties',
        {
          ios: { deploymentTarget: '15.1' },
          android: { compileSdkVersion: 35, targetSdkVersion: 35 },
        },
      ],
    ],
  };
  const problems = checkAppConfig(stale, 'development');
  assert.ok(problems.some((p) => p.includes('SDK must be 36')));
  assert.ok(problems.some((p) => p.includes('with-android-no-backup')));
  assert.ok(problems.some((p) => p.includes('16.4')));
});

const encodePayload = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const legacyAnon = `${encodePayload({ alg: 'HS256' })}.${encodePayload({ role: 'anon' })}.sigsigsig`;
const legacyServiceRole = `${encodePayload({ alg: 'HS256' })}.${encodePayload({ role: 'service_role' })}.sigsigsig`;

test('release env rejects loopback, legacy anon keys, and non-publishable keys', () => {
  assert.ok(
    checkEnvValues(
      {
        EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        EXPO_PUBLIC_SUPABASE_CLIENT_KEY: legacyAnon,
      },
      'release',
    ).length >= 2,
  );
  const bad = checkEnvValues(
    {
      EXPO_PUBLIC_SUPABASE_URL: 'https://example-project.supabase.co',
      EXPO_PUBLIC_SUPABASE_CLIENT_KEY: 'not-a-key',
    },
    'release',
  );
  assert.ok(bad.some((p) => p.includes('publishable-key format')));
});

test('release env accepts https + publishable key', () => {
  assert.deepEqual(
    checkEnvValues(
      {
        EXPO_PUBLIC_SUPABASE_URL: 'https://example-project.supabase.co',
        EXPO_PUBLIC_SUPABASE_CLIENT_KEY: 'sb_publishable_syntheticsynthetic',
      },
      'release',
    ),
    [],
  );
});

test('development env accepts loopback + legacy anon key', () => {
  assert.deepEqual(
    checkEnvValues(
      {
        EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        EXPO_PUBLIC_SUPABASE_CLIENT_KEY: legacyAnon,
      },
      'development',
    ),
    [],
  );
});

test('development env rejects a legacy key on a non-loopback URL', () => {
  assert.ok(
    checkEnvValues(
      {
        EXPO_PUBLIC_SUPABASE_URL: 'https://example-project.supabase.co',
        EXPO_PUBLIC_SUPABASE_CLIENT_KEY: legacyAnon,
      },
      'development',
    ).length > 0,
  );
});

test('development env rejects a JWT-form service-role key (review P2-1)', () => {
  const problems = checkEnvValues(
    {
      EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      EXPO_PUBLIC_SUPABASE_CLIENT_KEY: legacyServiceRole,
    },
    'development',
  );
  assert.ok(problems.some((p) => p.includes('service-role')));
});

test('QA hooks are rejected outside the development profile (RETURN-2)', async () => {
  const { checkQaHooks } = await import('../../scripts/candidate-config-check.mjs');
  assert.deepEqual(checkQaHooks({ EXPO_PUBLIC_QA_HOOKS: '1' }, 'development'), []);
  assert.equal(checkQaHooks({ EXPO_PUBLIC_QA_HOOKS: '1' }, 'release').length, 1);
  assert.deepEqual(checkQaHooks({}, 'release'), []);
});
