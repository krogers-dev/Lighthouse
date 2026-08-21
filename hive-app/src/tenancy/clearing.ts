/** Actor-bound state clearing.
 *
 * Everything that caches per-actor or per-scope data registers here. On any
 * identity or scope change the controller calls clearAll, so entity B can
 * never observe entity A's content and identity switches leave nothing
 * behind.
 */

export type ClearReason = 'sign_out' | 'identity_switch' | 'scope_switch' | 'quarantine' | 'expiry';

export interface ScopedResource {
  clear(reason: ClearReason): void;
}

export class ScopedRegistry {
  private readonly resources = new Set<ScopedResource>();

  register(resource: ScopedResource): () => void {
    this.resources.add(resource);
    return () => this.resources.delete(resource);
  }

  clearAll(reason: ClearReason): number {
    let cleared = 0;
    for (const resource of this.resources) {
      resource.clear(reason);
      cleared += 1;
    }
    return cleared;
  }

  get size(): number {
    return this.resources.size;
  }
}
