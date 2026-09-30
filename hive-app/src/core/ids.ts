/** Opaque, branded identifier types.
 *
 * Scope identifiers (environment, client, entity) are the security boundary
 * of the whole system, so they are never plain strings in app code: a value
 * must pass shape validation at the edge before it can inhabit one of these
 * types, and the brands stop a client id from being passed where an entity
 * id belongs.
 */

declare const brandSymbol: unique symbol;

export type Opaque<TBrand extends string> = string & { readonly [brandSymbol]: TBrand };

export type EnvironmentId = Opaque<'environment-id'>;
export type ClientId = Opaque<'client-id'>;
export type EntityId = Opaque<'entity-id'>;
export type MembershipId = Opaque<'membership-id'>;
export type UserId = Opaque<'user-id'>;
export type CaseId = Opaque<'case-id'>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InvalidIdError extends Error {
  constructor(readonly kind: string) {
    // Deliberately does not echo the rejected value: forged identifiers must
    // not travel through error text into logs or UI.
    super(`Invalid ${kind} identifier`);
    this.name = 'InvalidIdError';
  }
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function asId<T extends Opaque<string>>(kind: string, value: string): T {
  if (!isUuid(value)) {
    throw new InvalidIdError(kind);
  }
  return value.toLowerCase() as T;
}

export const asEnvironmentId = (v: string): EnvironmentId => asId('environment', v);
export const asClientId = (v: string): ClientId => asId('client', v);
export const asEntityId = (v: string): EntityId => asId('entity', v);
export const asMembershipId = (v: string): MembershipId => asId('membership', v);
export const asUserId = (v: string): UserId => asId('user', v);
export const asCaseId = (v: string): CaseId => asId('case', v);

export interface RandomSource {
  fill(bytes: Uint8Array<ArrayBuffer>): void;
}

export const cryptoRandomSource: RandomSource = {
  fill(bytes: Uint8Array<ArrayBuffer>): void {
    const c = globalThis.crypto;
    if (!c || typeof c.getRandomValues !== 'function') {
      throw new Error('Secure random source unavailable');
    }
    c.getRandomValues(bytes);
  },
};

/** An RFC 4122 version-4 UUID from the random source: an idempotency key
 * the phone makes once per attempt (WO-003). Never an identifier the
 * server would accept as scope. */
export function newUuid(source: RandomSource = cryptoRandomSource): string {
  const bytes = new Uint8Array(new ArrayBuffer(16));
  source.fill(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Non-identifying random token (install marker, correlation ids). */
export function newOpaqueToken(byteLength = 16, source: RandomSource = cryptoRandomSource): string {
  const bytes = new Uint8Array(new ArrayBuffer(byteLength));
  source.fill(bytes);
  let out = '';
  for (const b of bytes) {
    out += b.toString(16).padStart(2, '0');
  }
  return out;
}
