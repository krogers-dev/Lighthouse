/** WO-015: the ClamAV client — the protocol's framing and parsing, pure,
 * and the socket exchange against a fake clamd on the loopback. */
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';

import {
  CHUNK_SIZE,
  SCANNER_NAME,
  instreamFrames,
  parseScanResponse,
  parseVersion,
  ping,
  scanBytes,
  version,
} from '../../scripts/lib/clamav.mjs';

test('VERSION is parsed into the engine, the signature version, and its date', () => {
  assert.deepEqual(parseVersion('ClamAV 1.4.6/28136/Tue Sep 30 08:31:02 2026\0'), {
    engine: '1.4.6',
    signatures: '28136',
    signaturesDate: 'Tue Sep 30 08:31:02 2026',
    label: 'ClamAV 1.4.6 (signatures 28136)',
  });
  assert.equal(parseVersion('ClamAV 1.4.6').label, 'ClamAV 1.4.6');
  assert.equal(parseVersion('ClamAV 1.4.6').signatures, null);
  for (const bad of ['', 'PONG', 'Version 1.4', null, undefined]) {
    assert.equal(parseVersion(bad), null, `${JSON.stringify(bad)} is not a version`);
  }
  assert.equal(SCANNER_NAME, 'ClamAV');
});

test('a stream answer is clean, a detection with its signature, or an error — never a guess', () => {
  assert.deepEqual(parseScanResponse('stream: OK\0'), { status: 'clean' });
  assert.deepEqual(parseScanResponse('stream: Eicar-Test-Signature FOUND'), {
    status: 'infected',
    signature: 'Eicar-Test-Signature',
  });
  assert.deepEqual(parseScanResponse('INSTREAM size limit exceeded. ERROR'), {
    status: 'error',
    message: 'INSTREAM size limit exceeded. ERROR',
  });
  assert.equal(parseScanResponse('').status, 'error');
  assert.equal(parseScanResponse('stream: ok').status, 'error');
  assert.equal(parseScanResponse('something else entirely').status, 'error');
  assert.equal(parseScanResponse(undefined).status, 'error');
});

test('INSTREAM frames are length-prefixed chunks closed by a zero-length frame', () => {
  const bytes = new Uint8Array(CHUNK_SIZE + 10).fill(7);
  const frames = instreamFrames(bytes);
  assert.equal(frames.length, 3);
  assert.equal(frames[0].readUInt32BE(0), CHUNK_SIZE);
  assert.equal(frames[0].length, 4 + CHUNK_SIZE);
  assert.equal(frames[1].readUInt32BE(0), 10);
  assert.deepEqual([...frames[1].subarray(4)], Array(10).fill(7));
  assert.deepEqual([...frames[2]], [0, 0, 0, 0]);
  const empty = instreamFrames(new Uint8Array(0));
  assert.equal(empty.length, 1);
  assert.deepEqual([...empty[0]], [0, 0, 0, 0]);
  const small = instreamFrames(new Uint8Array([1, 2, 3]), 2);
  assert.equal(small.length, 3);
  assert.throws(() => instreamFrames('bytes'), TypeError);
  assert.throws(() => instreamFrames(new Uint8Array(1), 0), RangeError);
});

/** A fake clamd: answers PING, VERSION, and INSTREAM (a stream whose
 * bytes contain "MARK" is a detection), and can be told to stall. */
function fakeClamd({ stall = false } = {}) {
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let command = null;
    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);
      if (command === null) {
        const end = buffer.indexOf(0);
        if (end < 0) return;
        command = buffer.subarray(0, end).toString('utf8');
        buffer = buffer.subarray(end + 1);
        if (stall) return;
        if (command === 'zPING') socket.end('PONG\0');
        if (command === 'zVERSION') socket.end('ClamAV 1.4.6/28136/Tue Sep 30 08:31:02 2026\0');
      }
      if (command === 'zINSTREAM' && !stall) {
        // Consume frames until the zero-length one.
        const payload = [];
        let offset = 0;
        while (offset + 4 <= buffer.length) {
          const length = buffer.readUInt32BE(offset);
          if (length === 0) {
            const bytes = Buffer.concat(payload);
            socket.end(
              bytes.includes('MARK') ? 'stream: Fake.Mark.Signature FOUND\0' : 'stream: OK\0',
            );
            return;
          }
          if (offset + 4 + length > buffer.length) break;
          payload.push(buffer.subarray(offset + 4, offset + 4 + length));
          offset += 4 + length;
        }
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

test('the client exchanges PING, VERSION, and a stream with a daemon on the loopback', async () => {
  const daemon = await fakeClamd();
  try {
    const clamd = { host: '127.0.0.1', port: daemon.port };
    assert.equal(await ping(clamd), true);
    assert.equal((await version(clamd)).label, 'ClamAV 1.4.6 (signatures 28136)');
    assert.deepEqual(
      await scanBytes({ ...clamd, bytes: new TextEncoder().encode('clean bytes') }),
      {
        status: 'clean',
      },
    );
    const big = new Uint8Array(3 * CHUNK_SIZE + 5);
    big.set(new TextEncoder().encode('MARK'), 2 * CHUNK_SIZE + 1);
    assert.deepEqual(await scanBytes({ ...clamd, bytes: big }), {
      status: 'infected',
      signature: 'Fake.Mark.Signature',
    });
  } finally {
    await daemon.close();
  }
});

test('a daemon that does not answer is a bounded failure, not a verdict', async () => {
  const daemon = await fakeClamd({ stall: true });
  try {
    const clamd = { host: '127.0.0.1', port: daemon.port, timeoutMs: 200 };
    await assert.rejects(ping(clamd), /no answer within 200ms/);
    await assert.rejects(
      scanBytes({ ...clamd, bytes: new Uint8Array(3) }),
      /no answer within 200ms/,
    );
  } finally {
    await daemon.close();
  }
  await assert.rejects(
    ping({ host: '127.0.0.1', port: 1, timeoutMs: 2000 }),
    /clamd at 127.0.0.1:1/,
  );
});
