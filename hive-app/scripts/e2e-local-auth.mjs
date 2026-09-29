#!/usr/bin/env node
/**
 * e2e-local-auth — black-box proof of the executable auth path
 * (P0-1/P0-2; hardened by the second RETURN directive, areas 1, 4, 5).
 *
 * Runs only against the full local Supabase stack (Docker lane), after
 * `local-supabase.mjs up` and `seed`. Everything is exercised from the
 * outside — GoTrue REST, Mailpit REST, PostgREST — never through app code
 * and never through SQL impersonation. Every JWT assertion compares
 * against the CANONICAL identity definitions
 * (scripts/lib/synthetic-identities.mjs), not against any live listing.
 *
 * Reliability contract (area 5):
 *  - Mailpit message IDs are snapshotted BEFORE each OTP request; only a
 *    message that appears AFTER the request is accepted.
 *  - The accepted message must carry the exact recipient, the exact
 *    configured subject, and exactly one distinct six-digit token
 *    (the same token appears in both the text and HTML parts).
 *  - Refresh tokens are REQUIRED; refresh is executed unconditionally and
 *    must yield a new access token, a new refresh token, the unchanged
 *    canonical `sub`, and a retained `aal2` — and the refreshed token is
 *    what the protected PostgREST assertions use.
 *
 * Coverage (areas 1 and 4): every seeded account's OTP + JWT-sub binding;
 * repeated OTP for one user; the unknown-email negative; the full staff
 * TOTP path; and real-JWT PostgREST evidence for BOTH mixed-role users at
 * AAL1 (zero rows across all EIGHT protected tables — the six Milestone 0
 * tables plus the Milestone 1 requests and activity_events surfaces — own
 * membership rows only) and AAL2 (exact permitted reach, zero wrong-scope
 * rows).
 *
 * Usage: node scripts/local-supabase.mjs e2e  (wires env in memory).
 */
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import process from 'node:process';

import { requireFactorsClean } from './lib/admin-factors.mjs';
import { assertAnswerPath } from './lib/answer-path.mjs';
import { performAnswerReset } from './lib/answer-reset.mjs';
import { performCaseReset } from './lib/case-reset.mjs';
import { verifyFilingReceipts } from './lib/filing-verify.mjs';
import { syncLedgerReferences } from './lib/ledger-sync.mjs';
import { assertReleaseControlsPath } from './lib/release-controls-path.mjs';
import { assertReviewPath } from './lib/review-path.mjs';
import { assertReviewTenantPath } from './lib/review-tenant-path.mjs';
import { assertSourcePath } from './lib/source-path.mjs';
import { msUntilIatAdvance, verifyRefreshedSession } from './lib/refresh-verify.mjs';
import { SCOPE, SYNTHETIC_IDENTITIES } from './lib/synthetic-identities.mjs';
import { totpCode } from './lib/totp.mjs';

const url = process.env.HIVE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.HIVE_LOCAL_SERVICE_KEY;
const clientKey = process.env.HIVE_LOCAL_CLIENT_KEY;
// Kong's apikey gate wants an ISSUED key; the service bearer carries the
// role (a JWT — PostgREST demotes any unparseable bearer to anon).
const gatewayKey = process.env.HIVE_LOCAL_GATEWAY_KEY ?? serviceKey;
const mailpitUrl = process.env.HIVE_LOCAL_MAILPIT_URL ?? 'http://127.0.0.1:54324';
const EXPECTED_SUBJECT = 'Your HIVE sign-in code';

if (!url || !serviceKey || !clientKey) {
  console.error('e2e-local-auth: run through `node scripts/local-supabase.mjs e2e`');
  process.exit(1);
}
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)) {
  console.error('e2e-local-auth: refusing a non-loopback URL');
  process.exit(1);
}

let passed = 0;
let failed = 0;
function check(condition, label) {
  if (condition) {
    passed += 1;
    console.log(`ok - ${label}`);
  } else {
    failed += 1;
    console.error(`NOT OK - ${label}`);
  }
  return Boolean(condition);
}

async function auth(pathname, options = {}, bearer = clientKey) {
  const response = await fetch(`${url}/auth/v1${pathname}`, {
    ...options,
    headers: {
      apikey: clientKey,
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function admin(pathname, options = {}) {
  const response = await fetch(`${url}/auth/v1${pathname}`, {
    ...options,
    headers: {
      apikey: gatewayKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  // Contract note (RETURN-4 P1-1): `ok` is part of the adapter contract
  // the shared factor-cleanup helper verifies; omitting it once made
  // real HTTP 200s read as failures.
  return {
    ok: response.ok,
    status: response.status,
    body: await response.json().catch(() => ({})),
  };
}

async function rest(pathname, accessToken) {
  const response = await fetch(`${url}/rest/v1${pathname}`, {
    headers: { apikey: clientKey, Authorization: `Bearer ${accessToken}` },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

function jwtClaims(token) {
  const payload = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Mailpit: snapshot-based, exact-message OTP retrieval (area 5).
// ---------------------------------------------------------------------------

async function mailpitSearch(email) {
  const response = await fetch(
    `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=50`,
  );
  const data = await response.json().catch(() => ({}));
  return Array.isArray(data?.messages) ? data.messages : [];
}

async function mailpitMessageIds(email) {
  return new Set((await mailpitSearch(email)).map((m) => m.ID));
}

/** Accept only a message that did not exist before the request, with the
 * exact recipient and subject, containing exactly one distinct six-digit
 * token. Returns { token } or an error marker. */
async function fetchFreshOtp(email, beforeIds) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const messages = await mailpitSearch(email);
    const fresh = messages.find((m) => !beforeIds.has(m.ID));
    if (fresh) {
      const detail = await fetch(`${mailpitUrl}/api/v1/message/${fresh.ID}`);
      const full = await detail.json().catch(() => ({}));
      const recipients = (full.To ?? []).map((t) => (t.Address ?? '').toLowerCase());
      if (!(recipients.length === 1 && recipients[0] === email.toLowerCase())) {
        return { error: `recipient mismatch: ${JSON.stringify(recipients)}` };
      }
      if (full.Subject !== EXPECTED_SUBJECT) {
        return { error: `subject mismatch: ${JSON.stringify(full.Subject)}` };
      }
      const body = `${full.Text ?? ''}\n${full.HTML ?? ''}`;
      const distinct = [...new Set(body.match(/\b\d{6}\b/g) ?? [])];
      if (distinct.length !== 1) {
        return { error: `expected exactly one distinct six-digit token, found ${distinct.length}` };
      }
      return { token: distinct[0] };
    }
    await sleep(500);
  }
  return { error: 'no new message arrived' };
}

/** Full OTP sign-in for a canonical identity; asserts the JWT sub equals
 * the canonical definition and the session is AAL1. */
async function signInWithOtp(identity) {
  const before = await mailpitMessageIds(identity.email);
  const request = await auth('/otp', {
    method: 'POST',
    body: JSON.stringify({ email: identity.email, create_user: false }),
  });
  if (!check(request.status === 200, `${identity.email}: OTP request accepted`)) return null;
  const otp = await fetchFreshOtp(identity.email, before);
  if (
    !check(
      Boolean(otp.token),
      `${identity.email}: fresh message with exact recipient/subject and exactly one distinct six-digit token (${otp.error ?? 'ok'})`,
    )
  ) {
    return null;
  }
  const verify = await auth('/verify', {
    method: 'POST',
    body: JSON.stringify({ type: 'email', email: identity.email, token: otp.token }),
  });
  if (
    !check(
      verify.status === 200 && Boolean(verify.body.access_token),
      `${identity.email}: token verified to a session (no link followed)`,
    )
  ) {
    return null;
  }
  const claims = jwtClaims(verify.body.access_token);
  check(
    claims.sub === identity.id,
    `${identity.email}: JWT sub equals the CANONICAL id ${identity.id}`,
  );
  check((claims.aal ?? 'aal1') === 'aal1', `${identity.email}: first factor yields AAL1`);
  return verify.body;
}

/** Refresh contract (area 5): refresh token REQUIRED; unconditional
 * exchange; new access + refresh tokens; canonical sub; retained AAL.
 * Returns the refreshed session — callers use IT for protected reads. */
async function mandatoryRefresh(session, identity, expectedAal, label) {
  if (!check(Boolean(session?.refresh_token), `${label}: refresh token present`)) return null;
  const previousClaims = jwtClaims(session.access_token);
  // Deterministic wait (RETURN-4 P1-2): a same-second exchange can mint
  // byte-identical tokens legally; wait until the clock is past the prior
  // token's iat second, then demand a strictly later iat.
  const waitMs = msUntilIatAdvance(previousClaims.iat, Date.now());
  if (waitMs > 0) await sleep(waitMs + 150);
  const refreshed = await auth('/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  if (
    !check(
      refreshed.status === 200 && Boolean(refreshed.body?.access_token),
      `${label}: refresh exchange succeeds`,
    )
  ) {
    return null;
  }
  const problems = verifyRefreshedSession(
    {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      claims: previousClaims,
    },
    {
      accessToken: refreshed.body.access_token,
      refreshToken: refreshed.body.refresh_token,
      claims: jwtClaims(refreshed.body.access_token),
    },
    { canonicalSub: identity.id, expectedAal, nowMs: Date.now() },
  );
  for (const problem of problems) check(false, `${label}: ${problem}`);
  check(
    problems.length === 0,
    `${label}: refresh verified (later iat, rotated tokens, canonical sub, session retained, ${expectedAal})`,
  );
  return problems.length === 0 ? refreshed.body : null;
}

// ---------------------------------------------------------------------------
// TOTP helpers (admin cleanup keeps reruns deterministic).
// ---------------------------------------------------------------------------

/** Genuinely fail-stop factor cleanup (RETURN-4 P1-1): terminates the
 * harness immediately on any listing, deletion, readback, or adapter-
 * contract failure — no OTP request, enrollment, challenge, verification,
 * or other mutation can run after a cleanup failure. */
async function adminCleanFactors(identity) {
  try {
    const deleted = await requireFactorsClean(admin, identity);
    check(
      true,
      `${identity.email}: factor-clean before enrollment (${deleted} deleted, readback zero)`,
    );
  } catch (error) {
    for (const problem of error.problems ?? [String(error)]) {
      check(false, `${identity.email}: factor cleanup — ${problem}`);
    }
    console.error(
      `e2e-local-auth: ${passed} passed, ${failed} failed — TERMINATED at factor cleanup`,
    );
    process.exit(1);
  }
}

async function enrollAndVerifyTotp(identity, session, label) {
  const access = session.access_token;
  const enroll = await auth(
    '/factors',
    { method: 'POST', body: JSON.stringify({ factor_type: 'totp', friendly_name: 'e2e' }) },
    access,
  );
  if (
    !check(
      enroll.status === 200 && Boolean(enroll.body?.totp?.secret),
      `${label}: TOTP enrollment returns a secret`,
    )
  ) {
    return null;
  }
  const factorId = enroll.body.id;
  const secret = enroll.body.totp.secret;
  const challenge = await auth(`/factors/${factorId}/challenge`, { method: 'POST' }, access);
  const verify = await auth(
    `/factors/${factorId}/verify`,
    {
      method: 'POST',
      body: JSON.stringify({ challenge_id: challenge.body?.id, code: totpCode(secret) }),
    },
    access,
  );
  if (
    !check(
      verify.status === 200 && Boolean(verify.body?.access_token),
      `${label}: TOTP verify succeeds`,
    )
  ) {
    return null;
  }
  const claims = jwtClaims(verify.body.access_token);
  check(claims.aal === 'aal2', `${label}: verified session is AAL2`);
  check(claims.sub === identity.id, `${label}: AAL2 sub is still the canonical id`);
  return { session: verify.body, factorId, secret };
}

// ---------------------------------------------------------------------------
// Scope expectations derived from the canonical seed definitions.
// ---------------------------------------------------------------------------

const CASES = {
  a1: 'eeeeeeee-0000-4000-8000-0000000000a1',
  // Second case on entity A1 (WO-002 R1): Home lists the scope's cases,
  // so a single case per entity would leave ordering unobserved.
  a1Older: 'eeeeeeee-0000-4000-8000-0000000000a2',
  b1: 'eeeeeeee-0000-4000-8000-0000000000b1',
  b2: 'eeeeeeee-0000-4000-8000-0000000000b2',
};
const ATTENTION = {
  a1: 'ffffffff-0000-4000-8000-0000000000a1',
  b1: 'ffffffff-0000-4000-8000-0000000000b1',
};
const NEXT_ACTIONS = {
  a1: 'ffffffff-1111-4000-8000-0000000000a1',
  b1: 'ffffffff-1111-4000-8000-0000000000b1',
};
/** Exact AAL2 reach per scope set, covering ALL SIX protected tables
 * (RETURN-3 area 6). The B-side attention/next-action rows exist
 * specifically so the missing ids here are real negatives.
 *
 * RETURN-4 P2-4: entity B2 now carries its own attention item and next
 * action, and they appear in NO reach set below — including
 * mixed.cross's. Previously every seeded child row was inside
 * mixed.cross's reach, so "exact reach" for those two tables was
 * satisfied by a set that happened to be the whole table; an
 * entity-level leak into B2 would not have been detected. */
/** Milestone 1 fixture ids (WO-002 R2/R3). The B2 rows appear in NO reach
 * set below, exactly like the B2 attention item and next action. */
const REQUESTS = {
  a1: 'dddddddd-0000-4000-8000-0000000000a1',
  a2: 'dddddddd-0000-4000-8000-0000000000a2',
  // Milestone 3 (WO-004): the November question, on the same case.
  a3: 'dddddddd-0000-4000-8000-0000000000a3',
  b1: 'dddddddd-0000-4000-8000-0000000000b1',
};
const ACTIVITY = {
  a1: 'cccccccc-1111-4000-8000-0000000000a1',
  a2: 'cccccccc-1111-4000-8000-0000000000a2',
  a3: 'cccccccc-1111-4000-8000-0000000000a3',
  b1: 'cccccccc-1111-4000-8000-0000000000b1',
};
/** Milestone 2 fixture ids (WO-003): the seeded, settled documents. The
 * B1 document appears in the aOnly set never. Reach is asserted by exact
 * id sets, so a document reserved by THIS harness run (step 7 below) is
 * added to the expected sets before the AAL2 reach checks run. */
const DOCUMENTS = {
  a1Accepted: 'd0c0d0c0-0000-4000-8000-0000000000a1',
  a1Rejected: 'd0c0d0c0-0000-4000-8000-0000000000a2',
  a2Accepted: 'd0c0d0c0-0000-4000-8000-0000000000a3',
  // Milestone 3: the checked document on the November question.
  a3Accepted: 'd0c0d0c0-0000-4000-8000-0000000000a4',
  b1Accepted: 'd0c0d0c0-0000-4000-8000-0000000000b1',
};
const REACH = {
  aOnly: {
    environments: [SCOPE.environmentId],
    clients: [SCOPE.clientA],
    entities: [SCOPE.entityA1],
    cases: [CASES.a1, CASES.a1Older],
    case_attention_items: [ATTENTION.a1],
    case_next_actions: [NEXT_ACTIONS.a1],
    requests: [REQUESTS.a1, REQUESTS.a2, REQUESTS.a3],
    activity_events: [ACTIVITY.a1, ACTIVITY.a2, ACTIVITY.a3],
    document_uploads: [
      DOCUMENTS.a1Accepted,
      DOCUMENTS.a1Rejected,
      DOCUMENTS.a2Accepted,
      DOCUMENTS.a3Accepted,
    ],
    request_answers: [],
    request_answer_citations: [],
    case_review_packages: [],
    case_reviews: [],
    case_approvals: [],
    ledger_references: [],
    filing_receipts: [],
    account_deletion_requests: [],
  },
  aAndB1: {
    environments: [SCOPE.environmentId],
    clients: [SCOPE.clientA, SCOPE.clientB],
    entities: [SCOPE.entityA1, SCOPE.entityB1],
    cases: [CASES.a1, CASES.a1Older, CASES.b1],
    case_attention_items: [ATTENTION.a1, ATTENTION.b1],
    case_next_actions: [NEXT_ACTIONS.a1, NEXT_ACTIONS.b1],
    requests: [REQUESTS.a1, REQUESTS.a2, REQUESTS.a3, REQUESTS.b1],
    activity_events: [ACTIVITY.a1, ACTIVITY.a2, ACTIVITY.a3, ACTIVITY.b1],
    document_uploads: [
      DOCUMENTS.a1Accepted,
      DOCUMENTS.a1Rejected,
      DOCUMENTS.a2Accepted,
      DOCUMENTS.a3Accepted,
      DOCUMENTS.b1Accepted,
    ],
    request_answers: [],
    request_answer_citations: [],
    case_review_packages: [],
    case_reviews: [],
    case_approvals: [],
    ledger_references: [],
    filing_receipts: [],
    account_deletion_requests: [],
  },
};
const PROTECTED_TABLES = [
  'environments',
  'clients',
  'entities',
  'cases',
  'case_attention_items',
  'case_next_actions',
  // Milestone 1 read surfaces, held to the same reach proofs.
  'requests',
  'activity_events',
  // Milestone 2 (WO-003): the documents on a request, same shape, same proofs.
  'document_uploads',
  // Milestone 3 (WO-004): the answer on a request and its citations. The
  // seed holds none; the rows step 3c creates are counted through extraReach.
  'request_answers',
  'request_answer_citations',
  // Milestone 4 (WO-005): the review workflow, staff of the scope at AAL2
  // only. The seed holds none; the rows step 4b creates are counted per
  // identity through extraReachByEmail (a client of A1 who is staff
  // elsewhere sees none of them).
  'case_review_packages',
  'case_reviews',
  'case_approvals',
  // Milestone 5 (WO-006): the read-only ledger references and the filing
  // receipts, staff of the scope at AAL2 only. The seed holds none; the
  // rows step 4c creates are counted per identity through extraReachByEmail.
  'ledger_references',
  'filing_receipts',
  // Milestone 6 (WO-007): a person's own deletion requests, own rows only.
  // The seed holds none; the rows step 4d creates are counted for the one
  // person who made them through extraReachByEmail.
  'account_deletion_requests',
];

function idsOf(rows) {
  return new Set((rows ?? []).map((row) => row.id));
}
function sameSet(actual, expected) {
  return actual.size === expected.length && expected.every((id) => actual.has(id));
}

/** AAL1 for a user holding any staff membership: zero rows from all eight
 * protected tables; exactly the own membership rows (area 4). */
async function assertStaffAal1(identity, session) {
  for (const table of PROTECTED_TABLES) {
    const result = await rest(`/${table}?select=id`, session.access_token);
    check(
      result.status === 200 && Array.isArray(result.body) && result.body.length === 0,
      `${identity.email} AAL1: zero rows from ${table}`,
    );
  }
  const memberships = await rest(
    '/memberships?select=id,user_id,environment_id,client_id,entity_id,role',
    session.access_token,
  );
  const rows = memberships.body ?? [];
  // Complete canonical tuples (RETURN-3 area 6): environment, client,
  // entity, role, AND canonical user id — from the identity definition.
  const tupleOf = (row) =>
    [row.user_id, row.environment_id, row.client_id, row.entity_id, row.role].join(':');
  const expectedTuples = identity.memberships
    .map(([clientKey, entityKey, role]) =>
      [identity.id, SCOPE.environmentId, SCOPE[clientKey], SCOPE[entityKey], role].join(':'),
    )
    .sort();
  const actualTuples = rows.map(tupleOf).sort();
  check(
    memberships.status === 200 && JSON.stringify(actualTuples) === JSON.stringify(expectedTuples),
    `${identity.email} AAL1: membership rows are exactly the canonical tuples (${expectedTuples.length})`,
  );
}

/** Exact ID sets across ALL protected tables with the given token. Rows
 * the activity trail and the document table gained from THIS harness run
 * (step 7) are counted through `extraReach`, so the sets stay exact
 * rather than becoming floors. */
const extraReach = {
  activity_events: [],
  document_uploads: [],
  request_answers: [],
  request_answer_citations: [],
};
/** Rows only SOME identities can see (the review workflow's, staff of the
 * scope at AAL2): expected per email, so mixed.cross's zero rows in A1
 * stay a real negative. */
const extraReachByEmail = {};

async function assertExactReach(identity, accessToken, reach, label) {
  for (const table of PROTECTED_TABLES) {
    const result = await rest(`/${table}?select=id`, accessToken);
    const expected = [
      ...reach[table],
      ...(extraReach[table] ?? []),
      ...(extraReachByEmail[identity.email]?.[table] ?? []),
    ];
    check(
      result.status === 200 && sameSet(idsOf(result.body), expected),
      `${identity.email} ${label}: ${table} ids are exactly {${expected.join(', ')}}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Milestone 2 (WO-003): the document path over raw HTTP, with real JWTs.
// ---------------------------------------------------------------------------

async function rpc(name, args, accessToken) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: clientKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function storagePut(bucket, objectPath, bytes, contentType, accessToken) {
  const response = await fetch(`${url}/storage/v1/object/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: clientKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': contentType,
      'x-upsert': 'false',
    },
    body: bytes,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function storageGet(bucket, objectPath, accessToken) {
  const response = await fetch(`${url}/storage/v1/object/${bucket}/${objectPath}`, {
    headers: { apikey: clientKey, Authorization: `Bearer ${accessToken}` },
  });
  return { status: response.status };
}

function uuidV4() {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A clearly synthetic PDF, unique per run. */
function syntheticPdf() {
  return Buffer.from(
    `%PDF-1.4\n% HIVE black-box synthetic document (Synthetic) ${Date.now()}\n%%EOF\n`,
    'latin1',
  );
}

/** The whole path as a client user, plus the refusals: staff cannot
 * reserve, another client cannot write under the reserving scope, nobody
 * can read the object back, and no client can reach the scan interface. */
async function assertDocumentPath(owner, ownerSession, other, otherSession, staff, staffSession) {
  const bytes = syntheticPdf();
  const digest = createHash('sha256').update(bytes).digest('hex');
  const args = {
    p_environment_id: SCOPE.environmentId,
    p_client_id: SCOPE.clientA,
    p_entity_id: SCOPE.entityA1,
    p_request_id: REQUESTS.a1,
    p_request_version: 1,
    p_idempotency_key: uuidV4(),
    p_display_name: 'black-box (Synthetic).pdf',
    p_mime_type: 'application/pdf',
    p_byte_size: bytes.length,
    p_client_digest: digest,
  };
  const token = ownerSession.access_token;

  const reserved = await rpc('begin_document_upload', args, token);
  if (
    !check(
      reserved.status === 200 && typeof reserved.body?.storage_path === 'string',
      `${owner.email}: begin_document_upload reserves a quarantine path`,
    )
  ) {
    return;
  }
  const uploadId = reserved.body.upload_id;
  const objectPath = reserved.body.storage_path;
  extraReach.document_uploads.push(uploadId);

  const replay = await rpc('begin_document_upload', args, token);
  check(
    replay.status === 200 && replay.body?.upload_id === uploadId,
    `${owner.email}: the same idempotency key returns the same reservation`,
  );

  const early = await rpc('complete_document_upload', { p_upload_id: uploadId }, token);
  check(
    early.status === 400 && early.body?.message === 'transfer_incomplete',
    `${owner.email}: completion before the object exists is refused (transfer_incomplete)`,
  );

  const staffReserve = await rpc(
    'begin_document_upload',
    { ...args, p_idempotency_key: uuidV4() },
    staffSession.access_token,
  );
  check(
    staffReserve.status === 403,
    `${staff.email}: staff cannot reserve a document upload (403)`,
  );

  const foreignPut = await storagePut(
    'hive-quarantine',
    objectPath,
    bytes,
    'application/pdf',
    otherSession.access_token,
  );
  check(
    foreignPut.status >= 400,
    `${other.email}: cannot write under another client's reserved path (${foreignPut.status})`,
  );

  const wrongPath = await storagePut(
    'hive-quarantine',
    `${objectPath}-not-reserved`,
    bytes,
    'application/pdf',
    token,
  );
  check(
    wrongPath.status >= 400,
    `${owner.email}: cannot write at an unreserved path (${wrongPath.status})`,
  );

  const put = await storagePut('hive-quarantine', objectPath, bytes, 'application/pdf', token);
  check(put.status === 200, `${owner.email}: the object lands at the reserved path (200)`);

  const readBack = await storageGet('hive-quarantine', objectPath, token);
  check(
    readBack.status >= 400,
    `${owner.email}: the uploader cannot read the quarantined object back (${readBack.status})`,
  );

  const overwrite = await storagePut(
    'hive-quarantine',
    objectPath,
    bytes,
    'application/pdf',
    token,
  );
  check(
    overwrite.status >= 400,
    `${owner.email}: a second write at the same path is refused (${overwrite.status})`,
  );

  const completed = await rpc('complete_document_upload', { p_upload_id: uploadId }, token);
  check(
    completed.status === 200 && completed.body?.status === 'QUARANTINED',
    `${owner.email}: completion verifies the object and quarantines the document`,
  );

  const row = await rest(`/document_uploads?select=id,status&id=eq.${uploadId}`, token);
  check(
    row.status === 200 && row.body?.[0]?.status === 'QUARANTINED',
    `${owner.email}: the document reads back as QUARANTINED through PostgREST`,
  );

  const trail = await rest(
    `/activity_events?select=id,event_kind,actor_role&case_id=eq.${CASES.a1}&event_kind=eq.document.received`,
    token,
  );
  const receivedEvents = (trail.body ?? []).filter((event) => event.actor_role === 'client_user');
  check(
    trail.status === 200 && receivedEvents.length >= 1,
    `${owner.email}: the activity trail carries "document received" (no free text)`,
  );
  for (const event of trail.body ?? []) extraReach.activity_events.push(event.id);

  const scan = await rpc('begin_document_scan', { p_upload_id: uploadId }, token);
  check(
    scan.status === 403 || scan.status === 401,
    `${owner.email}: a client cannot begin a scan (${scan.status})`,
  );

  const foreignRow = await rest(
    `/document_uploads?select=id&id=eq.${uploadId}`,
    otherSession.access_token,
  );
  check(
    foreignRow.status === 200 && (foreignRow.body ?? []).length === 0,
    `${other.email}: the new document is invisible to another client (zero rows)`,
  );
}

/** A staff identity at AAL2 with a refreshed token, for the review path
 * (WO-005): the same clean -> OTP -> enroll -> refresh the staff steps
 * prove, reused for the roles the path needs. */
async function staffAal2Token(email, label) {
  const identity = byEmail.get(email);
  await adminCleanFactors(identity);
  await sleep(1100); // the address's previous code was step 1's (find 60)
  const aal1 = await signInWithOtp(identity);
  if (!aal1) return null;
  const enrolled = await enrollAndVerifyTotp(identity, aal1, `${identity.email} ${label}`);
  if (!enrolled) return null;
  const refreshed = await mandatoryRefresh(
    enrolled.session,
    identity,
    'aal2',
    `${identity.email} ${label}`,
  );
  return refreshed?.access_token ?? null;
}

// ---------------------------------------------------------------------------
// Run.
// ---------------------------------------------------------------------------

const byEmail = new Map(SYNTHETIC_IDENTITIES.map((identity) => [identity.email, identity]));
const sessions = new Map();

// 1. Every seeded account signs in; JWT sub === canonical definition.
for (const identity of SYNTHETIC_IDENTITIES) {
  const session = await signInWithOtp(identity);
  if (session) sessions.set(identity.email, session);
}

// 2. Repeated OTP for the same user: the SECOND request must produce a
//    new message (snapshot semantics) whose token verifies.
{
  const identity = byEmail.get('client.owner@example.invalid');
  await sleep(1100); // respect auth.email.max_frequency = 1s
  const again = await signInWithOtp(identity);
  check(Boolean(again), `${identity.email}: repeated OTP request yields a fresh working code`);
}

// 3. Unknown email: no sign-in, no account creation.
{
  const strangerEmail = 'stranger.unknown@example.invalid';
  const stranger = await auth('/otp', {
    method: 'POST',
    body: JSON.stringify({ email: strangerEmail, create_user: false }),
  });
  check(stranger.status >= 400, 'unknown email is rejected for OTP');
  let found = false;
  for (let page = 1; page <= 10; page++) {
    const listing = await admin(`/admin/users?page=${page}&per_page=100`);
    const users = listing.body?.users ?? [];
    if (users.some((u) => (u.email ?? '').toLowerCase() === strangerEmail)) found = true;
    if (users.length < 100) break;
  }
  check(!found, 'unknown email did not create an account');
}

// 3b. Milestone 2 (WO-003): the document path with real JWTs, BEFORE the
//     AAL2 reach checks so the rows it adds are in the exact sets.
{
  const owner = byEmail.get('client.owner@example.invalid');
  const other = byEmail.get('client.second@example.invalid');
  const staff = byEmail.get('reviewer.rae@example.invalid');
  const ownerSession = sessions.get(owner.email);
  const otherSession = sessions.get(other.email);
  const staffSession = sessions.get(staff.email);
  if (ownerSession && otherSession && staffSession) {
    await assertDocumentPath(owner, ownerSession, other, otherSession, staff, staffSession);
  } else {
    check(false, 'document path: the three sessions it needs are not all available');
  }
}

// 3c. Milestone 3 (WO-004): the answer path with real JWTs, also before
//     the AAL2 reach checks. The seeded question is reset first through
//     the checked loopback reset, so a re-run starts from the seed.
{
  const owner = byEmail.get('client.owner@example.invalid');
  const other = byEmail.get('client.second@example.invalid');
  const staff = byEmail.get('reviewer.rae@example.invalid');
  const parties = {
    owner,
    other,
    staff,
    ownerSession: sessions.get(owner.email),
    otherSession: sessions.get(other.email),
    staffSession: sessions.get(staff.email),
  };
  if (parties.ownerSession && parties.otherSession && parties.staffSession) {
    await assertAnswerPath(
      {
        rest,
        rpc,
        check,
        uuidV4,
        extraReach,
        SCOPE,
        REQUESTS,
        DOCUMENTS,
        CASES,
        reset: (requestKey) => performAnswerReset({ url, serviceKey, gatewayKey, requestKey }),
      },
      parties,
    );
  } else {
    check(false, 'answer path: the three sessions it needs are not all available');
  }
}

// 4. Full staff path (preparer.pat): enroll, AAL2, MANDATORY refresh, and
//    protected reads with the REFRESHED token; then repeat login against
//    the existing factor discovered via GET /factors.
{
  const identity = byEmail.get('preparer.pat@example.invalid');
  await adminCleanFactors(identity);
  const aal1 = await signInWithOtp(identity);
  if (aal1) {
    await assertStaffAal1(identity, aal1);
    const enrolled = await enrollAndVerifyTotp(identity, aal1, `${identity.email} enroll`);
    if (enrolled) {
      const refreshed = await mandatoryRefresh(
        enrolled.session,
        identity,
        'aal2',
        `${identity.email} AAL2`,
      );
      if (refreshed) {
        // 4b. Milestone 4 (WO-005): the review and approval path with real
        //     AAL2 JWTs, BEFORE the reach checks so the rows it adds are in
        //     the exact sets of the identities that may see them.
        const reviewerToken = await staffAal2Token('reviewer.rae@example.invalid', 'review path');
        const approverToken = await staffAal2Token('approver.avery@example.invalid', 'review path');
        const clientSession = sessions.get('client.owner@example.invalid');
        const otherSession = sessions.get('client.second@example.invalid');
        const intakeSession = sessions.get('intake.beth@example.invalid');
        if (reviewerToken && approverToken && clientSession && otherSession && intakeSession) {
          await assertReviewPath(
            {
              rest,
              rpc,
              check,
              uuidV4,
              extraReach,
              extraReachByEmail,
              SCOPE,
              CASES,
              reset: (caseKey) => performCaseReset({ url, serviceKey, gatewayKey, caseKey }),
            },
            {
              preparer: { email: identity.email, token: refreshed.access_token },
              reviewer: { email: 'reviewer.rae@example.invalid', token: reviewerToken },
              approver: { email: 'approver.avery@example.invalid', token: approverToken },
              client: { email: 'client.owner@example.invalid', token: clientSession.access_token },
              other: { email: 'client.second@example.invalid', token: otherSession.access_token },
              staffAal1: {
                email: 'intake.beth@example.invalid',
                token: intakeSession.access_token,
              },
            },
          );
          // 4c. Milestone 5 (WO-006): the source adapters' path on the case
          //     the review path left APPROVED. The named synthetic ledger
          //     adapter records read-only references through the server
          //     role; intake records filing receipts at AAL2; the named
          //     synthetic record adapter verifies them read-only.
          const intakeToken = await staffAal2Token('intake.beth@example.invalid', 'source path');
          if (intakeToken) {
            await assertSourcePath(
              {
                rest,
                rpc,
                check,
                uuidV4,
                extraReach,
                extraReachByEmail,
                SCOPE,
                CASES,
                DOCUMENTS,
                sync: () => syncLedgerReferences({ url, serviceKey, gatewayKey, caseKey: 'a1' }),
                verify: () =>
                  verifyFilingReceipts({ url, serviceKey, gatewayKey, caseId: CASES.a1 }),
              },
              {
                intake: { email: 'intake.beth@example.invalid', token: intakeToken },
                intakeAal1: {
                  email: 'intake.beth@example.invalid',
                  token: intakeSession.access_token,
                },
                preparer: { email: identity.email, token: refreshed.access_token },
                client: {
                  email: 'client.owner@example.invalid',
                  token: clientSession.access_token,
                },
                other: { email: 'client.second@example.invalid', token: otherSession.access_token },
              },
            );
          } else {
            check(false, 'source path: intake could not reach AAL2');
          }
          // 4d. Milestone 6 (WO-007): the release controls. The server-role
          //     switch pauses the service (zero rows, refused transitions,
          //     nothing removed) and resumes it; the person asks for their
          //     account to be deleted, replays, withdraws, and asks again.
          await assertReleaseControlsPath(
            {
              rest,
              rpc,
              check,
              uuidV4,
              extraReachByEmail,
              CASES,
              url,
              serviceKey,
              gatewayKey,
              clientKey,
            },
            {
              client: { email: 'client.owner@example.invalid', token: clientSession.access_token },
              other: { email: 'client.second@example.invalid', token: otherSession.access_token },
              staff: { email: identity.email, token: refreshed.access_token },
            },
          );
        } else {
          check(false, 'review path: the sessions it needs are not all available');
        }
        await assertExactReach(
          identity,
          refreshed.access_token,
          REACH.aAndB1,
          'AAL2 (refreshed token)',
        );
      }
      // Repeat login: fresh OTP; the verified factor is discovered from
      // GET /user (the documented factor listing for a session), never
      // remembered from enrollment. On a fast local stack the enrollment,
      // the refresh, and the reach checks finish inside GoTrue's one-second
      // send floor for the same address (auth.email.max_frequency), and the
      // repeat request is refused 429 (find 60, 2026-09-28): wait it out,
      // as step 2 does.
      await sleep(1100);
      const again = await signInWithOtp(identity);
      if (again) {
        const user = await auth('/user', {}, again.access_token);
        const verified = (user.body?.factors ?? []).find(
          (f) => f.factor_type === 'totp' && f.status === 'verified',
        );
        check(Boolean(verified), `${identity.email}: repeat login finds the verified factor`);
        if (verified) {
          const challenge = await auth(
            `/factors/${verified.id}/challenge`,
            { method: 'POST' },
            again.access_token,
          );
          const verify = await auth(
            `/factors/${verified.id}/verify`,
            {
              method: 'POST',
              body: JSON.stringify({
                challenge_id: challenge.body?.id,
                code: totpCode(enrolled.secret),
              }),
            },
            again.access_token,
          );
          const repeatAal =
            verify.status === 200 && verify.body?.access_token
              ? jwtClaims(verify.body.access_token).aal
              : null;
          check(
            repeatAal === 'aal2',
            `${identity.email}: repeat login reaches AAL2 against the existing factor`,
          );
        }
      }
    }
  }
}

// 5. Mixed-role users with real JWTs (area 4): AAL1 zero-rows across all
//    eight protected tables + exact own memberships; AAL2 exact reach and
//    zero wrong-scope rows — all via the refreshed token.
{
  const identity = byEmail.get('mixed.cross@example.invalid');
  await adminCleanFactors(identity);
  const aal1 = await signInWithOtp(identity);
  if (aal1) {
    await assertStaffAal1(identity, aal1);
    const enrolled = await enrollAndVerifyTotp(identity, aal1, `${identity.email} enroll`);
    if (enrolled) {
      const refreshed = await mandatoryRefresh(
        enrolled.session,
        identity,
        'aal2',
        `${identity.email} AAL2`,
      );
      if (refreshed) {
        const token = refreshed.access_token;
        await assertExactReach(identity, token, REACH.aAndB1, 'AAL2');
        const wrongEntity = await rest(`/cases?select=id&entity_id=eq.${SCOPE.entityB2}`, token);
        check(
          wrongEntity.status === 200 && (wrongEntity.body ?? []).length === 0,
          `${identity.email} AAL2: zero rows for the unrelated entity B2`,
        );
        const unrelatedEntity = await rest(`/entities?select=id&id=eq.${SCOPE.entityB2}`, token);
        check(
          unrelatedEntity.status === 200 && (unrelatedEntity.body ?? []).length === 0,
          `${identity.email} AAL2: entity B2 itself stays invisible`,
        );
      }
    }
  }
}
{
  const identity = byEmail.get('mixed.same@example.invalid');
  await adminCleanFactors(identity);
  const aal1 = await signInWithOtp(identity);
  if (aal1) {
    await assertStaffAal1(identity, aal1);
    const enrolled = await enrollAndVerifyTotp(identity, aal1, `${identity.email} enroll`);
    if (enrolled) {
      const refreshed = await mandatoryRefresh(
        enrolled.session,
        identity,
        'aal2',
        `${identity.email} AAL2`,
      );
      if (refreshed) {
        const token = refreshed.access_token;
        await assertExactReach(identity, token, REACH.aOnly, 'AAL2');
        const wrongClient = await rest(`/clients?select=id&id=eq.${SCOPE.clientB}`, token);
        check(
          wrongClient.status === 200 && (wrongClient.body ?? []).length === 0,
          `${identity.email} AAL2: zero rows for the unrelated client B`,
        );
        const wrongEntityCases = await rest(
          `/cases?select=id&entity_id=eq.${SCOPE.entityB1}`,
          token,
        );
        check(
          wrongEntityCases.status === 200 && (wrongEntityCases.body ?? []).length === 0,
          `${identity.email} AAL2: zero case rows for the unrelated entity B1`,
        );
      }
    }
  }
}

// 6. A pure client user's AAL1 refresh also satisfies the refresh
//    contract (sub retained, aal1 retained) — refresh is not AAL2-only.
{
  const identity = byEmail.get('client.owner@example.invalid');
  const session = sessions.get(identity.email);
  if (session) {
    await mandatoryRefresh(session, identity, 'aal1', `${identity.email} AAL1`);
  }
}

// 9. The review tenant (WO-008, option A): seeded on demand, the
//     review identity refused without a window, admitted with the
//     code inside one, reading only its own environment, refused
//     after close, retired at the end.
const reviewTenantTool = (mode) =>
  spawnSync('node', ['scripts/seed-review-tenant.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, HIVE_REVIEW_MODE: mode },
  }).status === 0;
await assertReviewTenantPath({
  rest,
  check,
  uuidV4,
  url,
  clientKey,
  serviceKey,
  gatewayKey,
  seedReview: async () => reviewTenantTool('seed'),
  retireReview: async () => reviewTenantTool('retire'),
});

console.log(`e2e-local-auth: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
