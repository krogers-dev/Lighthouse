/** Config plugin: finish expo-splash-screen's imageless iOS launch screen.
 *
 * The splash configuration is deliberately imageless (an approved splash
 * image is an asset-QA item, HOLD), and expo-splash-screen's iOS plugin
 * assumes an image. For an imageless configuration it removes the
 * storyboard's image view and nothing else — proven against the
 * generated project (2026-09-07, expo-splash-screen 57.0.8):
 *
 *  - the two constraints centring the removed `EXPO-SplashScreen` view
 *    stay behind (the removal matches ids the vendor never wrote), so the
 *    storyboard references an object that does not exist;
 *  - the `SplashScreenLogo` image resource stays behind (a `0 && …`
 *    index check skips the first entry);
 *  - the container view keeps the template's `systemBackgroundColor`
 *    (plain white by day, black by night), so the `SplashScreenBackground`
 *    colour set the vendor writes into the asset catalog — Warm Paper and
 *    Soft Black — is never referenced and the launch screen ignores the
 *    brand.
 *
 * This plugin runs after the vendor's storyboard mod and repairs exactly
 * those three things: it drops every constraint that references the
 * absent image view, drops the dangling image resources, and points the
 * container's background at the named colour (adding the named-colour
 * resource the storyboard needs for it), so the launch screen shows the
 * configured light and dark colours. The Android twin is
 * plugins/with-android-imageless-splash.js.
 *
 * It throws rather than no-ops in two cases, so it retires loudly:
 *  - an image view is present (a splash image was configured, so this
 *    plugin no longer applies and would be wrong to keep);
 *  - nothing was left to repair (upstream fixed its imageless path).
 *
 * Registration order is load-bearing: config-plugin mods EXECUTE in
 * reverse registration order (@expo/config-plugins withBaseMod wraps the
 * previously registered mod, running the newer action first), so this
 * plugin sits BEFORE expo-splash-screen in app.json's plugins array to
 * run after its storyboard mod. Registered after it, this plugin would
 * see the raw template with its image view and throw.
 */
const { withMod } = require('expo/config-plugins');

const IMAGE_ID = 'EXPO-SplashScreen';
const COLOR_NAME = 'SplashScreenBackground';
const SYSTEM_COLOR = 'systemBackgroundColor';
const IMAGE_RESOURCES = new Set(['SplashScreenLogo', 'SplashScreenLegacy']);
const DEFAULT_BACKGROUND = '#ffffff';

/** A #rrggbb colour as the sRGB components an Interface Builder named
 * colour carries, formatted like the vendor's colour set. */
function parseHexColor(value) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value).trim());
  if (!match) {
    throw new Error(
      `with-ios-imageless-splash: splash backgroundColor must be #rrggbb, got ${value}`,
    );
  }
  const hex = match[1];
  const component = (offset) =>
    String(Number((parseInt(hex.slice(offset, offset + 2), 16) / 255).toFixed(15)));
  return { red: component(0), green: component(2), blue: component(4) };
}

/** The light background expo-splash-screen resolves for iOS: the plugin's
 * `ios.backgroundColor`, else its `backgroundColor`, else white — the same
 * precedence as the vendor's getIosSplashConfig. The named colour's dark
 * value lives in the asset catalog's colour set, not in the storyboard. */
function resolveSplashBackground(config) {
  const plugins = Array.isArray(config?.plugins) ? config.plugins : null;
  if (!plugins) {
    throw new Error('with-ios-imageless-splash: the config carries no plugins array');
  }
  const entry = plugins.find((plugin) =>
    Array.isArray(plugin) ? plugin[0] === 'expo-splash-screen' : plugin === 'expo-splash-screen',
  );
  if (!entry) {
    throw new Error(
      'with-ios-imageless-splash: expo-splash-screen is not registered; nothing to finish',
    );
  }
  const props = Array.isArray(entry) ? (entry[1] ?? {}) : {};
  return props.ios?.backgroundColor ?? props.backgroundColor ?? DEFAULT_BACKGROUND;
}

function referencesImage(constraint) {
  const attrs = constraint?.$ ?? {};
  return attrs.firstItem === IMAGE_ID || attrs.secondItem === IMAGE_ID;
}

/** Pure transform over the storyboard's xml2js document. */
function fixImagelessSplashStoryboard(xml, { backgroundColor }) {
  const mainView =
    xml?.document?.scenes?.[0]?.scene?.[0]?.objects?.[0]?.viewController?.[0]?.view?.[0];
  if (!mainView) {
    throw new Error(
      'with-ios-imageless-splash: SplashScreen.storyboard has no container view — upstream changed shape; re-inspect before building',
    );
  }
  const imageViews = mainView.subviews?.[0]?.imageView ?? [];
  if (imageViews.length > 0) {
    throw new Error(
      'with-ios-imageless-splash: the storyboard carries a splash image view, so a splash image is configured; remove this plugin',
    );
  }

  let removedConstraints = 0;
  if (Array.isArray(mainView.constraints?.[0]?.constraint)) {
    const kept = mainView.constraints[0].constraint.filter(
      (constraint) => !referencesImage(constraint),
    );
    removedConstraints = mainView.constraints[0].constraint.length - kept.length;
    // Xcode writes no <constraints> element at all when there are none.
    if (kept.length > 0) mainView.constraints[0].constraint = kept;
    else delete mainView.constraints;
  }

  const resources = xml.document.resources?.[0] ?? {};
  xml.document.resources = [resources];
  let removedImages = 0;
  if (Array.isArray(resources.image)) {
    const kept = resources.image.filter((image) => !IMAGE_RESOURCES.has(image?.$?.name));
    removedImages = resources.image.length - kept.length;
    if (kept.length > 0) resources.image = kept;
    else delete resources.image;
  }

  const colours = Array.isArray(mainView.color) ? mainView.color : [];
  const background = colours.find((colour) => colour?.$?.key === 'backgroundColor');
  const backgroundWasNamed = background?.$?.name === COLOR_NAME;
  if (!backgroundWasNamed) {
    mainView.color = [
      ...colours.filter((colour) => colour?.$?.key !== 'backgroundColor'),
      { $: { key: 'backgroundColor', name: COLOR_NAME } },
    ];
  }

  if (removedConstraints === 0 && removedImages === 0 && backgroundWasNamed) {
    throw new Error(
      'with-ios-imageless-splash: nothing was left to repair — expo-splash-screen now writes the imageless storyboard correctly; retire this plugin',
    );
  }

  // The named colour the background now points at. Its light value is a
  // preview for Interface Builder; the asset catalog's colour set is what
  // the device reads, in both appearances.
  const rgb = parseHexColor(backgroundColor);
  const namedColours = Array.isArray(resources.namedColor) ? resources.namedColor : [];
  resources.namedColor = [
    ...namedColours.filter((colour) => colour?.$?.name !== COLOR_NAME),
    {
      $: { name: COLOR_NAME },
      color: [
        {
          $: {
            alpha: '1.000',
            blue: rgb.blue,
            green: rgb.green,
            red: rgb.red,
            customColorSpace: 'sRGB',
            colorSpace: 'custom',
          },
        },
      ],
    },
  ];
  // The template's system colour is unreferenced once the background is
  // named; drop its resource entry unless something else still uses it.
  if (Array.isArray(resources.systemColor)) {
    const stillReferenced = JSON.stringify(xml.document.scenes).includes(
      `"systemColor":"${SYSTEM_COLOR}"`,
    );
    if (!stillReferenced) {
      const kept = resources.systemColor.filter((colour) => colour?.$?.name !== SYSTEM_COLOR);
      if (kept.length > 0) resources.systemColor = kept;
      else delete resources.systemColor;
    }
  }
  // Named colours need the matching document capability.
  const capabilities = xml.document.dependencies?.[0]?.capability;
  if (Array.isArray(capabilities) && !capabilities.some((cap) => cap?.$?.name === 'Named colors')) {
    capabilities.push({ $: { name: 'Named colors', minToolsVersion: '9.0' } });
  }
  return xml;
}

function withIosImagelessSplash(config) {
  return withMod(config, {
    platform: 'ios',
    mod: 'splashScreenStoryboard',
    action: (modConfig) => {
      modConfig.modResults = fixImagelessSplashStoryboard(modConfig.modResults, {
        backgroundColor: resolveSplashBackground(modConfig),
      });
      return modConfig;
    },
  });
}

module.exports = withIosImagelessSplash;
module.exports.fixImagelessSplashStoryboard = fixImagelessSplashStoryboard;
module.exports.resolveSplashBackground = resolveSplashBackground;
module.exports.parseHexColor = parseHexColor;
module.exports.IMAGE_ID = IMAGE_ID;
module.exports.COLOR_NAME = COLOR_NAME;
