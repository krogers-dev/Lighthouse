#!/usr/bin/env node
/**
 * review-window — the store review window (WO-008, option A, and its
 * fallback WO-009).
 *
 *   node scripts/local-supabase.mjs open-review-window [hours]   # default 24, at most 168
 *   node scripts/local-supabase.mjs close-review-window
 *   node scripts/local-supabase.mjs sweep-review-window
 *   node scripts/local-supabase.mjs review-window-status
 *
 * open    Opens the window through the server role and sets the review
 *         identity's sign-in code as its password through the Auth Admin
 *         API, in that order: the server keeps a password only for the
 *         review identity and only inside an open window. The code comes
 *         from the file HIVE_REVIEW_CODE_FILE names, OUTSIDE the
 *         repository (twelve to twenty digits, typed where the sign-in
 *         code is typed); when that file does not exist the tool generates
 *         sixteen digits, writes them there, and says so. The code is never
 *         printed and never stored anywhere else.
 *
 * close   Closes the window through the server role, which replaces the
 *         review identity's password with an unknown value and revokes its
 *         sessions; the tool then replaces the password once more through
 *         the Auth Admin API, so nothing depends on one layer alone.
 *
 * sweep   Runs the server's sweep now: any window whose close time has
 *         passed is closed with its access ended, and any stray password
 *         hash is replaced. The schedule does this every minute where the
 *         scheduler exists; this is the same call by hand.
 *
 * status  What the server holds: open or not, the close time, the count
 *         of failed attempts (counted only where the hook runs), the sweep
 *         state, and how many review identities exist.
 *
 * Loopback only; the privileged bearer arrives in memory and is never
 * printed.
 */
import { randomBytes } from 'node:crypto';
import process from 'node:process';

import { loadOrCreateReviewCode } from './lib/review-code.mjs';
import { REVIEW_TENANT } from './lib/review-tenant.mjs';

const url = process.env.HIVE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.HIVE_LOCAL_SERVICE_KEY;
const gatewayKey = process.env.HIVE_LOCAL_GATEWAY_KEY ?? serviceKey;
const mode = process.env.HIVE_REVIEW_WINDOW_MODE ?? '';
const hours = Number(process.env.HIVE_REVIEW_WINDOW_HOURS ?? '24');
const codeFile = process.env.HIVE_REVIEW_CODE_FILE ?? '';

if (!url || !serviceKey) {
  console.error(
    'review-window: run through `node scripts/local-supabase.mjs open-review-window|close-review-window|sweep-review-window|review-window-status`',
  );
  process.exit(1);
}
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)) {
  console.error('review-window: refusing a non-loopback URL');
  process.exit(1);
}

const headers = {
  apikey: gatewayKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

async function call(pathname, options = {}) {
  const response = await fetch(`${url}${pathname}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

function fail(message) {
  console.error(`review-window: ${message}`);
  process.exit(1);
}

function describeSweep(sweep) {
  if (!sweep || !sweep.last_run_at) return 'the sweep has not run yet';
  return `the sweep last ran at ${sweep.last_run_at} (expired ${sweep.last_expired}, scrubbed ${sweep.last_scrubbed}; totals ${sweep.total_expired} expired, ${sweep.total_scrubbed} scrubbed)`;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  if (mode === 'status') {
    const status = await call('/rest/v1/rpc/review_window_status', { method: 'POST', body: '{}' });
    if (!status.ok) fail(`review_window_status answered ${status.status}`);
    const s = status.body;
    console.log(
      s.open
        ? `review-window: OPEN until ${s.closes_at} (${s.failed_attempts} of ${s.max_failed_attempts} failed attempts where the hook runs; ${s.review_identities} review identity); ${describeSweep(s.sweep)}`
        : `review-window: closed (${s.review_identities} review identity registered); ${describeSweep(s.sweep)}`,
    );
    process.exit(0);
  }
  if (mode === 'sweep') {
    const swept = await call('/rest/v1/rpc/review_sweep', { method: 'POST', body: '{}' });
    if (!swept.ok) fail(`review_sweep answered ${swept.status}`);
    console.log(
      `review-window: swept as of ${swept.body.as_of}; ${swept.body.expired} window(s) expired, ${swept.body.scrubbed} stray hash(es) replaced`,
    );
    process.exit(0);
  }
  if (mode === 'open') {
    if (!Number.isInteger(hours) || hours < 1 || hours > 168)
      fail('hours must be a whole number from 1 to 168');
    let loaded;
    try {
      loaded = loadOrCreateReviewCode(codeFile);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
    const opened = await call('/rest/v1/rpc/open_review_window', {
      method: 'POST',
      body: JSON.stringify({ p_hours: hours, p_idempotency_key: crypto.randomUUID() }),
    });
    if (!opened.ok) {
      fail(
        `open_review_window answered ${opened.status}${
          typeof opened.body?.message === 'string' ? ` (${opened.body.message})` : ''
        }`,
      );
    }
    const set = await call(`/auth/v1/admin/users/${REVIEW_TENANT.identity.id}`, {
      method: 'PUT',
      body: JSON.stringify({ password: loaded.code }),
    });
    if (set.status !== 200) fail(`the review identity's code could not be set (${set.status})`);
    console.log(
      `review-window: open until ${opened.body.closes_at}; the review code ${
        loaded.created ? 'was generated into' : 'was read from'
      } the file HIVE_REVIEW_CODE_FILE names and set for ${REVIEW_TENANT.identity.email} (never printed)`,
    );
    process.exit(0);
  }
  if (mode === 'close') {
    const closed = await call('/rest/v1/rpc/close_review_window', {
      method: 'POST',
      body: JSON.stringify({ p_idempotency_key: crypto.randomUUID() }),
    });
    const note = closed.ok
      ? `closed at ${closed.body.closed_at} (sessions revoked, password replaced on the server)`
      : closed.body?.message === 'no_open_window'
        ? 'no open window'
        : fail(`close_review_window answered ${closed.status}`);
    const scrambled = await call(`/auth/v1/admin/users/${REVIEW_TENANT.identity.id}`, {
      method: 'PUT',
      body: JSON.stringify({ password: randomBytes(24).toString('base64url') }),
    });
    if (scrambled.status !== 200 && scrambled.status !== 404) {
      fail(`the review identity's password could not be replaced (${scrambled.status})`);
    }
    console.log(
      `review-window: ${note}; the review identity's password replaced once more through the Auth Admin API`,
    );
    process.exit(0);
  }
  console.error('review-window: HIVE_REVIEW_WINDOW_MODE must be open, close, sweep, or status');
  process.exit(1);
}
