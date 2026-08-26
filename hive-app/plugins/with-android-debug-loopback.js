/** Config plugin: narrow Android's debug cleartext exception to loopback.
 *
 * This is a HARDENING, and the reason is easy to get backwards.
 *
 * The Expo/React Native template already ships a debug source-set
 * manifest containing:
 *
 *     <application android:usesCleartextTraffic="true"
 *                  tools:replace="android:usesCleartextTraffic" />
 *
 * That permits plaintext HTTP to EVERY host in a debug build — not just
 * the local stack. SECURITY.md requires Android cleartext denial to be
 * preserved, and a blanket permission is the opposite of that, so this
 * plugin swaps it for a network security config that denies cleartext by
 * default and excepts only the three loopback names the local Supabase
 * stack can be reached by.
 *
 * The reason the exception is needed at all: on an Android emulator
 * `127.0.0.1` is the EMULATOR, not the host; the host's loopback is
 * `10.0.2.2` from inside it. The local stack is plain HTTP either way.
 *
 * Scope. Only debug-family source sets are touched, so a RELEASE build
 * carries no cleartext exception of any kind — not a narrower one, none.
 * The main manifest is deliberately left alone, which is what makes that
 * true.
 *
 * The generated `android/` directory is gitignored (CNG), so this runs at
 * prebuild time rather than being committed.
 */
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

/** Named distinctly so it cannot collide with a resource the main source
 * set might add later; a duplicate name would merge unpredictably. */
const RESOURCE_NAME = 'hive_debug_network_security_config';

/** Every debug-family build type React Native 0.86 generates. These are
 * separate Gradle build types and source sets do NOT inherit, so
 * `debugOptimized` needs its own copy or it silently keeps the blanket
 * permission this plugin exists to remove. */
const DEBUG_SOURCE_SETS = ['debug', 'debugOptimized'];

const NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<!--
  Written by plugins/with-android-debug-loopback.js. Debug builds only.
  Replaces the template's blanket usesCleartextTraffic="true": cleartext
  is denied for every host except the local development stack, which is
  plain HTTP on loopback by construction. 10.0.2.2 is the emulator's
  alias for the host's loopback, not a routable address.
-->
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">10.0.2.2</domain>
    <domain includeSubdomains="false">127.0.0.1</domain>
    <domain includeSubdomains="false">localhost</domain>
  </domain-config>
</network-security-config>
`;

const BLANKET_ATTRIBUTE = 'android:usesCleartextTraffic="true"';
const BLANKET_TOOLS_REPLACE = 'tools:replace="android:usesCleartextTraffic"';

/** Swap the blanket attribute for the scoped config, preserving every
 * other thing in the manifest — notably the SYSTEM_ALERT_WINDOW
 * permission the React Native dev menu needs. Rewriting the file wholesale
 * would drop it, and the dev overlay would stop working for reasons that
 * look nothing like this plugin.
 *
 * Exported so the transform is testable without an Android toolchain. */
function narrowCleartext(manifestXml) {
  if (typeof manifestXml !== 'string' || !manifestXml.includes('<application')) {
    throw new Error('with-android-debug-loopback: debug manifest has no <application>');
  }
  if (!manifestXml.includes(BLANKET_ATTRIBUTE)) {
    // Fail loudly rather than silently doing nothing. If the template
    // stopped shipping the blanket permission, this plugin's premise
    // changed and a person should re-read it before it keeps running.
    throw new Error(
      `with-android-debug-loopback: expected the template's ${BLANKET_ATTRIBUTE} in the debug manifest and did not find it — the upstream template changed, so re-review this plugin instead of assuming it is still needed`,
    );
  }
  return manifestXml
    .replace(BLANKET_ATTRIBUTE, `android:networkSecurityConfig="@xml/${RESOURCE_NAME}"`)
    .replace(BLANKET_TOOLS_REPLACE, 'tools:replace="android:networkSecurityConfig"');
}

module.exports = function withAndroidDebugLoopback(config) {
  return withDangerousMod(config, [
    'android',
    async (mod) => {
      const projectRoot = mod.modRequest.platformProjectRoot;
      let patched = 0;

      for (const sourceSet of DEBUG_SOURCE_SETS) {
        const root = path.join(projectRoot, 'app', 'src', sourceSet);
        const manifestPath = path.join(root, 'AndroidManifest.xml');
        if (!fs.existsSync(manifestPath)) continue;

        fs.writeFileSync(
          manifestPath,
          narrowCleartext(fs.readFileSync(manifestPath, 'utf8')),
          'utf8',
        );

        const xmlDir = path.join(root, 'res', 'xml');
        fs.mkdirSync(xmlDir, { recursive: true });
        fs.writeFileSync(
          path.join(xmlDir, `${RESOURCE_NAME}.xml`),
          NETWORK_SECURITY_CONFIG,
          'utf8',
        );
        patched += 1;
      }

      if (patched === 0) {
        throw new Error(
          'with-android-debug-loopback: found no debug source-set manifest to narrow — the blanket cleartext permission may still be in effect',
        );
      }
      return mod;
    },
  ]);
};

// Exported for the gate tests: no Android toolchain exists in the
// container that runs them, so the transform is asserted directly.
module.exports.RESOURCE_NAME = RESOURCE_NAME;
module.exports.DEBUG_SOURCE_SETS = DEBUG_SOURCE_SETS;
module.exports.NETWORK_SECURITY_CONFIG = NETWORK_SECURITY_CONFIG;
module.exports.narrowCleartext = narrowCleartext;
