/** The device bindings for the document ports (WO-003).
 *
 * Verified against the SDK 57 references on 2026-09-28:
 *  - expo-document-picker 57.0.2: getDocumentAsync({ type, multiple,
 *    copyToCacheDirectory }) resolves { canceled, assets[] } with uri,
 *    name, size?, mimeType?; the picked file is COPIED into the app's
 *    cache so it can be read immediately, and that copy is what
 *    discard() removes. iOS uses the system document picker, Android the
 *    Storage Access Framework; neither adds a permission.
 *  - expo-file-system 57.0.6: File(uri).bytes() reads the whole file as a
 *    Uint8Array; File.exists and File.delete() are synchronous.
 *  - expo-crypto 57.0.2: digest(SHA256, bytes) is the platform's own
 *    SHA-256 and returns an ArrayBuffer.
 * Reading the whole file is deliberate: the digest and the transfer both
 * need every byte, and the 20 MB cap bounds the allocation.
 */
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';

import { exactArrayBuffer } from '@/core/bytes';

import { ALLOWED_MIME_TYPES, type PickedDocument } from './document-rules';
import type { Digester, DocumentReader, DocumentSource } from './ports';

export const expoDocumentSource: DocumentSource = {
  async pick(): Promise<PickedDocument | null> {
    const result = await DocumentPicker.getDocumentAsync({
      type: [...ALLOWED_MIME_TYPES],
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return null;
    const asset = result.assets[0];
    if (!asset) return null;
    return {
      uri: asset.uri,
      name: asset.name,
      byteSize: typeof asset.size === 'number' ? asset.size : null,
      mimeType: typeof asset.mimeType === 'string' ? asset.mimeType : null,
    };
  },
};

/** Writes bytes into the app's cache directory and returns the file's
 * uri: what the QA synthetic-document source uses in place of a pick, so
 * the reader and the discard path are exactly the production ones. */
export async function writeSyntheticDocumentToCache(
  name: string,
  bytes: Uint8Array,
): Promise<string> {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.write(bytes);
  return file.uri;
}

export const expoDocumentReader: DocumentReader = {
  async read(uri: string): Promise<Uint8Array> {
    return new File(uri).bytes();
  },
  async discard(uri: string): Promise<void> {
    const file = new File(uri);
    if (file.exists) file.delete();
  },
};

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

export const expoDigester: Digester = {
  async sha256Hex(bytes: Uint8Array): Promise<string> {
    // A TYPED ARRAY over exactly these bytes, never the bare buffer: the
    // native module (CryptoModule.kt digest(algorithm, output: TypedArray,
    // data: TypedArray)) converts its data argument as a typed array and
    // refuses an ArrayBuffer, which the first desktop run met only as
    // "Something went wrong" at the check step (2026-09-28). The exact
    // buffer keeps the digest over the view, not its allocation.
    const view = new Uint8Array(exactArrayBuffer(bytes));
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, view);
    return toHex(new Uint8Array(digest));
  },
};
