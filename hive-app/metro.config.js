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

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    !qaHooksEnabled &&
    (moduleName === '@/dev/qa-corrupt-storage' || moduleName.endsWith('dev/qa-corrupt-storage'))
  ) {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'src', 'dev', 'qa-corrupt-storage.stub.ts'),
    };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
