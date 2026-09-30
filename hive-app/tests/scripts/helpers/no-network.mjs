/** Preloaded into a spawned script by tests that prove a REFUSAL: the
 * script must exit before it reaches the network, so any request it makes
 * is itself the failure. Never loaded by the tooling. */
globalThis.fetch = async () => {
  console.error('TEST FAILURE: the script reached the network before refusing');
  process.exit(97);
};
