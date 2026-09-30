/** Monotonic auth epoch.
 *
 * Every sign-out and identity switch advances the epoch. Any callback,
 * refresh completion, or listener event carrying an older epoch is ignored,
 * so late async work from a previous identity can never touch current
 * state.
 */
export class EpochGate {
  private epoch = 0;

  current(): number {
    return this.epoch;
  }

  next(): number {
    this.epoch += 1;
    return this.epoch;
  }

  isCurrent(epoch: number): boolean {
    return epoch === this.epoch;
  }
}
