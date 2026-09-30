import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

import {
  DEV_APP_ID,
  DEV_APP_NAME,
  checkAppConfig,
  resolveAppConfig,
} from '../../scripts/candidate-config-check.mjs';

const require = createRequire(import.meta.url);
const variant = require('../../app.config.js');
const appJson = require('../../app.json');

test('the development configuration is app.json unchanged, by default and by name', () => {
  assert.equal(variant.applyVariant(appJson.expo, undefined), appJson.expo);
  assert.equal(variant.applyVariant(appJson.expo, ''), appJson.expo);
  assert.equal(variant.applyVariant(appJson.expo, 'development'), appJson.expo);
  assert.equal(appJson.expo.ios.bundleIdentifier, DEV_APP_ID);
  assert.equal(appJson.expo.name, DEV_APP_NAME);
});

test('the production variant carries the production identifiers, name, scheme, version, and build numbers, and nothing else moves', () => {
  const production = variant.applyVariant(appJson.expo, 'production');
  assert.equal(production.name, 'HIVE');
  assert.equal(production.scheme, 'hive');
  assert.equal(production.version, '1.0.0');
  assert.equal(production.ios.bundleIdentifier, 'com.myhbcfo.hive');
  assert.equal(production.ios.buildNumber, '1');
  assert.equal(production.android.package, 'com.myhbcfo.hive');
  assert.equal(production.android.versionCode, 1);
  // Everything that is not an identifier stays exactly as developed.
  assert.deepEqual(production.plugins, appJson.expo.plugins);
  assert.deepEqual(production.ios.privacyManifests, appJson.expo.ios.privacyManifests);
  assert.equal(production.ios.infoPlist.ITSAppUsesNonExemptEncryption, false);
  assert.deepEqual(production.android.adaptiveIcon, appJson.expo.android.adaptiveIcon);
  assert.equal(production.slug, appJson.expo.slug);
  // The development configuration itself is untouched.
  assert.equal(appJson.expo.name, DEV_APP_NAME);
});

test('an unknown variant is refused, never guessed', () => {
  assert.throws(() => variant.applyVariant(appJson.expo, 'staging'), /APP_VARIANT must be/);
});

test('config:check reads the production variant for the release profile and app.json for development', () => {
  const release = resolveAppConfig('release', appJson, variant);
  assert.equal(release.ios.bundleIdentifier, 'com.myhbcfo.hive');
  assert.deepEqual(
    checkAppConfig(release, 'release').filter((p) =>
      /identifier|display name|production identifiers/.test(p),
    ),
    [],
  );
  const development = resolveAppConfig('development', appJson, variant);
  assert.equal(development, appJson.expo);
  assert.deepEqual(checkAppConfig(development, 'development'), []);
});
