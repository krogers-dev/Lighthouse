#!/usr/bin/env node
/**
 * totp-helper — loopback-only TOTP code service for the Maestro device lane.
 *
 * During the first-enrollment flow Maestro copies the on-screen setup key
 * (a SYNTHETIC test account's secret) and asks this helper for the current
 * six-digit code, standing in for the human's authenticator app:
 *
 *   GET http://127.0.0.1:8477/code?secret=BASE32 -> {"code":"123456"}
 *
 * Development-lane guards: binds 127.0.0.1 only, serves loopback callers
 * only, never logs or echoes the secret, and exists solely for synthetic
 * local QA identities — it must never be pointed at a real credential and
 * is not part of the application or any build.
 */
import { createServer } from 'node:http';
import process from 'node:process';

import { totpCode } from './lib/totp.mjs';

const PORT = Number(process.env.HIVE_TOTP_HELPER_PORT ?? 8477);

const server = createServer((request, response) => {
  const remote = request.socket.remoteAddress ?? '';
  const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  if (!loopback) {
    response.writeHead(403, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'loopback callers only' }));
    return;
  }
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/code') {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'unknown path' }));
    return;
  }
  const secret = (url.searchParams.get('secret') ?? '').replace(/\s+/g, '');
  try {
    const code = totpCode(secret, Date.now());
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ code }));
  } catch {
    // Never echo the input back — a malformed value might be a mispasted
    // real credential.
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not a valid base32 TOTP secret' }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `totp-helper listening on http://127.0.0.1:${PORT}/code (loopback only; synthetic QA identities only)`,
  );
});
