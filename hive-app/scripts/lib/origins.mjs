/** Exact-origin URL comparison (RETURN-4 P1-4). String-prefix matching
 * accepted `https://approved.supabase.co.evil.example` for an approved
 * `https://approved.supabase.co`; parsing and comparing normalized
 * origins closes that class. */

/** Parse a URL and return its exact origin descriptor, or null when the
 * value is not a clean absolute URL. Rejects userinfo outright. */
export function parseOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username !== '' || url.password !== '') return null;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // A malformed port would have thrown in the constructor; an empty port
  // means the scheme default.
  const port = url.port !== '' ? url.port : url.protocol === 'https:' ? '443' : '80';
  return { protocol: url.protocol, hostname: url.hostname, port };
}

/** True when `candidate` is a URL whose exact origin equals `approved`'s
 * exact origin. Approved values must themselves be clean origins: no
 * userinfo, no path beyond '/', no query, no fragment. */
export function originMatchesApproved(candidate, approved) {
  const approvedParsed = approvedOrigin(approved);
  if (approvedParsed === null) return false;
  const candidateParsed = parseOrigin(candidate);
  if (candidateParsed === null) return false;
  return (
    candidateParsed.protocol === approvedParsed.protocol &&
    candidateParsed.hostname === approvedParsed.hostname &&
    candidateParsed.port === approvedParsed.port
  );
}

/** Validate an APPROVED configuration value: a clean absolute origin with
 * no userinfo, no meaningful path, no query, no fragment. */
export function approvedOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username !== '' || url.password !== '') return null;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  if (url.search !== '' || url.hash !== '') return null;
  return parseOrigin(value);
}

/** Exact loopback host check for development URLs: the hostname itself
 * must BE a loopback name, not merely start with one
 * (`http://127.0.0.1.evil.example` is not loopback). */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '10.0.2.2']);
export function isLoopbackUrl(value) {
  const parsed = parseOrigin(value);
  if (parsed === null) return false;
  return LOOPBACK_HOSTS.has(parsed.hostname);
}
