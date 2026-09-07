/** expo-secure-store binding for the session storage adapter.
 *
 * WHEN_UNLOCKED_THIS_DEVICE_ONLY: session material is available only while
 * the device is unlocked (token refresh runs foreground-only by design) and
 * is never migrated to another device by backup or transfer — the
 * cross-device half of the reinstall problem is closed at the Keychain
 * class. `requireAuthentication` stays off: biometric local unlock is not a
 * server-authorization substitute and is out of Milestone 0 scope.
 */
import * as SecureStore from 'expo-secure-store';

import type { SecureStoreBackend } from './secure-store-adapter';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const expoSecureStoreBackend: SecureStoreBackend = {
  getItem(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key, OPTIONS);
  },
  setItem(key: string, value: string): Promise<void> {
    return SecureStore.setItemAsync(key, value, OPTIONS);
  },
  deleteItem(key: string): Promise<void> {
    return SecureStore.deleteItemAsync(key, OPTIONS);
  },
};
