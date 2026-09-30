/** The app configuration variants (prepared 2026-09-29 under Kody's
 * general grant, recorded in security/APPROVALS.md).
 *
 * app.json is the DEVELOPMENT configuration and stays the default: the
 * QA build, every device flow, and the synthetic candidate lane carry the
 * development identifiers by design. The PRODUCTION variant exists so
 * that a release build, when Kody's accounts exist, is one environment
 * variable away and nothing in it is guessed at build time:
 *
 *   APP_VARIANT=production
 *
 * selects the production identifiers below. config:check --profile
 * release evaluates this variant; every other gate reads app.json.
 */
const PRODUCTION = {
  name: 'HIVE',
  scheme: 'hive',
  version: '1.0.0',
  iosBundleIdentifier: 'com.myhbcfo.hive',
  iosBuildNumber: '1',
  androidPackage: 'com.myhbcfo.hive',
  androidVersionCode: 1,
};

/** Applies the named variant to the development configuration. */
function applyVariant(config, variant) {
  if (variant === undefined || variant === '' || variant === 'development') return config;
  if (variant !== 'production') {
    throw new Error(
      `APP_VARIANT must be development or production, not ${JSON.stringify(variant)}`,
    );
  }
  return {
    ...config,
    name: PRODUCTION.name,
    scheme: PRODUCTION.scheme,
    version: PRODUCTION.version,
    ios: {
      ...config.ios,
      bundleIdentifier: PRODUCTION.iosBundleIdentifier,
      buildNumber: PRODUCTION.iosBuildNumber,
    },
    android: {
      ...config.android,
      package: PRODUCTION.androidPackage,
      versionCode: PRODUCTION.androidVersionCode,
    },
  };
}

module.exports = ({ config }) => applyVariant(config, process.env.APP_VARIANT);
module.exports.applyVariant = applyVariant;
module.exports.PRODUCTION = PRODUCTION;
