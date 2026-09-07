#!/usr/bin/env node
/**
 * totp-helper — loopback-only TOTP authenticator stand-in for the Maestro
 * device lane (second RETURN directive, area 7).
 *
 * One process holds the SYNTHETIC QA account's TOTP secret in memory
 * across enrollment and every subsequent login. The secret never appears
 * in command-line arguments, environment variables, URL parameters,
 * clipboard persistence, logs, screenshots, or operator notes:
 *
 *   POST /capture   body JSON {"user":"<email>","secret":"<base32>"}
 *                   -> {"ok":true,"code":"123456","wrongCode":"123457"}
 *                   (secret arrives in the request BODY, is validated as
 *                   strict Base32, and is stored only in this process's
 *                   memory; the response carries the current code plus a
 *                   guaranteed-wrong code derived from it)
 *   GET  /code?user=<email>
 *                   -> {"code":"123456","wrongCode":"123457"}
 *                   (codes for a previously captured account; the URL
 *                   carries only the synthetic account label, never the
 *                   secret)
 *
 * Guards: binds 127.0.0.1 only, serves loopback callers only, rejects
 * malformed Base32 strictly, never echoes or logs secrets, and exists
 * solely for synthetic local QA identities — it is not part of the
 * application or any build.
 */
import { createServer } from 'node:http';
import process from 'node:process';

import { guaranteedWrongCode, strictBase32Decode, totpCode } from './lib/totp.mjs';

const PORT = Number(process.env.HIVE_TOTP_HELPER_PORT ?? 8477);

/** In-memory only: account label -> secret. Never serialized anywhere. */
const secretsByUser = new Map();

/** Strict canonical Base32 only (RETURN-3 area 8): alphabet, padding
 * amount and position, decoded length, and zero unused tail bits are all
 * enforced by strictBase32Decode; anything else is rejected without
 * being echoed. */
function validateSecret(raw) {
  const secret = typeof raw === 'string' ? raw.replace(/\s+/g, '').toUpperCase() : '';
  const decoded = strictBase32Decode(secret);
  if (decoded === null || decoded.length < 10) return null;
  return secret;
}

function json(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

/** wrongCode is guaranteed wrong for any submission within the grace
 * interval, even across a 30s window rollover: it differs from every
 * code the server could accept between generation and
 * wrongCodeExpiresAtMs. Submit before that expiry or fetch a fresh one. */
const WRONG_CODE_GRACE_SECONDS = 90;
function codesFor(secret) {
  const now = Date.now();
  return {
    code: totpCode(secret, now),
    wrongCode: guaranteedWrongCode(secret, now, 30, WRONG_CODE_GRACE_SECONDS),
    wrongCodeExpiresAtMs: now + WRONG_CODE_GRACE_SECONDS * 1000,
  };
}

const server = createServer((request, response) => {
  const remote = request.socket.remoteAddress ?? '';
  const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  if (!loopback) {
    json(response, 403, { error: 'loopback callers only' });
    return;
  }
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');

  if (request.method === 'POST' && url.pathname === '/capture') {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4096) request.destroy();
    });
    request.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        json(response, 400, { error: 'body must be JSON' });
        return;
      }
      const user = typeof parsed.user === 'string' ? parsed.user.trim().toLowerCase() : '';
      if (!user.endsWith('@example.invalid')) {
        // Synthetic QA identities only — never a real account.
        json(response, 400, { error: 'user must be a synthetic example.invalid identity' });
        return;
      }
      const secret = validateSecret(parsed.secret);
      if (!secret) {
        // Never echo the rejected value; it might be a mispasted credential.
        json(response, 400, { error: 'not a valid base32 TOTP secret' });
        return;
      }
      secretsByUser.set(user, secret);
      console.log(`totp-helper: captured factor for ${user} (secret held in memory only)`);
      json(response, 200, { ok: true, ...codesFor(secret) });
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/code') {
    const user = (url.searchParams.get('user') ?? '').trim().toLowerCase();
    const secret = secretsByUser.get(user);
    if (!secret) {
      json(response, 404, {
        error: 'no captured factor for that user — run the enrollment flow first',
      });
      return;
    }
    json(response, 200, codesFor(secret));
    return;
  }

  json(response, 404, { error: 'unknown path' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `totp-helper listening on http://127.0.0.1:${PORT} (loopback only; synthetic QA identities only; secrets memory-only)`,
  );
});
