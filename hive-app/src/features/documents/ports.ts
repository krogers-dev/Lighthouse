/** The three native capabilities the document flow depends on, as ports.
 *
 * Screens and the flow hook never touch a native module: production
 * binds the Expo adapters in src/app-runtime.ts, the live-bridge lane
 * binds Node-side equivalents, jest binds fakes, and the QA build wraps
 * the picker with a named synthetic source so a device flow can run
 * without driving the platform's file picker (src/dev/qa-synthetic-document).
 */
import type { PickedDocument } from './document-rules';

/** The system document picker. Resolves null when the person cancels. */
export interface DocumentSource {
  pick(): Promise<PickedDocument | null>;
}

/** Reads the picked file's bytes and discards the app's cached copy once
 * they are no longer needed (local data stays minimal). */
export interface DocumentReader {
  read(uri: string): Promise<Uint8Array>;
  discard(uri: string): Promise<void>;
}

/** SHA-256 over the bytes, lowercase hex. Native on device (expo-crypto),
 * the reviewed pure implementation under jest. */
export interface Digester {
  sha256Hex(bytes: Uint8Array): Promise<string>;
}
