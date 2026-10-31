import { execFile } from "node:child_process";
import { access } from "node:fs/promises";

export type UiaSnapshot = {
  windowId: string;
  pid: number;
  title: string;
  controls: Array<{ title: string; role: string; isPassword: boolean; isEnabled: boolean; isFocused: boolean }>;
};

let helperPath: string | undefined;
export function configureWindowsUia(path: string | undefined) { helperPath = path; }

export function parseUiaSnapshot(value: unknown): UiaSnapshot {
  if (!value || typeof value !== "object") throw new Error("Invalid Windows accessibility response.");
  const snapshot = value as Record<string, unknown>;
  if (snapshot.ok !== true || snapshot.protocol !== 1 || typeof snapshot.windowId !== "string" || !/^[a-f0-9]{1,16}$/.test(snapshot.windowId) ||
    !Number.isSafeInteger(snapshot.pid) || Number(snapshot.pid) <= 0 || typeof snapshot.title !== "string" || snapshot.title.length > 300 ||
    !Array.isArray(snapshot.controls) || snapshot.controls.length > 240) throw new Error("Invalid Windows accessibility response.");
  for (const item of snapshot.controls) {
    if (!item || typeof item !== "object" || typeof item.title !== "string" || item.title.length > 300 ||
      !["edit", "control"].includes(item.role) || [item.isPassword, item.isEnabled, item.isFocused].some((flag) => typeof flag !== "boolean")) {
      throw new Error("Invalid Windows accessibility control.");
    }
  }
  return snapshot as unknown as UiaSnapshot;
}

async function invoke(args: string[], input?: Buffer): Promise<unknown> {
  if (!helperPath) throw new Error("Windows accessibility helper is not configured.");
  return new Promise((resolve, reject) => {
    const child = execFile(helperPath!, args, { windowsHide: true, timeout: 8_000, maxBuffer: 256_000, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) { reject(new Error(`Windows accessibility helper failed: ${stderr.trim().slice(0, 500) || "unavailable or timed out"}`)); return; }
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error("Windows accessibility helper returned invalid JSON.")); }
    });
    child.stdin?.on("error", (error) => reject(new Error("Could not send input to the Windows accessibility helper.", { cause: error })));
    child.stdin?.end(input);
  });
}

export async function inspectWindowsUia(): Promise<UiaSnapshot | null> {
  if (process.platform !== "win32" || !helperPath) return null;
  try { await access(helperPath); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return parseUiaSnapshot(await invoke(["inspect"]));
}

export function encodeUiaInput(target: string, value: string): Buffer {
  const fields = [Buffer.from(target, "utf8"), Buffer.from(value, "utf8")];
  if (!fields[0]!.length || fields[0]!.length > 640 || !fields[1]!.length || fields[1]!.length > 40_000 || /\0/.test(target + value)) {
    throw new Error("Native text input is invalid or too long.");
  }
  return Buffer.concat(fields.flatMap((field) => {
    const length = Buffer.alloc(4); length.writeUInt32LE(field.length);
    return [length, field];
  }));
}

export async function setWindowsUiaValue(snapshot: UiaSnapshot, target: string, value: string): Promise<void> {
  const response = await invoke(["set-value", snapshot.windowId, String(snapshot.pid)], encodeUiaInput(target, value));
  if (!response || typeof response !== "object" || (response as { ok?: unknown }).ok !== true || (response as { protocol?: unknown }).protocol !== 1) {
    throw new Error("The native input operation was not acknowledged. Inspect the field before retrying.");
  }
}
