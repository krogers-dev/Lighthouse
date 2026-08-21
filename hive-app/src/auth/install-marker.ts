/** Non-sensitive install marker.
 *
 * Lives in app-scoped file storage — deliberately *outside* the Keychain —
 * so an uninstall removes it while iOS Keychain items can survive. Secure
 * material present without a marker therefore means "reinstall over a stale
 * Keychain": the controller scrubs every HIVE session key and verifies the
 * deletion before any auth construction. The marker itself holds only a
 * random install id and a timestamp; auth material never goes here.
 * Android backup is disabled app-wide (allowBackup=false), and session
 * items use a this-device-only Keychain class, so no cross-device restore
 * can pair a foreign marker with foreign session material.
 */
import { newOpaqueToken, type RandomSource, cryptoRandomSource } from '@/core/ids';

export interface MarkerFileStore {
  read(): Promise<string | null>;
  write(content: string): Promise<void>;
}

interface MarkerContent {
  v: number;
  installId: string;
  createdAt: number;
}

const MARKER_VERSION = 1;

export class InstallMarker {
  constructor(
    private readonly store: MarkerFileStore,
    private readonly random: RandomSource = cryptoRandomSource,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** True only for a present, well-formed marker. Unreadable or malformed
   * markers count as absent, which fails closed: the session store gets
   * scrubbed and the user signs in again. */
  async exists(): Promise<boolean> {
    let raw: string | null;
    try {
      raw = await this.store.read();
    } catch {
      return false;
    }
    if (raw === null) return false;
    try {
      const parsed = JSON.parse(raw) as Partial<MarkerContent>;
      return parsed.v === MARKER_VERSION && typeof parsed.installId === 'string';
    } catch {
      return false;
    }
  }

  async ensure(): Promise<void> {
    if (await this.exists()) return;
    const content: MarkerContent = {
      v: MARKER_VERSION,
      installId: newOpaqueToken(16, this.random),
      createdAt: this.now(),
    };
    await this.store.write(JSON.stringify(content));
  }
}
