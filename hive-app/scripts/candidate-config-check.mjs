#!/usr/bin/env node
/**
 * config:check — profile configuration gate.
 *
 * development (default): the identifiers MUST be the development ones
 * (com.myhbcfo.hive.development / "HIVE Dev"), and any configured public
 * env values may use loopback URLs and a legacy anon key.
 *
 * release (candidate): rejects development identifiers, loopback URLs,
 * legacy JWT-shaped anon keys, and anything that is not the current
 * publishable-key format. Production identifiers themselves are a HOLD
 * decision, so a release run also fails until real identifiers exist —
 * which is exactly the intended behavior for Milestone 0.
 *
 * Verifies the pinned platform requirements while it is here: Android
 * compile/target SDK 36, allowBackup=false, iOS deployment target 16.4.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isLoopbackUrl, originMatchesApproved } from './lib/origins.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEV_APP_ID = 'com.myhbcfo.hive.development';
export const DEV_APP_NAME = 'HIVE Dev';

const PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]{10,}$/;
const JWT_SHAPED = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** A JWT-shaped key is a client key only when its payload role is "anon";
 * a legacy service-role key hides its role in the base64 payload
 * (independent review P2-1). */
export function jwtRoleIsAnon(key) {
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload.role === 'anon';
  } catch {
    return false;
  }
}

export function checkAppConfig(expo, profile) {
  const problems = [];
  const iosId = expo?.ios?.bundleIdentifier ?? '';
  const androidId = expo?.android?.package ?? '';
  const name = expo?.name ?? '';
  if (profile === 'release') {
    if (iosId === DEV_APP_ID || iosId.endsWith('.development')) {
      problems.push('release profile carries the development iOS bundle identifier');
    }
    if (androidId === DEV_APP_ID || androidId.endsWith('.development')) {
      problems.push('release profile carries the development Android application id');
    }
    if (name === DEV_APP_NAME) {
      problems.push('release profile carries the development display name');
    }
    if (iosId === '' || androidId === '') {
      problems.push('release profile has no production identifiers (HOLD: Kody decision)');
    }
  } else {
    if (iosId !== DEV_APP_ID) {
      problems.push(`development profile must use ${DEV_APP_ID} for iOS`);
    }
    if (androidId !== DEV_APP_ID) {
      problems.push(`development profile must use ${DEV_APP_ID} for Android`);
    }
    if (name !== DEV_APP_NAME) {
      problems.push(`development profile must use the display name ${DEV_APP_NAME}`);
    }
  }

  const plugins = expo?.plugins ?? [];
  const buildProps = plugins.find((p) => Array.isArray(p) && p[0] === 'expo-build-properties');
  const androidProps = buildProps?.[1]?.android ?? {};
  const iosProps = buildProps?.[1]?.ios ?? {};
  if (androidProps.compileSdkVersion !== 36 || androidProps.targetSdkVersion !== 36) {
    problems.push('Android compile/target SDK must be 36');
  }
  // expo-build-properties (SDK 57 line) has no allowBackup switch; the
  // local manifest plugin carries it and must stay registered.
  if (!plugins.includes('./plugins/with-android-no-backup')) {
    problems.push(
      'the with-android-no-backup plugin must be registered (auth material must not be backed up)',
    );
  }
  if (iosProps.deploymentTarget !== '16.4') {
    problems.push('iOS deployment target must be 16.4');
  }
  return problems;
}

/** The dev-only QA hooks (storage corruption for the quarantine device
 * flow) must never be enabled outside the development profile; the
 * bundle inspector separately proves the hook's marker string is absent
 * from non-development exports (RETURN-2 area 7). */
export function checkQaHooks(env, profile) {
  if (profile !== 'development' && env.EXPO_PUBLIC_QA_HOOKS === '1') {
    return ['non-development profile must not enable QA hooks (EXPO_PUBLIC_QA_HOOKS)'];
  }
  return [];
}

/** RETURN-4 P1-4: URL judgments parse and compare exact origins
 * (isLoopbackUrl / originMatchesApproved) — never string prefixes — and a
 * missing value is a FAILURE in every profile, never a silent pass. When
 * the approved-config manifest is supplied, the configured URL must also
 * be one of that profile's exact approved origins. */
export function checkEnvValues(env, profile, manifest = null) {
  const problems = [];
  const url = env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const key = env.EXPO_PUBLIC_SUPABASE_CLIENT_KEY ?? '';
  if (url === '') {
    problems.push(`${profile} configuration is missing EXPO_PUBLIC_SUPABASE_URL`);
  }
  if (key === '') {
    problems.push(`${profile} configuration is missing EXPO_PUBLIC_SUPABASE_CLIENT_KEY`);
  }
  if (url !== '') {
    if (profile === 'release') {
      if (isLoopbackUrl(url)) problems.push('release configuration uses a loopback URL');
      if (!url.startsWith('https://')) problems.push('release configuration must use https');
    } else if (!(isLoopbackUrl(url) || url.startsWith('https://'))) {
      problems.push('development configuration must be loopback or https');
    }
    if (manifest !== null) {
      const approvedList = manifest?.profiles?.[profile]?.approvedOrigins ?? [];
      if (approvedList.length === 0) {
        problems.push(`profile ${profile} has no approved origins in the manifest (HOLD)`);
      } else if (!approvedList.some((origin) => originMatchesApproved(url, origin))) {
        problems.push(
          `configured URL is not an exact approved origin for profile ${profile} (custom domains require explicit manifest approval)`,
        );
      }
    }
  }
  if (key !== '') {
    if (profile === 'release') {
      if (JWT_SHAPED.test(key)) {
        problems.push('release configuration uses a legacy JWT-shaped anon key (rejected)');
      } else if (!PUBLISHABLE_KEY.test(key)) {
        problems.push('release configuration requires the current publishable-key format');
      }
    } else if (JWT_SHAPED.test(key) && !jwtRoleIsAnon(key)) {
      problems.push(
        'the configured JWT-shaped key is not an anon key (a service-role key must never reach the app)',
      );
    } else if (!(PUBLISHABLE_KEY.test(key) || (JWT_SHAPED.test(key) && isLoopbackUrl(url)))) {
      problems.push(
        'development configuration needs a publishable key, or a legacy anon key with a loopback URL',
      );
    }
  }
  return problems;
}

function loadEnvLocal() {
  try {
    const text = readFileSync(path.join(appRoot, '.env.local'), 'utf8');
    const env = {};
    for (const line of text.split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match) env[match[1]] = match[2];
    }
    return env;
  } catch {
    return {};
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const profile = process.argv.includes('--profile')
    ? process.argv[process.argv.indexOf('--profile') + 1]
    : 'development';
  if (profile !== 'development' && profile !== 'release') {
    console.error('config:check: --profile must be development or release');
    process.exit(1);
  }
  const appJson = JSON.parse(readFileSync(path.join(appRoot, 'app.json'), 'utf8'));
  let manifest;
  try {
    manifest = JSON.parse(
      readFileSync(path.join(appRoot, 'security', 'approved-config.json'), 'utf8'),
    );
  } catch {
    console.error('config:check ENGINE FAILURE: security/approved-config.json is unreadable');
    process.exit(2);
  }
  const envLocal = loadEnvLocal();
  const effectiveEnv = {
    EXPO_PUBLIC_SUPABASE_URL:
      process.env.EXPO_PUBLIC_SUPABASE_URL ?? envLocal.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_CLIENT_KEY:
      process.env.EXPO_PUBLIC_SUPABASE_CLIENT_KEY ?? envLocal.EXPO_PUBLIC_SUPABASE_CLIENT_KEY,
    EXPO_PUBLIC_QA_HOOKS: process.env.EXPO_PUBLIC_QA_HOOKS ?? envLocal.EXPO_PUBLIC_QA_HOOKS,
  };
  const problems = [
    ...checkAppConfig(appJson.expo, profile),
    ...checkEnvValues(effectiveEnv, profile, manifest),
    ...checkQaHooks(effectiveEnv, profile),
  ];
  if (problems.length > 0) {
    for (const p of problems) console.error(`FAIL ${p}`);
    console.error(`config:check FAILED for profile ${profile}`);
    process.exit(1);
  }
  console.log(`config:check OK for profile ${profile}`);
}
