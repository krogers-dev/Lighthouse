/** ClamAV over clamd's TCP protocol (WO-015): the approved malware
 * scanner, chosen by Kody on 2026-09-30 from the four options recorded in
 * the register ("use your recommendation").
 *
 * The scanner runner streams a quarantined object to clamd with the
 * INSTREAM command (length-prefixed chunks, a zero-length chunk to end)
 * and reads one line back: `stream: OK`, `stream: <signature> FOUND`, or
 * an ERROR. Nothing of the object is written to disk on the way, clamd
 * itself keeps nothing, and the runner logs ids and outcomes only.
 *
 * Every response is parsed by the pure functions below, which the unit
 * tests exercise without a daemon; the socket code is the thin part.
 */
import { connect } from 'node:net';

export const SCANNER_NAME = 'ClamAV';

/** clamd's default stream chunk: well under its StreamMaxLength and
 * small enough that a slow link fails on a timeout, not on memory. */
export const CHUNK_SIZE = 64 * 1024;

const NUL = 0;

/** "ClamAV 1.4.3/27500/Tue Sep 30 08:31:02 2026" -> the three facts a
 * receipt records: engine, signature database version, its date. */
export function parseVersion(text) {
  const line = String(text ?? '')
    .replace(/\0/g, '')
    .trim();
  const match = /^ClamAV ([0-9][0-9A-Za-z.+-]*)(?:\/([0-9]+)\/(.*))?$/.exec(line);
  if (!match) return null;
  return {
    engine: match[1],
    signatures: match[2] ?? null,
    signaturesDate: match[3]?.trim() || null,
    /** The one string a receipt carries: engine and signature version. */
    label: match[2] ? `ClamAV ${match[1]} (signatures ${match[2]})` : `ClamAV ${match[1]}`,
  };
}

/** clamd's one-line answer to a stream, as a verdict the pipeline
 * understands. Anything unparseable is an error: an unclear answer is
 * never a clean bill. */
export function parseScanResponse(text) {
  const line = String(text ?? '')
    .replace(/\0/g, '')
    .trim();
  if (line === 'stream: OK') return { status: 'clean' };
  const found = /^stream: (.+) FOUND$/.exec(line);
  if (found) return { status: 'infected', signature: found[1].trim() };
  if (/ERROR$/.test(line) || line === '') {
    return { status: 'error', message: line === '' ? 'empty response' : line };
  }
  return { status: 'error', message: `unrecognized response: ${line.slice(0, 120)}` };
}

/** The INSTREAM frames for a payload: 4-byte big-endian length, the
 * bytes, and a zero-length frame to close. Pure, so the framing is
 * provable byte for byte. */
export function instreamFrames(bytes, chunkSize = CHUNK_SIZE) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('instreamFrames needs bytes');
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new RangeError('chunkSize must be a positive integer');
  }
  const frames = [];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength));
    const header = Buffer.alloc(4);
    header.writeUInt32BE(chunk.byteLength, 0);
    frames.push(Buffer.concat([header, Buffer.from(chunk)]));
  }
  frames.push(Buffer.alloc(4));
  return frames;
}

/** Open a socket, send one command with optional stream frames, and
 * resolve with clamd's NUL-terminated reply. Bounded by a timeout that
 * destroys the socket; a daemon that stops answering never hangs the
 * runner. */
function exchange({ host, port, command, frames = [], timeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let settled = false;
    const chunks = [];
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () => finish(new Error(`clamd at ${host}:${port} gave no answer within ${timeoutMs}ms`)),
      timeoutMs,
    );
    socket.on('error', (error) => finish(new Error(`clamd at ${host}:${port}: ${error.message}`)));
    socket.on('connect', () => {
      socket.write(`z${command}\0`);
      for (const frame of frames) socket.write(frame);
    });
    socket.on('data', (data) => {
      chunks.push(data);
      const joined = Buffer.concat(chunks);
      const end = joined.indexOf(NUL);
      if (end >= 0) finish(null, joined.subarray(0, end).toString('utf8'));
    });
    socket.on('close', () => {
      const joined = Buffer.concat(chunks).toString('utf8');
      finish(
        joined === '' ? new Error(`clamd at ${host}:${port} closed without answering`) : null,
        joined,
      );
    });
  });
}

export async function ping({ host, port, timeoutMs = 5_000 }) {
  const reply = await exchange({ host, port, command: 'PING', timeoutMs });
  return reply.trim() === 'PONG';
}

export async function version({ host, port, timeoutMs = 5_000 }) {
  const reply = await exchange({ host, port, command: 'VERSION', timeoutMs });
  const parsed = parseVersion(reply);
  if (!parsed) throw new Error(`clamd at ${host}:${port} answered VERSION with something else`);
  return parsed;
}

/** Scan one object's bytes. Resolves with the parsed verdict; rejects
 * only when the daemon cannot be reached or does not answer in time,
 * which the runner treats as "not scanned", never as a verdict. */
export async function scanBytes({ host, port, bytes, timeoutMs = 120_000 }) {
  const reply = await exchange({
    host,
    port,
    command: 'INSTREAM',
    frames: instreamFrames(bytes),
    timeoutMs,
  });
  return parseScanResponse(reply);
}
