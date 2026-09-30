/** The hosted projects the operator tooling may reach (WO-011): the
 * reviewed manifest `security/hosted-targets.json`, the rules that decide
 * whether a command may run against one of them, and the handling of the
 * keys the Supabase CLI returns. Pure and unit-tested
 * (tests/scripts/hosted-operator.test.mjs); nothing here touches the
 * network or prints a key.
 *
 * Two rules live in this code and cannot be relaxed from the manifest: a
 * change on production needs the project ref repeated by the operator, and
 * the black-box proof never runs on production. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const HOSTED_MANIFEST_PATH = path.join(appRoot, 'security', 'hosted-targets.json');

const TARGET_NAMES = ['staging', 'production'];
const PROJECT_REF = /^[a-z]{20}$/;
const ENVIRONMENT_NAME = /^[a-z][a-z0-9-]{1,39}$/;
const DOMAIN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
const ADDRESS = /^[a-z0-9][a-z0-9._-]*@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/;
const SECRET_KEY = /^sb_secret_[A-Za-z0-9_-]{20,}$/;
const PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]{20,}$/;

/** What reads and what changes. A command in neither set is refused: an
 * unknown command is never treated as a read. */
export const READ_COMMANDS = new Set([
  'review-window-status',
  'service-status',
  'list-entities',
  'list-access',
  'quarantine-status',
]);
export const CHANGE_COMMANDS = new Set([
  'seed-review',
  'retire-review',
  'open-review-window',
  'close-review-window',
  'sweep-review-window',
  'check-review-sign-in',
  'pause-service',
  'resume-service',
  'onboard-entity',
  'invite',
  'revoke-access',
  'sweep-uploads',
]);
export const PROOF_COMMAND = 'prove-review';

const KEY_SHAPES = [
  /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}/g,
  /sb_secret_[A-Za-z0-9_·.*-]+/g,
  /sb_publishable_[A-Za-z0-9_-]+/g,
  /-----BEGIN[^-]*-----[\s\S]*?-----END[^-]*-----/g,
];

/** Strips every key shape from text that is about to be shown. */
export function redactKeys(text) {
  let out = String(text ?? '');
  for (const pattern of KEY_SHAPES) out = out.replace(pattern, '[redacted]');
  return out;
}

function looksKeyShaped(value) {
  return redactKeys(value) !== value;
}

function everyString(value, visit) {
  if (typeof value === 'string') visit(value);
  else if (Array.isArray(value)) for (const item of value) everyString(item, visit);
  else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) everyString(item, visit);
  }
}

/** Every reason the manifest is not acceptable, in words; empty when it
 * is. A problem never quotes a value that looked like a key. */
export function manifestProblems(manifest) {
  const problems = [];
  if (!manifest || typeof manifest !== 'object' || !manifest.targets) {
    return ['the manifest has no targets'];
  }
  const domain = manifest.reviewEmailDomain;
  if (typeof domain !== 'string' || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain)) {
    problems.push('the manifest names no review address domain');
  }
  const names = Object.keys(manifest.targets);
  for (const name of TARGET_NAMES) {
    if (!names.includes(name)) problems.push(`the manifest has no ${name} target`);
  }
  for (const name of names) {
    if (!TARGET_NAMES.includes(name)) {
      problems.push(`the manifest lists a target this tooling does not know: ${name}`);
      continue;
    }
    const target = manifest.targets[name];
    if (!target || typeof target !== 'object') {
      problems.push(`${name}: not an object`);
      continue;
    }
    if (typeof target.projectRef !== 'string' || !PROJECT_REF.test(target.projectRef)) {
      problems.push(`${name}: the project ref is not twenty lowercase letters`);
    } else if (target.origin !== `https://${target.projectRef}.supabase.co`) {
      problems.push(`${name}: the origin is not the project's own https origin`);
    }
    const address =
      typeof target.reviewEmail === 'string' ? ADDRESS.exec(target.reviewEmail) : null;
    if (
      !address ||
      address[1] !== domain ||
      /\.(?:invalid|example|test|localhost)$/.test(address[1])
    ) {
      problems.push(
        `${name}: the review address must be a mailbox on the manifest's review address domain`,
      );
    }
    const environment = target.environment;
    if (
      !environment ||
      typeof environment.name !== 'string' ||
      !ENVIRONMENT_NAME.test(environment.name) ||
      !['development', 'staging', 'production'].includes(environment.kind)
    ) {
      problems.push(`${name}: the environment needs a name and a kind`);
    }
    if (
      !Array.isArray(target.staffEmailDomains) ||
      target.staffEmailDomains.length === 0 ||
      !target.staffEmailDomains.every((d) => typeof d === 'string' && DOMAIN.test(d))
    ) {
      problems.push(`${name}: staffEmailDomains must list at least one domain`);
    }
    if (typeof target.allowSyntheticAddresses !== 'boolean') {
      problems.push(`${name}: allowSyntheticAddresses must be true or false`);
    }
    if (name === 'production') {
      // The code's rule, not the manifest's: production is the production
      // environment, takes no synthetic address, and staffs only from the
      // review address domain.
      if (
        environment?.kind !== 'production' ||
        target.allowSyntheticAddresses !== false ||
        !Array.isArray(target.staffEmailDomains) ||
        target.staffEmailDomains.some((d) => d !== domain)
      ) {
        problems.push(
          'production: must be the production environment, admit no synthetic address, and staff only from the review address domain',
        );
      }
    }
    if (typeof target.confirmChanges !== 'boolean' || typeof target.allowProof !== 'boolean') {
      problems.push(`${name}: confirmChanges and allowProof must be true or false`);
    }
  }
  const refs = TARGET_NAMES.map((name) => manifest.targets[name]?.projectRef).filter(Boolean);
  if (new Set(refs).size !== refs.length) {
    problems.push('staging and production name the same project');
  }
  let keyed = false;
  everyString(manifest, (value) => {
    if (looksKeyShaped(value)) keyed = true;
  });
  if (keyed) problems.push('the manifest holds a key-shaped value; nothing in it may be a key');
  return problems;
}

/** Reads and checks the manifest; throws with every problem when it is
 * not acceptable. */
export function loadHostedManifest(file = HOSTED_MANIFEST_PATH) {
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  const problems = manifestProblems(manifest);
  if (problems.length > 0) {
    throw new Error(`security/hosted-targets.json is not acceptable: ${problems.join('; ')}`);
  }
  return manifest;
}

/** One of the two named targets, spelled exactly, or an error. */
export function resolveHostedTarget(manifest, name) {
  if (
    typeof name !== 'string' ||
    !TARGET_NAMES.includes(name) ||
    !Object.hasOwn(manifest?.targets ?? {}, name)
  ) {
    return { error: `"${String(name ?? '')}" is not a hosted target (staging or production)` };
  }
  return { name, target: manifest.targets[name] };
}

/** Whether a URL is exactly the target's origin: scheme, host, and port
 * compared after parsing, with no credentials, path, query, or fragment. */
export function originMatches(candidate, target) {
  if (typeof candidate !== 'string' || candidate === '') return false;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }
  return (
    parsed.origin === target.origin &&
    parsed.username === '' &&
    parsed.password === '' &&
    (parsed.pathname === '/' || parsed.pathname === '') &&
    parsed.search === '' &&
    parsed.hash === ''
  );
}

/** Null when the command may run; otherwise why not. A read needs
 * nothing. A change on production, or on any target whose manifest entry
 * asks for it, needs the project ref repeated. An unknown command is
 * refused. */
export function confirmationError(name, target, command, confirm) {
  if (READ_COMMANDS.has(command)) return null;
  if (!CHANGE_COMMANDS.has(command) && command !== PROOF_COMMAND) {
    return `"${command}" is not a command this tooling runs against a hosted project`;
  }
  const required = name === 'production' || target?.confirmChanges === true;
  if (!required) return null;
  if (typeof confirm === 'string' && confirm !== '' && confirm === target.projectRef) return null;
  return `${command} changes ${name}: repeat its project ref to go on (--confirm ${target.projectRef})`;
}

/** The black-box proof sets passwords and opens and closes windows, so it
 * runs only where the manifest allows it and never on production. */
export function proofAllowed(name, target) {
  return name !== 'production' && target?.allowProof === true;
}

export function isSecretKeyShape(value) {
  return typeof value === 'string' && SECRET_KEY.test(value);
}

export function isPublishableKeyShape(value) {
  return typeof value === 'string' && PUBLISHABLE_KEY.test(value);
}

/** From `supabase projects api-keys --reveal -o json`: the project's
 * secret key (the new kind, never the legacy service-role token) and its
 * publishable key. An error never repeats any part of the input. */
export function selectProjectKeys(jsonText) {
  let entries;
  try {
    entries = JSON.parse(jsonText);
  } catch {
    return { error: 'the CLI did not answer with JSON' };
  }
  if (!Array.isArray(entries)) return { error: 'the CLI did not answer with a list of keys' };
  const pick = (type, accepts) => {
    const candidates = entries.filter(
      (entry) => entry && entry.type === type && accepts(entry.api_key),
    );
    return (candidates.find((entry) => entry.name === 'default') ?? candidates[0])?.api_key;
  };
  const secretKey = pick('secret', isSecretKeyShape);
  if (!secretKey) {
    return {
      error:
        'the CLI returned no revealed secret key for this project (the new secret key is required; a masked value or the legacy service-role token is not used)',
    };
  }
  const clientKey = pick('publishable', isPublishableKeyShape);
  if (!clientKey) return { error: 'the CLI returned no publishable key for this project' };
  return { secretKey, clientKey };
}

/** Containment by path, not by string prefix. */
export function isInsideDirectory(file, directory) {
  const relative = path.relative(path.resolve(directory), path.resolve(file));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Where a hosted target's review code lives: the file the operator named,
 * else one per target in the approvals folder. Never inside the
 * repository, whose root is the app directory's parent. */
export function reviewCodeFileFor(name, env, appDirectory = appRoot) {
  const named = env.HIVE_REVIEW_CODE_FILE ?? '';
  const home = env.USERPROFILE ?? env.HOME ?? '';
  if (named === '' && home === '') {
    return {
      error: 'no home directory to keep the review code in; name a file with HIVE_REVIEW_CODE_FILE',
    };
  }
  const file = named !== '' ? named : path.join(home, 'HIVE-approvals', `review-code-${name}.txt`);
  if (isInsideDirectory(file, path.resolve(appDirectory, '..'))) {
    return { error: 'the review code file is inside the repository; keep it outside' };
  }
  return { file };
}
