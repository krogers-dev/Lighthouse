/** Config plugin: force android:allowBackup="false".
 *
 * Auth material and the install marker must never ride Android backup
 * (SECURITY.md). expo-build-properties in the SDK 57 line no longer
 * exposes an allowBackup switch, so this sets the manifest attribute
 * directly; scripts/candidate-config-check.mjs asserts the plugin stays
 * registered and the prebuild drill greps the generated manifest.
 */
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withAndroidNoBackup(config) {
  return withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error('with-android-no-backup: AndroidManifest has no <application>');
    }
    application.$['android:allowBackup'] = 'false';
    return mod;
  });
};
