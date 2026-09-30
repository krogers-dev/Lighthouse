/** expo-crypto binding for the install marker's random source.
 *
 * `cryptoRandomSource` in core reads `globalThis.crypto.getRandomValues`,
 * which exists on web and in Node but NOT in Hermes: React Native ships no
 * WebCrypto global and Expo's winter runtime does not polyfill one. On
 * device it therefore threw, `InstallMarker.ensure()` never reached its
 * write, the marker never appeared, and every boot took the reinstall
 * branch and purged the session (find 14, 2026-09-03). Core stays free of
 * native imports — it is shared with the Node script lanes — so the device
 * binding lives here and is injected at the composition root, the same
 * shape as the SecureStore and marker-file bindings.
 */
import * as Crypto from 'expo-crypto';

import type { RandomSource } from '@/core/ids';

export const expoCryptoRandomSource: RandomSource = {
  fill(bytes: Uint8Array<ArrayBuffer>): void {
    Crypto.getRandomValues(bytes);
  },
};
