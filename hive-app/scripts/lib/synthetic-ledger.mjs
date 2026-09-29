/** HiveSyntheticLedger — the NAMED synthetic ledger adapter for the local
 * lanes (WO-006). Production-inert: no live adapter exists, integrations
 * are HOLD, and every row this adapter records carries its name.
 *
 * The adapter contract a real QuickBooks Online adapter must meet before
 * a separate adapter PASS (PRODUCT.md, Milestone 5):
 *
 *   name                                   a fixed, printable identifier
 *   fetchLedgerObject(realm, type, id)     -> { objectType, objectId,
 *                                              objectVersion, displayName,
 *                                              asOf, digest } | null
 *   listObjectsFor(caseKey)                -> the references a case is
 *                                              entitled to, as the same shape
 *
 * Read-only by construction: the contract has no write. `digest` is
 * SHA-256 over the canonical text of what was read, so a reference names
 * exactly one state of one object; `displayName` is the object's own
 * label, bounded and printable, never a value; amounts, balances, and
 * account numbers are not part of the contract at all (data
 * classification: financial values excluded).
 *
 * Fixtures below are fictional and marked "(Synthetic)"; the realm id
 * names the seeded entity; digests derive from the fixture text.
 */
import { createHash } from 'node:crypto';

export const SYNTHETIC_LEDGER_NAME = 'HiveSyntheticLedger';

/** One synthetic realm per seeded entity that carries a case. */
export const SYNTHETIC_REALMS = {
  a1: 'realm-synthetic-a1',
};

const FIXED_AS_OF = '2026-09-28T12:00:00Z';

function digestOf(realm, objectType, objectId, objectVersion) {
  return createHash('sha256')
    .update(`HIVE synthetic ledger object: ${realm}/${objectType}/${objectId}@${objectVersion}`)
    .digest('hex');
}

function object(realm, objectType, objectId, objectVersion, displayName) {
  return {
    objectType,
    objectId,
    objectVersion,
    displayName,
    asOf: FIXED_AS_OF,
    digest: digestOf(realm, objectType, objectId, objectVersion),
  };
}

/** The synthetic ledger's contents, by realm. Object ids are opaque
 * synthetic identifiers, deliberately unlike any account number. */
const FIXTURES = {
  [SYNTHETIC_REALMS.a1]: [
    object(
      SYNTHETIC_REALMS.a1,
      'Account',
      'acct-synthetic-operating',
      '3',
      'Operating account (Synthetic)',
    ),
    object(
      SYNTHETIC_REALMS.a1,
      'JournalEntry',
      'je-synthetic-2025-close',
      '2',
      'Year-end close entry (Synthetic)',
    ),
    object(
      SYNTHETIC_REALMS.a1,
      'Report',
      'report-synthetic-pl-2025',
      '1',
      'Profit and loss 2025 (Synthetic)',
    ),
  ],
};

/** Which seeded case reads which realm. */
export const CASE_REALMS = {
  a1: { caseId: 'eeeeeeee-0000-4000-8000-0000000000a1', realm: SYNTHETIC_REALMS.a1 },
};

export const HiveSyntheticLedger = {
  name: SYNTHETIC_LEDGER_NAME,

  async fetchLedgerObject(realm, objectType, objectId) {
    const found = (FIXTURES[realm] ?? []).find(
      (entry) => entry.objectType === objectType && entry.objectId === objectId,
    );
    return found ? { ...found } : null;
  },

  async listObjectsFor(caseKey) {
    const target = CASE_REALMS[caseKey];
    if (!target)
      throw new Error(`HiveSyntheticLedger: unknown case key ${JSON.stringify(caseKey)}`);
    return (FIXTURES[target.realm] ?? []).map((entry) => ({ ...entry }));
  },
};
