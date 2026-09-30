/** Which stack an operator tool is talking to, and with what (WO-011).
 *
 * Two lanes and nothing between them:
 *
 *   local   the loopback stack, handed over by scripts/local-supabase.mjs
 *           in HIVE_LOCAL_*; any other host is refused, as it always was.
 *   hosted  one of the two projects named in security/hosted-targets.json,
 *           handed over by scripts/hosted-supabase.mjs in HIVE_HOSTED_*.
 *           The URL must be that target's approved origin exactly, and the
 *           key must be the project's new secret key, which the hosted
 *           gateway accepts for both headers. A hosted target never reads
 *           the local variables, so a stale local environment cannot send
 *           a command somewhere else.
 *
 * The tool that resolves the context checks it again for itself: the
 * runner's checks are not the only ones. Pure and unit-tested
 * (tests/scripts/hosted-operator.test.mjs). */
import {
  confirmationError,
  isSecretKeyShape,
  originMatches,
  resolveHostedTarget,
} from './hosted-targets.mjs';
import { REVIEW_TENANT } from './review-tenant.mjs';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function resolveOperatorContext(env, manifest) {
  const hostedName = env.HIVE_HOSTED_TARGET ?? '';
  if (hostedName !== '') {
    const resolved = resolveHostedTarget(manifest, hostedName);
    if (resolved.error) return { error: resolved.error };
    const { target } = resolved;
    if (!originMatches(env.HIVE_HOSTED_SUPABASE_URL, target)) {
      return {
        error: `the URL handed over for ${hostedName} is not its approved origin (security/hosted-targets.json)`,
      };
    }
    const secretKey = env.HIVE_HOSTED_SECRET_KEY;
    if (!isSecretKeyShape(secretKey)) {
      return {
        error: `no secret key of the expected kind was handed over for ${hostedName}; run through scripts/hosted-supabase.mjs`,
      };
    }
    return {
      kind: 'hosted',
      name: hostedName,
      target,
      url: target.origin,
      serviceKey: secretKey,
      gatewayKey: secretKey,
      clientKey: env.HIVE_HOSTED_CLIENT_KEY ?? '',
      reviewEmail: target.reviewEmail,
      confirm: env.HIVE_HOSTED_CONFIRM ?? '',
    };
  }

  const url = env.HIVE_LOCAL_SUPABASE_URL ?? '';
  const serviceKey = env.HIVE_LOCAL_SERVICE_KEY ?? '';
  if (url === '' || serviceKey === '') {
    return {
      error:
        'no stack was handed over; run through scripts/local-supabase.mjs, or scripts/hosted-supabase.mjs for a hosted project',
    };
  }
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { error: 'the URL handed over is not a URL' };
  }
  if (!LOOPBACK_HOSTS.has(hostname)) {
    return { error: 'refusing a non-loopback URL that is not a named hosted target' };
  }
  return {
    kind: 'loopback',
    name: 'local',
    target: null,
    url,
    serviceKey,
    gatewayKey: env.HIVE_LOCAL_GATEWAY_KEY ?? serviceKey,
    clientKey: env.HIVE_LOCAL_CLIENT_KEY ?? '',
    reviewEmail: REVIEW_TENANT.identity.email,
    confirm: '',
  };
}

/** Null when this context may run the command; otherwise why not. The
 * local lane changes freely; a hosted change follows the target's rule. */
export function changeRefusal(context, command) {
  if (context.kind !== 'hosted') return null;
  return confirmationError(context.name, context.target, command, context.confirm);
}
