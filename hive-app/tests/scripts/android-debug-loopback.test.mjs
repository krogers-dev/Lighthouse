/** The Android debug cleartext narrowing.
 *
 * No Android toolchain exists in the container that runs this suite, so
 * the transform is asserted against the template text directly. The
 * failure directions differ in cost and both are covered: silently doing
 * nothing leaves a blanket cleartext permission in place, and rewriting
 * the manifest wholesale drops the dev-menu permission in a way that
 * looks nothing like this plugin.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const plugin = require(path.join(appRoot, 'plugins/with-android-debug-loopback.js'));

/** The debug manifest exactly as the Expo/React Native template emits it,
 * captured from a real `expo prebuild --platform android` run. */
const TEMPLATE_MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">

    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>

    <application android:usesCleartextTraffic="true" tools:targetApi="28" tools:ignore="GoogleAppIndexingWarning" tools:replace="android:usesCleartextTraffic" />
</manifest>
`;

test('the blanket cleartext permission is replaced by the scoped config', () => {
  const out = plugin.narrowCleartext(TEMPLATE_MANIFEST);
  // The blanket permission is what this plugin exists to remove.
  assert.ok(!out.includes('usesCleartextTraffic'), out);
  assert.ok(out.includes(`android:networkSecurityConfig="@xml/${plugin.RESOURCE_NAME}"`));
  // The merger directive has to follow the attribute it now governs, or
  // the build fails on an attribute that is no longer there.
  assert.ok(out.includes('tools:replace="android:networkSecurityConfig"'));
});

test('everything else in the template manifest survives', () => {
  const out = plugin.narrowCleartext(TEMPLATE_MANIFEST);
  // The React Native dev menu draws an overlay and needs this. An earlier
  // version of the plugin wrote the file wholesale and dropped it.
  assert.ok(out.includes('android.permission.SYSTEM_ALERT_WINDOW'));
  assert.ok(out.includes('tools:targetApi="28"'));
  assert.ok(out.includes('tools:ignore="GoogleAppIndexingWarning"'));
  assert.ok(out.includes('xmlns:tools='));
});

test('NEGATIVE: a template without the blanket permission throws, never no-ops', () => {
  // If upstream stops shipping it, this plugin's premise has changed.
  // Doing nothing quietly would leave someone believing cleartext was
  // narrowed when nothing had run at all.
  const changed = TEMPLATE_MANIFEST.replace('android:usesCleartextTraffic="true" ', '');
  assert.throws(() => plugin.narrowCleartext(changed), /upstream template changed/);
});

test('NEGATIVE: malformed input throws rather than being written back', () => {
  for (const input of ['', '<manifest/>', null, undefined, 42]) {
    assert.throws(() => plugin.narrowCleartext(input), /no <application>/, `input: ${input}`);
  }
});

test('the scoped config denies cleartext by default and excepts only loopback', () => {
  const xml = plugin.NETWORK_SECURITY_CONFIG;
  assert.ok(xml.includes('<base-config cleartextTrafficPermitted="false" />'));
  for (const host of ['10.0.2.2', '127.0.0.1', 'localhost']) {
    assert.ok(xml.includes(`<domain includeSubdomains="false">${host}</domain>`), host);
  }
  // Exactly three exceptions: an added host would be an added exception.
  assert.equal(xml.match(/<domain /g).length, 3);
  // Subdomains are never included: `includeSubdomains` on a bare hostname
  // would widen the exception past the machine it is meant to name.
  assert.ok(!xml.includes('includeSubdomains="true"'));
});

test('every debug-family build type is covered, because source sets do not inherit', () => {
  // debugOptimized is a separate Gradle build type with its own source
  // set. Covering only `debug` would leave it on the blanket permission.
  assert.deepEqual(plugin.DEBUG_SOURCE_SETS, ['debug', 'debugOptimized']);
  assert.ok(!plugin.DEBUG_SOURCE_SETS.includes('release'));
});

// ---- the approved origin that goes with it ----

test('the emulator host is approved for development only', () => {
  const manifest = JSON.parse(
    readFileSync(path.join(appRoot, 'security/approved-config.json'), 'utf8'),
  );
  const { development, candidate, release } = manifest.profiles;
  assert.ok(development.approvedOrigins.includes('http://10.0.2.2:54321'));
  assert.ok(development.approvedOrigins.includes('http://127.0.0.1:54321'));
  // The candidate lane exports and inspects; it never runs on an
  // emulator, so widening it would approve an origin nothing uses.
  assert.ok(!candidate.approvedOrigins.includes('http://10.0.2.2:54321'));
  // Release approves nothing at all and stays HOLD.
  assert.deepEqual(release.approvedOrigins, []);
});

test('app.json registers both android manifest plugins', () => {
  const plugins = JSON.parse(readFileSync(path.join(appRoot, 'app.json'), 'utf8')).expo.plugins;
  assert.ok(plugins.includes('./plugins/with-android-no-backup'));
  assert.ok(plugins.includes('./plugins/with-android-debug-loopback'));
});
