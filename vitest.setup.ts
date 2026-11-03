// Node >= 25 ships an experimental Web Storage implementation that defines
// `globalThis.localStorage` / `sessionStorage` as getters. Without
// `--localstorage-file` they return undefined, which shadows jsdom's own
// storage in the jsdom test environment. Re-point the globals at jsdom's
// storage so jsdom tests behave the same on every Node version. In the plain
// "node" environment there is no jsdom, so this is a no-op.
const jsdom = (globalThis as { jsdom?: { window?: Window } }).jsdom;
const win = jsdom?.window;

if (win) {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    let storage: Storage | undefined;
    try {
      storage = win[name];
    } catch {
      storage = undefined; // opaque origin: jsdom throws SecurityError
    }
    if (storage) {
      Object.defineProperty(globalThis, name, {
        value: storage,
        configurable: true,
        writable: true,
      });
    }
  }
}
