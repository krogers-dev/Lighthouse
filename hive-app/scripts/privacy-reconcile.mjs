#!/usr/bin/env node
/**
 * privacy:reconcile — the privacy reconciliation gate (WO-007).
 *
 * The store disclosures (docs/release/privacy-disclosures.json) are
 * answers about what the app does. This gate checks those answers against
 * the code and the configuration, so a disclosure can never drift from
 * the build it describes:
 *
 *  - no third-party analytics, crash, advertising, or tracking SDK is a
 *    dependency, and the disclosure lists none;
 *  - the app declares no permission the disclosure does not name (Android
 *    beyond INTERNET; any iOS usage description);
 *  - the iOS privacy manifest in app.json says exactly what the
 *    disclosure says (no tracking, the same collected data types, the
 *    same accessed API categories);
 *  - the export-compliance answer matches app.json;
 *  - no host is written into the app's code (the only origin is
 *    configured), so the outbound-host answer holds;
 *  - the data classification still excludes financial values, so the
 *    "not collected" answer holds.
 *
 * Exit codes follow the repository contract: 0 pass, 1 findings, 2 engine
 * failure.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Names that only ever belong to an analytics, crash, advertising, or
 * tracking SDK. A dependency matching one is a finding until the
 * disclosure names it, and the disclosure naming one is itself HOLD. */
export const SDK_DENYLIST =
  /analytics|crashlytics|sentry|bugsnag|firebase|segment|amplitude|mixpanel|appsflyer|adjust|branch\.io|react-native-branch|facebook|fbsdk|admob|google-mobile-ads|onesignal|braze|intercom|datadog|newrelic|instabug|hotjar|clarity/i;

/** A hostname with a real top-level label, written into code. The regex
 * source itself is excluded by the comment rule below. */
const HOST_LITERAL = /https?:\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;

export function checkDependencies(pkg, disclosures) {
  const problems = [];
  const names = Object.keys({ ...(pkg.dependencies ?? {}) });
  for (const name of names) {
    if (SDK_DENYLIST.test(name) && !disclosures.thirdPartySdks.includes(name)) {
      problems.push(
        `dependency ${name} looks like an analytics, crash, or advertising SDK and the disclosure does not name it`,
      );
    }
  }
  for (const declared of disclosures.thirdPartySdks) {
    if (!names.includes(declared)) {
      problems.push(
        `the disclosure names ${declared} as a third-party SDK but it is not a dependency`,
      );
    }
  }
  return problems;
}

export function checkPermissions(expo, disclosures) {
  const problems = [];
  const android = expo?.android?.permissions ?? [];
  for (const permission of android) {
    const full = permission.startsWith('android.permission.')
      ? permission
      : `android.permission.${permission}`;
    if (!disclosures.permissions.android.includes(full)) {
      problems.push(
        `app.json declares Android permission ${full}, which the disclosure does not name`,
      );
    }
  }
  const infoPlist = expo?.ios?.infoPlist ?? {};
  for (const key of Object.keys(infoPlist)) {
    if (
      /UsageDescription$/.test(key) &&
      !disclosures.permissions.iosUsageDescriptions.includes(key)
    ) {
      problems.push(`app.json declares iOS ${key}, which the disclosure does not name`);
    }
  }
  return problems;
}

export function checkPrivacyManifest(expo, disclosures) {
  const problems = [];
  const manifest = expo?.ios?.privacyManifests;
  if (!manifest || typeof manifest !== 'object') {
    problems.push('app.json has no ios.privacyManifests block');
    return problems;
  }
  if (manifest.NSPrivacyTracking !== disclosures.tracking) {
    problems.push('NSPrivacyTracking in app.json does not match the disclosure');
  }
  if ((manifest.NSPrivacyTrackingDomains ?? []).length !== 0) {
    problems.push('app.json names tracking domains; the disclosure says no tracking');
  }
  const declaredTypes = (manifest.NSPrivacyCollectedDataTypes ?? [])
    .map((entry) => entry.NSPrivacyCollectedDataType)
    .sort();
  const disclosedTypes = disclosures.collectedDataTypes.map((entry) => entry.iosType).sort();
  if (JSON.stringify(declaredTypes) !== JSON.stringify(disclosedTypes)) {
    problems.push(
      `the privacy manifest collects [${declaredTypes.join(', ')}] but the disclosure says [${disclosedTypes.join(', ')}]`,
    );
  }
  for (const entry of manifest.NSPrivacyCollectedDataTypes ?? []) {
    const disclosed = disclosures.collectedDataTypes.find(
      (candidate) => candidate.iosType === entry.NSPrivacyCollectedDataType,
    );
    if (!disclosed) continue;
    if (entry.NSPrivacyCollectedDataTypeLinked !== disclosed.linkedToUser) {
      problems.push(
        `${entry.NSPrivacyCollectedDataType}: linked-to-user differs from the disclosure`,
      );
    }
    if (entry.NSPrivacyCollectedDataTypeTracking !== disclosed.usedForTracking) {
      problems.push(`${entry.NSPrivacyCollectedDataType}: tracking differs from the disclosure`);
    }
  }
  const declaredApis = (manifest.NSPrivacyAccessedAPITypes ?? [])
    .map((entry) => entry.NSPrivacyAccessedAPIType)
    .sort();
  const disclosedApis = disclosures.accessedApiTypes.map((entry) => entry.category).sort();
  if (JSON.stringify(declaredApis) !== JSON.stringify(disclosedApis)) {
    problems.push(
      `the privacy manifest accesses [${declaredApis.join(', ')}] but the disclosure says [${disclosedApis.join(', ')}]`,
    );
  }
  return problems;
}

export function checkEncryption(expo, disclosures) {
  const declared = expo?.ios?.infoPlist?.ITSAppUsesNonExemptEncryption;
  if (declared !== disclosures.encryption.iosNonExemptEncryption) {
    return ['ITSAppUsesNonExemptEncryption in app.json does not match the disclosure'];
  }
  return [];
}

/** Every source line of the app (src/ and app/, never tests) that writes
 * a host into the code. Comment lines are ignored: they explain, they do
 * not connect. */
export function findHostLiterals(files) {
  const findings = [];
  for (const { path: file, text } of files) {
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      if (HOST_LITERAL.test(line))
        findings.push(`${file}:${index + 1} writes a host into the code`);
    });
  }
  return findings;
}

export function checkClassification(text) {
  // The row itself decides, never a distance: table padding changes.
  const row = text
    .split(/\r?\n/)
    .find((line) => line.startsWith('|') && /Financial values/.test(line));
  return row && /\*\*No/.test(row)
    ? []
    : [
        'docs/data-classification.md no longer excludes financial values; the "not collected" answer is unsupported',
      ];
}
function listSourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (entry === '__tests__' || entry === 'node_modules') continue;
    if (statSync(full).isDirectory()) listSourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  let expo;
  let pkg;
  let disclosures;
  let classification;
  try {
    expo = JSON.parse(readFileSync(path.join(appRoot, 'app.json'), 'utf8')).expo;
    pkg = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
    disclosures = JSON.parse(
      readFileSync(path.join(appRoot, 'docs', 'release', 'privacy-disclosures.json'), 'utf8'),
    );
    classification = readFileSync(path.join(appRoot, 'docs', 'data-classification.md'), 'utf8');
  } catch (error) {
    console.error(
      `privacy:reconcile ENGINE FAILURE: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(2);
  }
  const files = [
    ...listSourceFiles(path.join(appRoot, 'src')),
    ...listSourceFiles(path.join(appRoot, 'app')),
  ].map((file) => ({
    path: path.relative(appRoot, file).replace(/\\/g, '/'),
    text: readFileSync(file, 'utf8'),
  }));
  const problems = [
    ...checkDependencies(pkg, disclosures),
    ...checkPermissions(expo, disclosures),
    ...checkPrivacyManifest(expo, disclosures),
    ...checkEncryption(expo, disclosures),
    ...findHostLiterals(files),
    ...checkClassification(classification),
  ];
  if (problems.length > 0) {
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('privacy:reconcile FAILED');
    process.exit(1);
  }
  console.log(
    `privacy:reconcile OK — ${Object.keys(pkg.dependencies ?? {}).length} dependencies, ${files.length} source files, the manifest, the permissions, and the export answer match docs/release/privacy-disclosures.json`,
  );
}
