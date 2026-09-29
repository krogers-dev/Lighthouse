/** HiveSyntheticDrive — the NAMED synthetic permanent-record adapter for
 * the local lanes (WO-006). Production-inert: no live adapter exists,
 * integrations are HOLD, and every receipt this adapter verifies carries
 * its name.
 *
 * The adapter contract a real Google Drive adapter must meet before a
 * separate adapter PASS (PRODUCT.md, Milestone 5):
 *
 *   name                        a fixed, printable identifier
 *   checkFile(fileId)           -> { found: true, digest, path }
 *                                | { found: false }
 *
 * Read-only by construction: the contract has no write, no move, no
 * delete, and no share. HIVE never mutates the record; a person files by
 * hand and records a receipt, and this check says whether the record
 * holds exactly the bytes the receipt claims (`digest` is SHA-256 over
 * the object's bytes, the same digest the document carries).
 *
 * Fixtures below are fictional: synthetic file ids whose digests equal
 * the seeded synthetic documents', a path that looks like a filing
 * convention, and one id whose bytes differ, so a MISMATCH is provable.
 */
export const SYNTHETIC_DRIVE_NAME = 'HiveSyntheticDrive';

/** The folder a person files this case's evidence under, by hand. */
export const SYNTHETIC_DRIVE_FOLDER =
  '/Clients/Harbor Light Bakery LLC (Synthetic)/2025 books close (Synthetic)';
const FOLDER = SYNTHETIC_DRIVE_FOLDER;

/** file id -> what the record holds. Digests restate the seeded
 * documents (scripts/lib/synthetic-documents.mjs) so a drifted seed fails
 * here rather than being re-derived. */
const FIXTURES = {
  'drv-synthetic-0001': {
    digest: '1bbf55cd57909a8de8bec3dc03dad2312772e489c52f83bcbddc364467bfaafa',
    path: `${FOLDER}/bank-statement-2026-07 (Synthetic).pdf`,
    documentId: 'd0c0d0c0-0000-4000-8000-0000000000a1',
  },
  'drv-synthetic-0002': {
    digest: 'bf380c3107ec374fd0cf602388bb57dfe43c7033a810c64a24609dbe38c766a5',
    path: `${FOLDER}/statement-2025-11 (Synthetic).pdf`,
    documentId: 'd0c0d0c0-0000-4000-8000-0000000000a3',
  },
  'drv-synthetic-0003': {
    digest: '7a1c2f3e4d5b6a7980f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6e5f4a3b',
    path: `${FOLDER}/november-balance-photo (Synthetic).png`,
    documentId: 'd0c0d0c0-0000-4000-8000-0000000000a4',
  },
  // The wrong bytes under a plausible name: the verification must say so.
  'drv-synthetic-wrong': {
    digest: '00000000000000000000000000000000000000000000000000000000000000ff',
    path: `${FOLDER}/bank-statement-2026-07 (Synthetic) copy.pdf`,
    documentId: null,
  },
};

export const SYNTHETIC_DRIVE_FILES = Object.freeze(
  Object.fromEntries(Object.entries(FIXTURES).map(([id, entry]) => [id, { ...entry }])),
);

export const HiveSyntheticDrive = {
  name: SYNTHETIC_DRIVE_NAME,

  async checkFile(fileId) {
    const found = FIXTURES[fileId];
    if (!found) return { found: false };
    return { found: true, digest: found.digest, path: found.path };
  },
};
