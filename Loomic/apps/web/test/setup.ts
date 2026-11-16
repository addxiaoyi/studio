declare const jsdom: { window: Window } | undefined;

// Node's native Web Storage must not replace the per-file browser storage.
if (typeof jsdom !== "undefined") {
  for (const key of ["localStorage", "sessionStorage"] as const) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: jsdom.window[key],
    });
  }
}
