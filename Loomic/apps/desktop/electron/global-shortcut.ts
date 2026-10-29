/**
 * #80: global accelerator that jumps straight to the Agent composer from anywhere on the
 * desktop. The registration/teardown guard lives here as pure logic over an injected port so
 * it can be unit-tested without booting Electron.
 */

/** Change the hotkey here only: Ctrl+Shift+Space on Windows/Linux, Cmd+Shift+Space on macOS. */
export const AGENT_FOCUS_SHORTCUT = "CommandOrControl+Shift+Space";

/** Renderer channel the preload bridge re-publishes so the web composer can take focus. */
export const AGENT_FOCUS_CHANNEL = "desktop:focus-agent-input";

export type GlobalShortcutPort = {
  register(accelerator: string, callback: () => void): boolean;
  unregisterAll(): void;
};

export type ShortcutLogger = (message: string, error?: unknown) => void;

const noopLogger: ShortcutLogger = () => {};

/**
 * Registers the accelerator after `app.whenReady`. Another application may already own the
 * combination (`register` then returns false) and Electron can throw on an unusable
 * accelerator; both cases are logged and swallowed so a taken hotkey never crashes startup.
 */
export function registerAgentFocusShortcut(
  port: GlobalShortcutPort,
  options: { onTrigger: () => void; log?: ShortcutLogger },
): boolean {
  const log = options.log ?? noopLogger;
  try {
    const registered = port.register(AGENT_FOCUS_SHORTCUT, options.onTrigger);
    if (!registered) {
      log(
        "[desktop-shortcut] " +
          AGENT_FOCUS_SHORTCUT +
          " is already registered by another application; the Agent shortcut stays disabled.",
      );
      return false;
    }
    return true;
  } catch (error) {
    log("[desktop-shortcut] Failed to register " + AGENT_FOCUS_SHORTCUT + ".", error);
    return false;
  }
}

/** Releases every accelerator on `will-quit`; a failing teardown is logged, never thrown. */
export function releaseAgentFocusShortcuts(
  port: GlobalShortcutPort,
  options: { log?: ShortcutLogger } = {},
): void {
  const log = options.log ?? noopLogger;
  try {
    port.unregisterAll();
  } catch (error) {
    log("[desktop-shortcut] Failed to unregister global shortcuts during shutdown.", error);
  }
}
