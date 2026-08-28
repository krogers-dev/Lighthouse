/** Config plugin: drop the splash icon reference no drawable backs.
 *
 * The splash configuration is deliberately imageless — the brand rule is
 * a text-only development mark and asset release stays HOLD — but
 * expo-splash-screen's Android plugin writes
 * `windowSplashScreenAnimatedIcon → @drawable/splashscreen_logo` into
 * Theme.App.SplashScreen unconditionally, while the drawable itself is
 * only generated when an `image` is configured. The first real Android
 * resource link (Windows desktop, 2026-08-28) failed exactly there:
 * "resource drawable/splashscreen_logo not found". This plugin runs
 * after expo-splash-screen and removes the dangling item, leaving the
 * background-colour splash the configuration actually describes.
 *
 * Remove this plugin when an approved splash image ships: with an image
 * configured the reference is no longer dangling, and this plugin would
 * silently blank the icon. It throws rather than no-ops when the
 * reference is already absent, so an upstream fix retires it loudly
 * instead of leaving dead code behind.
 *
 * Registration order is load-bearing: config-plugin mods EXECUTE in
 * reverse registration order, so this plugin is FIRST in app.json's
 * plugins array to run after expo-splash-screen's styles mod. Registered
 * after it, this plugin sees the raw template group (whose icon
 * reference spells `android:windowBackground`) and throws — proven by a
 * real prebuild both ways, 2026-08-28.
 */
const { withAndroidStyles } = require('expo/config-plugins');

const SPLASH_GROUP = 'Theme.App.SplashScreen';
const ICON_ITEM = 'windowSplashScreenAnimatedIcon';

function stripDanglingSplashIcon(styles) {
  const groups = styles?.resources?.style;
  if (!Array.isArray(groups)) {
    throw new Error('with-android-imageless-splash: styles.xml has no style groups');
  }
  const group = groups.find((entry) => entry?.$?.name === SPLASH_GROUP);
  if (!group) {
    throw new Error(
      `with-android-imageless-splash: ${SPLASH_GROUP} is missing — upstream expo-splash-screen changed shape; re-inspect before building`,
    );
  }
  const items = Array.isArray(group.item) ? group.item : [];
  const remaining = items.filter((item) => item?.$?.name !== ICON_ITEM);
  if (remaining.length === items.length) {
    throw new Error(
      `with-android-imageless-splash: no ${ICON_ITEM} in ${SPLASH_GROUP} — upstream stopped emitting the dangling reference; delete this plugin`,
    );
  }
  group.item = remaining;
  return styles;
}

module.exports = function withAndroidImagelessSplash(config) {
  return withAndroidStyles(config, (mod) => {
    mod.modResults = stripDanglingSplashIcon(mod.modResults);
    return mod;
  });
};
module.exports.stripDanglingSplashIcon = stripDanglingSplashIcon;
module.exports.SPLASH_GROUP = SPLASH_GROUP;
module.exports.ICON_ITEM = ICON_ITEM;
