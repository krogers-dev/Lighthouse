/** Byte-buffer helpers shared by the transfer path and the native digest.
 *
 * A Uint8Array is a VIEW: it may sit at an offset inside a larger
 * allocation, and its `.buffer` is that whole allocation. Anything that
 * takes an ArrayBuffer (a request body, a platform digest) must be given
 * exactly the bytes of the view, never the allocation around them. */

/** The bytes as one exact ArrayBuffer, without a copy when the view
 * already spans its whole buffer. */
export function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}
