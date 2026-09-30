#!/usr/bin/env node
/**
 * review-window — the store review window (WO-008, option A, and its
 * fallback WO-009).
 *
 *   node scripts/local-supabase.mjs open-review-window [hours]   # default 24, at most 168
 *   node scripts/local-supabase.mjs check-review-sign-in
 *   node scripts/local-supabase.mjs close-review-window
 *   node scripts/local-supabase.mjs sweep-review-window
 *   node scripts/local-supabase.mjs review-window-status
 *   node scripts/hosted-supabase.mjs <staging|production> <the same five commands>
 *
 * open    Opens the window through the server role and sets the review
 *         identity's sign-in code as its password through the Auth Admin
 *         API, in that order: the server keeps a password only for the
 *         review identity and only inside an open window. The code comes
 *         from the file HIVE_REVIEW_CODE_FILE names, OUTSIDE the
 *         repository (twelve to twenty digits, typed where the sign-in
 *         code is typed); when that file does not exist the tool generates
 *         sixteen digits, writes them there, and says so. The code is never
 *         printed and never stored anywhere else. If the code cannot be
 *         set, the window just opened is closed again.
 *
 * check   Signs in as the review identity with the code in the file, the
 *         way the app does (the public sign-in endpoint, the publishable
 *         key), reads what that session can see, and signs out again:
 *         proof, before the code is handed to a reviewer, that it opens
 *         the door and shows exactly the review case. It never creates a
 *         code and prints neither the code nor a token.
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
 * The stack is the loopback one, or one of the two hosted projects named
 * in security/hosted-targets.json (WO-011): scripts/lib/operator-context.mjs
 * decides, and a change on production needs its project ref repeated. The
 * privileged key arrives in memory and is never printed.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import process from 'node:process';

import { loadHostedManifest, reviewCodeFileFor } from './lib/hosted-targets.mjs';
import { changeRefusal, resolveOperatorContext } from './lib/operator-context.mjs';
import { loadOrCreateReviewCode, loadReviewCode } from './lib/review-code.mjs';
import { REVIEW_TENANT } from './lib/review-tenant.mjs';

const COMMANDS = {
  open: 'open-review-window',
  check: 'check-review-sign-in',
  close: 'close-review-window',
  sweep: 'sweep-review-window',
  status: 'review-window-status',
};

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
  const mode = process.env.HIVE_REVIEW_WINDOW_MODE ?? '';
  if (!Object.hasOwn(COMMANDS, mode)) {
    fail('HIVE_REVIEW_WINDOW_MODE must be open, check, close, sweep, or status');
  }
  const context = resolveOperatorContext(process.env, loadHostedManifest());
  if (context.error) fail(context.error);
  const refusal = changeRefusal(context, COMMANDS[mode]);
  if (refusal) fail(refusal);

  const { url, serviceKey, gatewayKey, clientKey, reviewEmail } = context;
  const where = context.kind === 'hosted' ? ` [${context.name}]` : '';

  /** The code file: the one named locally; on a hosted target one file
   * per target, and never inside the repository, because a hosted code is
   * somebody's way in. */
  const resolveCodeFile = () => {
    if (context.kind !== 'hosted') return process.env.HIVE_REVIEW_CODE_FILE ?? '';
    const chosen = reviewCodeFileFor(context.name, process.env);
    if (chosen.error) fail(chosen.error);
    return chosen.file;
  };
  const headers = {
    apikey: gatewayKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  const call = async (pathname, options = {}) => {
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
  };

  if (mode === 'status') {
    const status = await call('/rest/v1/rpc/review_window_status', { method: 'POST', body: '{}' });
    if (!status.ok) fail(`review_window_status answered ${status.status}`);
    const s = status.body;
    console.log(
      s.open
        ? `review-window${where}: OPEN until ${s.closes_at} (${s.failed_attempts} of ${s.max_failed_attempts} failed attempts where the hook runs; ${s.review_identities} review identity); ${describeSweep(s.sweep)}`
        : `review-window${where}: closed (${s.review_identities} review identity registered); ${describeSweep(s.sweep)}`,
    );
    process.exit(0);
  }

  if (mode === 'sweep') {
    const swept = await call('/rest/v1/rpc/review_sweep', { method: 'POST', body: '{}' });
    if (!swept.ok) fail(`review_sweep answered ${swept.status}`);
    console.log(
      `review-window${where}: swept as of ${swept.body.as_of}; ${swept.body.expired} window(s) expired, ${swept.body.scrubbed} stray hash(es) replaced`,
    );
    process.exit(0);
  }

  if (mode === 'open') {
    const hours = Number(process.env.HIVE_REVIEW_WINDOW_HOURS ?? '24');
    if (!Number.isInteger(hours) || hours < 1 || hours > 168)
      fail('hours must be a whole number from 1 to 168');
    const codeFile = resolveCodeFile();
    let loaded;
    try {
      loaded = loadOrCreateReviewCode(codeFile);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
    const opened = await call('/rest/v1/rpc/open_review_window', {
      method: 'POST',
      body: JSON.stringify({ p_hours: hours, p_idempotency_key: randomUUID() }),
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
    if (set.status !== 200) {
      // A window without a code admits nobody, but it would block the next
      // open: close it again so the operator can simply retry.
      const undone = await call('/rest/v1/rpc/close_review_window', {
        method: 'POST',
        body: JSON.stringify({ p_idempotency_key: randomUUID() }),
      });
      fail(
        `the review identity's code could not be set (${set.status}); the window just opened was ${
          undone.ok
            ? 'closed again'
            : `NOT closed (close answered ${undone.status}): close it by hand`
        }`,
      );
    }
    console.log(
      `review-window${where}: open until ${opened.body.closes_at}; the review code ${
        loaded.created ? 'was generated into' : 'was read from'
      } ${context.kind === 'hosted' ? codeFile : 'the file HIVE_REVIEW_CODE_FILE names'} and set for ${reviewEmail} (never printed)`,
    );
    process.exit(0);
  }

  if (mode === 'check') {
    if (!clientKey.startsWith('sb_publishable_') && !clientKey.startsWith('eyJ')) {
      fail('no publishable key was handed over for the check; run through the runner');
    }
    let code;
    try {
      code = loadReviewCode(resolveCodeFile());
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
    // From here on the tool is the app: the public endpoints and the
    // publishable key, never the privileged one.
    const asApp = { apikey: clientKey, 'Content-Type': 'application/json' };
    const grant = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: asApp,
      body: JSON.stringify({ email: reviewEmail, password: code }),
    });
    const session = await grant.json().catch(() => null);
    if (grant.status !== 200 || typeof session?.access_token !== 'string') {
      fail(
        `the code in the file does not sign ${reviewEmail} in (${grant.status}); is a window open, and was the file's code the one set?`,
      );
    }
    const asReviewer = { ...asApp, Authorization: `Bearer ${session.access_token}` };
    const read = async (pathname) => {
      const response = await fetch(`${url}/rest/v1${pathname}`, { headers: asReviewer });
      return { status: response.status, rows: await response.json().catch(() => null) };
    };
    const cases = await read('/cases?select=id');
    const environments = await read('/environments?select=id');
    const requests = await read('/requests?select=id');
    const signedOut = await fetch(`${url}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: asReviewer,
    });
    const exact =
      cases.status === 200 &&
      Array.isArray(cases.rows) &&
      cases.rows.length === 1 &&
      cases.rows[0].id === REVIEW_TENANT.caseId &&
      environments.status === 200 &&
      Array.isArray(environments.rows) &&
      environments.rows.length === 1 &&
      environments.rows[0].id === REVIEW_TENANT.environmentId &&
      requests.status === 200 &&
      Array.isArray(requests.rows) &&
      requests.rows.length === REVIEW_TENANT.requestIds.length;
    if (!exact) {
      fail(
        `the code signs in, but the session does not see exactly the review workspace (cases ${cases.status}/${cases.rows?.length}, environments ${environments.status}/${environments.rows?.length}, requests ${requests.status}/${requests.rows?.length}); the check's session was ${signedOut.status === 204 ? 'signed out' : 'NOT signed out'}`,
      );
    }
    if (signedOut.status !== 204) {
      fail(
        `the check signed in and saw the right workspace, but its sign-out answered ${signedOut.status}`,
      );
    }
    console.log(
      `review-window${where}: the code in the file signs ${reviewEmail} in and the session sees exactly the review workspace (1 environment, 1 case, ${requests.rows.length} requests); the check's session was signed out; nothing was printed`,
    );
    process.exit(0);
  }

  const closed = await call('/rest/v1/rpc/close_review_window', {
    method: 'POST',
    body: JSON.stringify({ p_idempotency_key: randomUUID() }),
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
    `review-window${where}: ${note}; the review identity's password replaced once more through the Auth Admin API`,
  );
  process.exit(0);
}
