/** The dangling splash-icon removal.
 *
 * No Android toolchain exists in the container that runs this suite, so
 * the transform is asserted against the styles AST exactly as
 * expo-splash-screen's withAndroidSplashStyles emits it. Both failure
 * directions cost differently and both are covered: silently doing
 * nothing leaves `@drawable/splashscreen_logo` dangling and the first
 * real resource link fails (the Windows desktop paid that with a
 * 7m50s build, 2026-08-28), and over-removing strips the background or
 * post-splash theme and changes what a person sees at launch.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const plugin = require(path.join(appRoot, 'plugins/with-android-imageless-splash.js'));

/** Theme.App.SplashScreen exactly as expo-splash-screen 57.0.7 writes it
 * (withAndroidSplashStyles.js, addSplashScreenStyle) for an imageless
 * configuration, alongside a sibling group that must not be touched. */
function templateStyles() {
  return {
    resources: {
      style: [
        {
          $: { name: 'AppTheme', parent: 'Theme.EdgeToEdge' },
          item: [{ $: { name: 'android:windowBackground' }, _: '@color/activityBackground' }],
        },
        {
          $: { name: 'Theme.App.SplashScreen', parent: 'Theme.SplashScreen' },
          item: [
            { $: { name: 'windowSplashScreenBackground' }, _: '@color/splashscreen_background' },
            { $: { name: 'windowSplashScreenAnimatedIcon' }, _: '@drawable/splashscreen_logo' },
            { $: { name: 'postSplashScreenTheme' }, _: '@style/AppTheme' },
            { $: { name: 'android:windowSplashScreenBehavior' }, _: 'icon_preferred' },
          ],
        },
      ],
    },
  };
}

test('removes exactly the dangling icon item and nothing else', () => {
  const out = plugin.stripDanglingSplashIcon(templateStyles());
  const splash = out.resources.style.find((group) => group.$.name === plugin.SPLASH_GROUP);
  const names = splash.item.map((item) => item.$.name);
  assert.deepEqual(names, [
    'windowSplashScreenBackground',
    'postSplashScreenTheme',
    'android:windowSplashScreenBehavior',
  ]);
  // The one reference aapt2 failed on is gone from the whole document.
  assert.ok(!JSON.stringify(out).includes('splashscreen_logo'));
});

test('sibling style groups pass through untouched', () => {
  const out = plugin.stripDanglingSplashIcon(templateStyles());
  const appTheme = out.resources.style.find((group) => group.$.name === 'AppTheme');
  assert.deepEqual(appTheme, templateStyles().resources.style[0]);
});

test('NEGATIVE: a missing splash group throws instead of silently building a broken theme', () => {
  const styles = templateStyles();
  styles.resources.style = styles.resources.style.filter(
    (group) => group.$.name !== plugin.SPLASH_GROUP,
  );
  assert.throws(
    () => plugin.stripDanglingSplashIcon(styles),
    /Theme\.App\.SplashScreen is missing/,
  );
});

test('NEGATIVE: an already-absent icon item throws so an upstream fix retires this plugin loudly', () => {
  const styles = templateStyles();
  const splash = styles.resources.style.find((group) => group.$.name === plugin.SPLASH_GROUP);
  splash.item = splash.item.filter((item) => item.$.name !== plugin.ICON_ITEM);
  assert.throws(() => plugin.stripDanglingSplashIcon(styles), /delete this plugin/);
});

test('NEGATIVE: a styles document without style groups throws rather than inventing one', () => {
  for (const styles of [{}, { resources: {} }, { resources: { style: null } }]) {
    assert.throws(() => plugin.stripDanglingSplashIcon(styles), /no style groups/);
  }
});

test('the plugin is registered in app.json, BEFORE expo-splash-screen', () => {
  const appJson = require(path.join(appRoot, 'app.json'));
  const plugins = appJson.expo.plugins;
  const ours = plugins.indexOf('./plugins/with-android-imageless-splash');
  const splashIndex = plugins.findIndex(
    (entry) => Array.isArray(entry) && entry[0] === 'expo-splash-screen',
  );
  assert.ok(ours >= 0, 'the build cannot link without it while the splash is imageless');
  assert.ok(splashIndex >= 0, 'expo-splash-screen plugin entry missing');
  // Mods execute in REVERSE registration order: registered after
  // expo-splash-screen, this plugin would run before it, see the raw
  // template group, and throw — proven by a real prebuild both ways.
  assert.ok(ours < splashIndex, 'must be registered before expo-splash-screen to execute after it');
  // And the premise holds: the splash config carries no image — the day
  // one is added, this plugin must be REMOVED, not kept alongside it.
  assert.equal(plugins[splashIndex][1].image, undefined);
});
