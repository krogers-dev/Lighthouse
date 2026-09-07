/** Static asset modules as Metro resolves them: an asset import evaluates to
 * the numeric id the asset registry assigned at bundle time. Expo's own
 * ambient types cover CSS modules only, so the two asset kinds HIVE bundles
 * are declared here. */
declare module '*.png' {
  const assetId: number;
  export default assetId;
}

declare module '*.ttf' {
  const assetId: number;
  export default assetId;
}
