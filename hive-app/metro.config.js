// Metro configuration. One deliberate override on top of the Expo
// defaults (RETURN-3 area 7/8): the dev-only QA storage-corruption hook
// is resolved at BUILD time. Metro registers require() dependencies
// before dead-code elimination, so a source-level __DEV__ guard alone
// still bundles the module; the executable candidate inspection lane
// (bundle:inspect:candidate) proved the marker reached production-mode
// output. Unless EXPO_PUBLIC_QA_HOOKS=1 at export time, every import of
// the hook resolves to an inert, marker-free stub, keeping the real
// module out of the dependency graph entirely. bundle:inspect:candidate
// verifies the result on the actual export.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const qaHooksEnabled = process.env.EXPO_PUBLIC_QA_HOOKS === '1';
const defaultResolveRequest = config.resolver.resolveRequest;

// Each dev-only QA hook resolves to its inert, marker-free stub unless QA
// hooks are enabled at build time (find 20 added the session-expiry hook
// alongside the storage-corruption one; find 49 the keyboard geometry log).
const QA_HOOK_STUBS = ['qa-corrupt-storage', 'qa-expire-session', 'qa-keyboard-hook'];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (!qaHooksEnabled) {
    for (const hook of QA_HOOK_STUBS) {
      if (moduleName === `@/dev/${hook}` || moduleName.endsWith(`dev/${hook}`)) {
        return {
          type: 'sourceFile',
          filePath: path.resolve(__dirname, 'src', 'dev', `${hook}.stub.ts`),
        };
      }
    }
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
