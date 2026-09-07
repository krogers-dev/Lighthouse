/** Injectable time source so expiry and audit logic stay testable. */
export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

export function fixedClock(at: number): Clock {
  return { now: () => at };
}
