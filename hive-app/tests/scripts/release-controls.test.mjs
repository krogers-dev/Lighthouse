import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COUNTED_TABLES,
  compareCounts,
  countsQuery,
  parseCounts,
} from '../../scripts/backup-drill.mjs';
import { checkReleaseContacts } from '../../scripts/candidate-config-check.mjs';
import {
  SDK_DENYLIST,
  checkClassification,
  checkDependencies,
  checkEncryption,
  checkPermissions,
  checkPrivacyManifest,
  findHostLiterals,
} from '../../scripts/privacy-reconcile.mjs';
import {
  SERVICE_REASONS,
  SERVICE_STATES,
  readServiceState,
  setServiceState,
} from '../../scripts/lib/service-state.mjs';

function fakeFetch(answer) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({
      url: String(url),
      method: options.method ?? 'GET',
      body,
      headers: options.headers,
    });
    const reply = answer(calls.length, String(url), body);
    return {
      ok: reply.status < 400,
      status: reply.status,
      text: async () => JSON.stringify(reply.body),
    };
  };
  return { fetchImpl, calls };
}

test('the service switch speaks to the server-role interface with a key, and refuses bad input before any call', async () => {
  const { fetchImpl, calls } = fakeFetch((n, url, body) => ({
    status: 200,
    body: url.endsWith('/service_status_read')
      ? { state: 'open', reason_code: 'none', min_app_version: '0.0.0', version: 1 }
      : {
          state: body.p_state,
          reason_code: body.p_reason_code,
          min_app_version: body.p_min_app_version,
          version: 2,
          replayed: false,
        },
  }));
  const base = {
    url: 'http://127.0.0.1:54321',
    serviceKey: 'service-bearer-in-memory',
    gatewayKey: 'issued',
    fetchImpl,
  };
  const read = await readServiceState(base);
  assert.equal(read.ok, true);
  assert.equal(read.status.state, 'open');
  const paused = await setServiceState({
    ...base,
    state: 'paused',
    reasonCode: 'incident',
    idempotencyKey: 'k-1',
  });
  assert.equal(paused.ok, true);
  assert.equal(paused.status.state, 'paused');
  assert.equal(calls[1].url, 'http://127.0.0.1:54321/rest/v1/rpc/set_service_state');
  assert.deepEqual(calls[1].body, {
    p_state: 'paused',
    p_reason_code: 'incident',
    p_min_app_version: '0.0.0',
    p_idempotency_key: 'k-1',
  });
  assert.equal(calls[1].headers.Authorization, 'Bearer service-bearer-in-memory');
  assert.equal(calls[1].headers.apikey, 'issued');
  const resumed = await setServiceState({ ...base, state: 'open' });
  assert.equal(resumed.status.reason_code, 'none');
  assert.deepEqual(SERVICE_STATES, ['open', 'paused']);
  assert.deepEqual(SERVICE_REASONS, ['none', 'maintenance', 'incident']);
  const badState = await setServiceState({ ...base, state: 'closed' });
  assert.equal(badState.ok, false);
  const badVersion = await setServiceState({ ...base, state: 'open', minAppVersion: '1.0' });
  assert.equal(badVersion.ok, false);
  const remote = await setServiceState({
    ...base,
    url: 'https://db.example.invalid',
    state: 'open',
  });
  assert.equal(remote.ok, false);
  assert.match(remote.problems[0], /non-loopback/);
  assert.equal(calls.length, 3, 'refused inputs never reach the server');
});

test('the backup drill counts every protected table, the audit history, and the release controls, and names any difference', () => {
  assert.ok(COUNTED_TABLES.includes('audit_receipts'));
  assert.ok(COUNTED_TABLES.includes('service_status_changes'));
  assert.ok(COUNTED_TABLES.includes('account_deletion_requests'));
  assert.equal(COUNTED_TABLES.length, 21);
  assert.ok(
    countsQuery().includes(
      "select 'audit_receipts' as table_name, count(*)::int as rows from public.audit_receipts",
    ),
  );
  const source = parseCounts('cases|3\naudit_receipts|12\nrequests|4\n');
  assert.equal(source.get('cases'), 3);
  const restored = parseCounts('cases|3\naudit_receipts|11\nrequests|4\n');
  const problems = compareCounts(source, restored);
  assert.ok(problems.includes('audit_receipts: 12 row(s) in the source, 11 restored'));
  assert.ok(problems.some((p) => p.startsWith('environments: missing')));
  const full = new Map(COUNTED_TABLES.map((table) => [table, 1]));
  assert.deepEqual(compareCounts(full, new Map(full)), []);
});

test('the release contacts are required and never reserved in a release configuration, and unconstrained in development', () => {
  assert.deepEqual(checkReleaseContacts({}, 'development'), []);
  const missing = checkReleaseContacts({}, 'release');
  assert.equal(missing.length, 2);
  assert.ok(missing.every((p) => p.includes('HOLD')));
  const reserved = checkReleaseContacts(
    {
      EXPO_PUBLIC_SUPPORT_EMAIL: 'team@example.invalid',
      EXPO_PUBLIC_DELETION_INFO_URL: 'https://hive.test/delete',
    },
    'release',
  );
  assert.equal(reserved.length, 2);
  assert.ok(reserved.every((p) => p.includes('reserved')));
  const malformed = checkReleaseContacts(
    {
      EXPO_PUBLIC_SUPPORT_EMAIL: 'call us',
      EXPO_PUBLIC_DELETION_INFO_URL: 'http://honeybee-synthetic.co/delete',
    },
    'release',
  );
  assert.equal(malformed.length, 2);
  assert.deepEqual(
    checkReleaseContacts(
      {
        EXPO_PUBLIC_SUPPORT_EMAIL: 'hive@honeybee-synthetic.co',
        EXPO_PUBLIC_DELETION_INFO_URL: 'https://honeybee-synthetic.co/hive/delete',
      },
      'release',
    ),
    [],
  );
});

test('the privacy reconciliation catches an SDK, a permission, a manifest drift, an export drift, a written host, and a lost exclusion', () => {
  const disclosures = {
    tracking: false,
    thirdPartySdks: [],
    collectedDataTypes: [
      {
        iosType: 'NSPrivacyCollectedDataTypeEmailAddress',
        linkedToUser: true,
        usedForTracking: false,
      },
    ],
    permissions: { android: ['android.permission.INTERNET'], iosUsageDescriptions: [] },
    encryption: { iosNonExemptEncryption: false },
    accessedApiTypes: [],
  };
  assert.ok(SDK_DENYLIST.test('@sentry/react-native'));
  assert.ok(SDK_DENYLIST.test('react-native-firebase-analytics'));
  assert.ok(!SDK_DENYLIST.test('expo-router'));
  assert.deepEqual(checkDependencies({ dependencies: { 'expo-router': '1' } }, disclosures), []);
  assert.equal(
    checkDependencies({ dependencies: { '@sentry/react-native': '1' } }, disclosures).length,
    1,
  );
  assert.equal(
    checkDependencies(
      { dependencies: {} },
      { ...disclosures, thirdPartySdks: ['@segment/analytics-react-native'] },
    ).length,
    1,
  );

  const expo = {
    ios: {
      infoPlist: { ITSAppUsesNonExemptEncryption: false },
      privacyManifests: {
        NSPrivacyTracking: false,
        NSPrivacyTrackingDomains: [],
        NSPrivacyCollectedDataTypes: [
          {
            NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeEmailAddress',
            NSPrivacyCollectedDataTypeLinked: true,
            NSPrivacyCollectedDataTypeTracking: false,
          },
        ],
        NSPrivacyAccessedAPITypes: [],
      },
    },
    android: {},
  };
  assert.deepEqual(checkPermissions(expo, disclosures), []);
  assert.equal(
    checkPermissions({ ...expo, android: { permissions: ['CAMERA'] } }, disclosures).length,
    1,
  );
  assert.equal(
    checkPermissions(
      { ...expo, ios: { ...expo.ios, infoPlist: { NSCameraUsageDescription: 'x' } } },
      disclosures,
    ).length,
    1,
  );
  assert.deepEqual(checkPrivacyManifest(expo, disclosures), []);
  assert.equal(
    checkPrivacyManifest(
      { ios: { privacyManifests: { ...expo.ios.privacyManifests, NSPrivacyTracking: true } } },
      disclosures,
    ).length,
    1,
  );
  assert.equal(checkPrivacyManifest({ ios: {} }, disclosures).length, 1);
  assert.deepEqual(checkEncryption(expo, disclosures), []);
  assert.equal(
    checkEncryption({ ios: { infoPlist: { ITSAppUsesNonExemptEncryption: true } } }, disclosures)
      .length,
    1,
  );

  const files = [
    { path: 'src/a.ts', text: '// see https://docs.example.com/x\nconst url = env.supabaseUrl;\n' },
    { path: 'src/b.ts', text: "const leak = 'https://api.example.com/v1';\n" },
  ];
  const findings = findHostLiterals(files);
  assert.deepEqual(findings, ['src/b.ts:1 writes a host into the code']);
  assert.deepEqual(checkClassification('| Financial values | amounts | **No — excluded** |'), []);
  assert.equal(checkClassification('| Financial values | amounts | Yes |').length, 1);
});
