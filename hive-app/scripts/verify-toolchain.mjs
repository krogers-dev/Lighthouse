#!/usr/bin/env node
/**
 * verify:toolchain — fails when the running toolchain does not match the
 * recorded pins exactly: Node, npm, Expo, React Native, React, Expo Doctor,
 * and the Supabase CLI. Run in every verification cycle.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(appRoot, relativePath), 'utf8'));
}

function installedVersion(packageName) {
  try {
    return readJson(path.join('node_modules', packageName, 'package.json')).version;
  } catch {
    return null;
  }
}

function commandVersion(command, args, parse) {
  try {
    const out = execFileSync(command, args, {
      cwd: appRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return parse(out.trim());
  } catch {
    return null;
  }
}

const pkg = readJson('package.json');
const nodePin = readFileSync(path.join(appRoot, '.node-version'), 'utf8').trim();
const npmPin = (pkg.packageManager ?? '').replace(/^npm@/, '');

const failures = [];
const results = [];

function check(name, expected, actual) {
  const ok = expected === actual;
  results.push(
    `${ok ? 'ok  ' : 'FAIL'} ${name}: expected ${expected}, found ${actual ?? 'missing'}`,
  );
  if (!ok) failures.push(name);
}

check('node (.node-version)', nodePin, process.version.replace(/^v/, ''));
check('node (engines)', pkg.engines?.node, process.version.replace(/^v/, ''));
check(
  'npm (packageManager)',
  npmPin,
  commandVersion('npm', ['--version'], (v) => v),
);
check('expo', pkg.dependencies?.expo, installedVersion('expo'));
check('react-native', pkg.dependencies?.['react-native'], installedVersion('react-native'));
check('react', pkg.dependencies?.react, installedVersion('react'));
check('expo-doctor', pkg.devDependencies?.['expo-doctor'], installedVersion('expo-doctor'));
check('supabase CLI (package)', pkg.devDependencies?.supabase, installedVersion('supabase'));
check(
  'supabase CLI (executable)',
  pkg.devDependencies?.supabase,
  commandVersion('npx', ['--no-install', 'supabase', '--version'], (v) => v.split(/\s+/)[0]),
);
check(
  '@supabase/supabase-js',
  pkg.dependencies?.['@supabase/supabase-js'],
  installedVersion('@supabase/supabase-js'),
);
check('typescript', pkg.devDependencies?.typescript, installedVersion('typescript'));

console.log(results.join('\n'));

if (failures.length > 0) {
  console.error(`\nverify:toolchain FAILED for: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nverify:toolchain OK');
