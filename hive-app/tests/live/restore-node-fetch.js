/** Runs AFTER jest-expo's setup files: puts Node's real fetch stack
 * back. On a device the app uses the platform's networking; in this
 * lane Node's undici is that platform. */
const captured = globalThis.__hiveNodeFetch;
if (!captured?.fetch) {
  throw new Error('live-bridge: Node fetch was not captured before the Expo polyfill loaded');
}
globalThis.fetch = captured.fetch;
globalThis.Headers = captured.Headers;
globalThis.Request = captured.Request;
globalThis.Response = captured.Response;
