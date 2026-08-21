/** expo-file-system binding for the install marker.
 *
 * The marker lives in the app document directory — app-scoped storage that
 * an uninstall removes. Android backup is disabled app-wide
 * (allowBackup=false via expo-build-properties), and session material is
 * this-device-only in the Keychain, so no backup path can reunite a
 * restored marker with foreign session material. iOS same-device
 * backup-restore behavior is a documented native-lane test
 * (SECURITY.md, residual risks).
 */
import { File, Paths } from 'expo-file-system';

import type { MarkerFileStore } from './install-marker';

const MARKER_FILE_NAME = 'hive-install-marker.json';

export const documentMarkerFileStore: MarkerFileStore = {
  async read(): Promise<string | null> {
    const file = new File(Paths.document, MARKER_FILE_NAME);
    if (!file.exists) return null;
    return file.text();
  },
  async write(content: string): Promise<void> {
    const file = new File(Paths.document, MARKER_FILE_NAME);
    file.write(content);
  },
};
