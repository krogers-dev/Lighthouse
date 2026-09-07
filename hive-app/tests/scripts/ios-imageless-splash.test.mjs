/** The imageless iOS launch screen, finished.
 *
 * No Apple toolchain exists in the container that runs this suite, so
 * the transform is asserted against the storyboard exactly as the
 * generated project carries it after expo-splash-screen's imageless mod
 * (captured from `expo prebuild --platform ios` at the 2026-09-07 head,
 * expo-splash-screen 57.0.8): image view gone, its two constraints and
 * the image resource left behind, background still the system colour.
 * Both failure directions are covered: doing nothing ships a launch
 * screen that references a missing object and ignores the brand colours,
 * and over-repairing (touching a configured image, or running when
 * upstream has already fixed itself) must throw rather than pass.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const plugin = require(path.join(appRoot, 'plugins/with-ios-imageless-splash.js'));
const { Parser, Builder } = require(path.join(appRoot, 'node_modules/xml2js'));

/** SplashScreen.storyboard as expo prebuild leaves it for an imageless
 * configuration (2026-09-07 head), verbatim. */
const GENERATED = `<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="24093.7" targetRuntime="iOS.CocoaTouch" propertyAccessControl="none" useAutolayout="YES" launchScreen="YES" useTraitCollections="YES" useSafeAreas="YES" colorMatched="YES" initialViewController="EXPO-VIEWCONTROLLER-1">
    <device id="retina6_12" orientation="portrait" appearance="light"/>
    <dependencies>
        <deployment identifier="iOS"/>
        <plugIn identifier="com.apple.InterfaceBuilder.IBCocoaTouchPlugin" version="24053.1"/>
        <capability name="Named colors" minToolsVersion="9.0"/>
        <capability name="Safe area layout guides" minToolsVersion="9.0"/>
        <capability name="System colors in document resources" minToolsVersion="11.0"/>
        <capability name="documents saved in the Xcode 8 format" minToolsVersion="8.0"/>
    </dependencies>
    <scenes>
        <scene sceneID="EXPO-SCENE-1">
            <objects>
                <viewController storyboardIdentifier="SplashScreenViewController" id="EXPO-VIEWCONTROLLER-1" sceneMemberID="viewController">
                    <view key="view" userInteractionEnabled="NO" contentMode="scaleToFill" insetsLayoutMarginsFromSafeArea="NO" id="EXPO-ContainerView" userLabel="ContainerView">
                        <rect key="frame" x="0.0" y="0.0" width="393" height="852"/>
                        <autoresizingMask key="autoresizingMask" flexibleMaxX="YES" flexibleMaxY="YES"/>
                        <subviews/>
                        <viewLayoutGuide key="safeArea" id="Rmq-lb-GrQ"/>
                        <constraints>
                            <constraint firstItem="EXPO-SplashScreen" firstAttribute="centerY" secondItem="EXPO-ContainerView" secondAttribute="centerY" id="0VC-Wk-OaO"/>
                            <constraint firstItem="EXPO-SplashScreen" firstAttribute="centerX" secondItem="EXPO-ContainerView" secondAttribute="centerX" id="zR4-NK-mVN"/>
                        </constraints>
                        <color key="backgroundColor" systemColor="systemBackgroundColor"/>
                    </view>
                </viewController>
                <placeholder placeholderIdentifier="IBFirstResponder" id="EXPO-PLACEHOLDER-1" userLabel="First Responder" sceneMemberID="firstResponder"/>
            </objects>
            <point key="canvasLocation" x="0.0" y="0.0"/>
        </scene>
    </scenes>
    <resources>
        <image name="SplashScreenLogo" width="100" height="90.333335876464844"/>
        <systemColor name="systemBackgroundColor">
            <color white="1" alpha="1" colorSpace="custom" customColorSpace="genericGamma22GrayColorSpace"/>
        </systemColor>
    </resources>
</document>`;

/** The raw template before the vendor's mod: the image view still present. */
const WITH_IMAGE = GENERATED.replace(
  '<subviews/>',
  `<subviews>
                            <imageView clipsSubviews="YES" userInteractionEnabled="NO" contentMode="scaleAspectFit" image="SplashScreen" translatesAutoresizingMaskIntoConstraints="NO" id="EXPO-SplashScreen" userLabel="SplashScreen">
                                <rect key="frame" x="146.66666666666666" y="381" width="100" height="90.333333333333314"/>
                            </imageView>
                        </subviews>`,
);

const WARM_PAPER = '#F3F2EA';

async function parse(text) {
  return new Parser().parseStringPromise(text);
}

function mainView(xml) {
  return xml.document.scenes[0].scene[0].objects[0].viewController[0].view[0];
}

test('drops the constraints that reference the removed image view, and nothing else', async () => {
  const out = plugin.fixImagelessSplashStoryboard(await parse(GENERATED), {
    backgroundColor: WARM_PAPER,
  });
  const view = mainView(out);
  // No constraints remain, so no <constraints> element remains either,
  // which is how Xcode itself writes a view without any.
  assert.equal(view.constraints, undefined);
  assert.ok(
    !JSON.stringify(out).includes(plugin.IMAGE_ID),
    'no reference to the absent image view survives',
  );
  // The safe-area guide, frame and autoresizing mask pass through untouched.
  assert.equal(view.viewLayoutGuide[0].$.id, 'Rmq-lb-GrQ');
  assert.equal(view.rect[0].$.width, '393');
});

test('drops the dangling image resource', async () => {
  const out = plugin.fixImagelessSplashStoryboard(await parse(GENERATED), {
    backgroundColor: WARM_PAPER,
  });
  assert.equal(out.document.resources[0].image, undefined);
  assert.ok(!JSON.stringify(out).includes('SplashScreenLogo'));
});

test('points the background at the SplashScreenBackground colour set and adds the named-colour resource in sRGB', async () => {
  const out = plugin.fixImagelessSplashStoryboard(await parse(GENERATED), {
    backgroundColor: WARM_PAPER,
  });
  const view = mainView(out);
  assert.deepEqual(view.color, [{ $: { key: 'backgroundColor', name: plugin.COLOR_NAME } }]);
  const named = out.document.resources[0].namedColor;
  assert.equal(named.length, 1);
  assert.equal(named[0].$.name, plugin.COLOR_NAME);
  // #F3F2EA as the vendor's colour set spells it.
  assert.deepEqual(named[0].color[0].$, {
    alpha: '1.000',
    blue: '0.917647058823529',
    green: '0.949019607843137',
    red: '0.952941176470588',
    customColorSpace: 'sRGB',
    colorSpace: 'custom',
  });
  // The template's system colour is no longer referenced anywhere, so its
  // resource entry goes too.
  assert.equal(out.document.resources[0].systemColor, undefined);
  assert.ok(!JSON.stringify(out).includes('systemBackgroundColor'));
});

test('the result serialises back to a storyboard Xcode can read', async () => {
  const out = plugin.fixImagelessSplashStoryboard(await parse(GENERATED), {
    backgroundColor: WARM_PAPER,
  });
  const text = new Builder({ xmldec: { version: '1.0', encoding: 'UTF-8' } }).buildObject(out);
  assert.match(text, /<color key="backgroundColor" name="SplashScreenBackground"\/>/);
  assert.match(text, /<namedColor name="SplashScreenBackground">/);
  assert.match(text, /<capability name="Named colors" minToolsVersion="9.0"\/>/);
  assert.doesNotMatch(text, /EXPO-SplashScreen/);
  assert.doesNotMatch(text, /<constraints/);
  // And it parses again as the same document.
  const again = await parse(text);
  assert.equal(mainView(again).constraints, undefined);
  assert.deepEqual(mainView(again).color, [
    { $: { key: 'backgroundColor', name: plugin.COLOR_NAME } },
  ]);
});

test('NEGATIVE: an image view present means a splash image was configured — throw, do not repair', async () => {
  await assert.rejects(
    async () =>
      plugin.fixImagelessSplashStoryboard(await parse(WITH_IMAGE), { backgroundColor: WARM_PAPER }),
    /remove this plugin/,
  );
});

test('NEGATIVE: nothing left to repair throws so an upstream fix retires this plugin loudly', async () => {
  const fixed = plugin.fixImagelessSplashStoryboard(await parse(GENERATED), {
    backgroundColor: WARM_PAPER,
  });
  assert.throws(
    () => plugin.fixImagelessSplashStoryboard(fixed, { backgroundColor: WARM_PAPER }),
    /retire this plugin/,
  );
});

test('NEGATIVE: a storyboard without the container view throws rather than inventing one', () => {
  for (const xml of [{}, { document: {} }, { document: { scenes: [{}] } }]) {
    assert.throws(
      () => plugin.fixImagelessSplashStoryboard(xml, { backgroundColor: WARM_PAPER }),
      /no container view/,
    );
  }
});

test('the light background follows expo-splash-screen precedence: ios.backgroundColor, then backgroundColor, then white', () => {
  const plugins = (props) => ({ plugins: ['expo-router', ['expo-splash-screen', props]] });
  assert.equal(
    plugin.resolveSplashBackground(
      plugins({ backgroundColor: '#F3F2EA', dark: { backgroundColor: '#111310' } }),
    ),
    '#F3F2EA',
  );
  assert.equal(
    plugin.resolveSplashBackground(
      plugins({ backgroundColor: '#F3F2EA', ios: { backgroundColor: '#ABCDEF' } }),
    ),
    '#ABCDEF',
  );
  assert.equal(plugin.resolveSplashBackground({ plugins: ['expo-splash-screen'] }), '#ffffff');
  assert.throws(
    () => plugin.resolveSplashBackground({ plugins: ['expo-router'] }),
    /not registered/,
  );
  assert.throws(() => plugin.resolveSplashBackground({}), /no plugins array/);
  assert.throws(() => plugin.parseHexColor('paper'), /must be #rrggbb/);
});

test('the plugin is registered in app.json, BEFORE expo-splash-screen, and the splash stays imageless', () => {
  const appJson = require(path.join(appRoot, 'app.json'));
  const plugins = appJson.expo.plugins;
  const ours = plugins.indexOf('./plugins/with-ios-imageless-splash');
  const splashIndex = plugins.findIndex(
    (entry) => Array.isArray(entry) && entry[0] === 'expo-splash-screen',
  );
  assert.ok(
    ours >= 0,
    'the launch screen ignores the brand colours without it while the splash is imageless',
  );
  assert.ok(splashIndex >= 0, 'expo-splash-screen plugin entry missing');
  // Mods execute in REVERSE registration order: registered after
  // expo-splash-screen, this plugin would run before it, meet the image
  // view in the raw template, and throw.
  assert.ok(ours < splashIndex, 'must be registered before expo-splash-screen to execute after it');
  assert.equal(plugins[splashIndex][1].image, undefined);
  assert.equal(plugins[splashIndex][1].backgroundColor, '#F3F2EA');
  assert.equal(plugins[splashIndex][1].dark.backgroundColor, '#111310');
});
