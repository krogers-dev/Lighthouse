/** Runs BEFORE jest-expo's setup files: snapshots Node's real undici
 * fetch stack before Expo's winter polyfill replaces it. The polyfill
 * routes through a mocked native module under jest and cannot reach the
 * network — and this lane exists to reach the network. */
globalThis.__hiveNodeFetch = {
  fetch: globalThis.fetch?.bind(globalThis),
  Headers: globalThis.Headers,
  Request: globalThis.Request,
  Response: globalThis.Response,
};
