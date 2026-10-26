import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SECRET_HINT = /password|passcode|one[- ]?time|verification|auth[- ]?code|\botp\b|\bmfa\b/i;
const MAX_TREE_NODES = 240;
const MAX_OCR_TEXT = 12_000;

export type NativeWindowNode = {
  title?: string;
  value?: string;
  type?: string;
  role?: string;
  subRole?: string;
  isFocused?: boolean;
  isEnabled?: boolean;
  region?: { left?: number; top?: number; width?: number; height?: number };
  children?: NativeWindowNode[];
};

export type NativeDesktopEvidence = {
  windowTitle: string;
  windowRegion: { left: number; top: number; width: number; height: number };
  controls: Array<{ title: string; role?: string; enabled?: boolean; focused?: boolean }>;
  ocrText: string;
  ocrWords: Array<{ text: string; x: number; y: number; width: number; height: number }>;
  screenshotBase64: string;
  screenshotMimeType: "image/png";
  screenshotWidth: number;
  screenshotHeight: number;
  pixelScale: number;
  fallbackReason?: string;
};

export function isSensitiveNativeTree(tree: NativeWindowNode | null | undefined): boolean {
  if (!tree) return false;
  const label = [tree.title, tree.type, tree.role, tree.subRole].filter(Boolean).join(" ");
  if (SECRET_HINT.test(label)) return true;
  return (tree.children ?? []).some(isSensitiveNativeTree);
}

function flattenControls(tree: NativeWindowNode, controls: NativeDesktopEvidence["controls"], budget: { remaining: number }) {
  if (budget.remaining <= 0) return;
  budget.remaining -= 1;
  const title = String(tree.title ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
  const label = [title, tree.type, tree.role, tree.subRole].filter(Boolean).join(" ");
  if (title && !SECRET_HINT.test(label)) {
    controls.push({
      title,
      ...(tree.role ? { role: tree.role.slice(0, 80) } : {}),
      ...(tree.isEnabled === undefined ? {} : { enabled: tree.isEnabled }),
      ...(tree.isFocused === undefined ? {} : { focused: tree.isFocused }),
    });
  }
  for (const child of tree.children ?? []) flattenControls(child, controls, budget);
}

export async function inspectNativeDesktop(options: {
  platform: NodeJS.Platform;
  userDataPath: string;
  sessionType?: string;
  preferVision?: boolean;
}): Promise<NativeDesktopEvidence> {
  if (options.platform === "linux" && options.sessionType?.toLowerCase() === "wayland") {
    throw new Error("Linux native automation currently requires an X11 session; Wayland is not supported by the installed driver.");
  }

  const [{ screen, getActiveWindow, FileType }, { createWorker }] = await Promise.all([
    import("@nut-tree/nut-js"),
    import("tesseract.js"),
  ]);
  let activeWindow;
  try {
    activeWindow = await getActiveWindow();
  } catch (error) {
    throw new Error("Could not inspect the active native window. Check screen capture and accessibility permissions.", { cause: error });
  }

  let tree: NativeWindowNode | null = null;
  let fallbackReason: string | undefined;
  if (options.preferVision) {
    fallbackReason = "Visual/OCR mode was selected for this task.";
  } else {
    try {
      tree = await activeWindow.getElements(MAX_TREE_NODES) as NativeWindowNode;
    } catch {
      fallbackReason = "Native accessibility tree is unavailable; used OCR on the active window.";
    }
  }
  if (isSensitiveNativeTree(tree)) {
    throw new Error("A password, OTP, or verification control is visible. Native screenshot and OCR evidence were blocked to protect credentials.");
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "helstera-native-screen-"));
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    const screenshotPath = await screen.captureRegion("active-window", await activeWindow.region, FileType.PNG, temporaryDirectory);
    const screenshot = await readFile(screenshotPath);
    worker = await createWorker(["eng", "chi_sim"], undefined, {
      cachePath: join(options.userDataPath, "ocr-cache"),
    });
    // tesseract.js v7 requires blocks output to be requested explicitly.
    const recognized = await worker.recognize(screenshotPath, {}, { blocks: true, text: true });
    // Word data lives in blocks → paragraphs → lines → words.
    const collectWords = (node: unknown): Array<{ confidence: number; text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }> => {
      if (!node || typeof node !== "object") return [];
      if (Array.isArray(node)) return node.flatMap((child) => collectWords(child));
      const current = node as { words?: unknown[]; paragraphs?: unknown[]; lines?: unknown[]; confidence?: number; text?: string; bbox?: { x0: number; y0: number; x1: number; y1: number } };
      const own = Array.isArray(current.words) ? current.words as Array<{ confidence: number; text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }> : [];
      const nested = [...(current.paragraphs ?? []), ...(current.lines ?? [])].flatMap((child) => collectWords(child));
      return [...own, ...nested];
    };
    const recognizedWords = collectWords(recognized.data.blocks);
    if (SECRET_HINT.test(recognized.data.text)) {
      throw new Error("OCR detected a password, OTP, or verification label. Screenshot and recognized text were blocked.");
    }
    const controls: NativeDesktopEvidence["controls"] = [];
    if (tree) flattenControls(tree, controls, { remaining: MAX_TREE_NODES });
    const windowRegion = await activeWindow.region;
    let screenshotWidth = windowRegion.width;
    let screenshotHeight = windowRegion.height;
    try {
      // PNG IHDR: bytes 16-19 big-endian width, 20-23 height.
      if (screenshot.length > 24 && screenshot[12] === 0x49 && screenshot[13] === 0x48 && screenshot[14] === 0x44 && screenshot[15] === 0x52) {
        const pngWidth = screenshot.readUInt32BE(16);
        const pngHeight = screenshot.readUInt32BE(20);
        if (pngWidth > 0 && pngHeight > 0) {
          screenshotWidth = pngWidth;
          screenshotHeight = pngHeight;
        }
      }
    } catch {
      /* fall back to the region size */
    }
    const pixelScale = windowRegion.width > 0 ? screenshotWidth / windowRegion.width : 1;
    return {
      windowTitle: (await activeWindow.title).slice(0, 300),
      windowRegion: {
        left: windowRegion.left,
        top: windowRegion.top,
        width: windowRegion.width,
        height: windowRegion.height,
      },
      controls,
      ocrText: recognized.data.text.replace(/\s+/g, " ").trim().slice(0, MAX_OCR_TEXT),
      ocrWords: recognizedWords
        .filter((word) => word.confidence >= 35 && word.text.trim())
        .slice(0, 2_000)
        .map((word) => ({
          text: word.text.trim().slice(0, 160),
          x: word.bbox.x0,
          y: word.bbox.y0,
          width: word.bbox.x1 - word.bbox.x0,
          height: word.bbox.y1 - word.bbox.y0,
        })),
      screenshotBase64: screenshot.toString("base64"),
      screenshotMimeType: "image/png",
      screenshotWidth,
      screenshotHeight,
      pixelScale,
      ...(fallbackReason ? { fallbackReason } : {}),
    };
  } catch (error) {
    if (error instanceof Error && /permission|accessibility|screen recording|not supported|display/i.test(error.message)) {
      throw new Error("Native screen access is unavailable. Grant the platform's Accessibility and Screen Recording permissions, or use the browser Agent.", { cause: error });
    }
    throw error;
  } finally {
    await worker?.terminate();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function clickNativeText(target: string, userDataPath: string): Promise<void> {
  const cleanTarget = target.replace(/\s+/g, " ").trim().toLocaleLowerCase();
  if (!cleanTarget || cleanTarget.length > 160) throw new Error("Choose a short visible text label as the native click target.");
  const evidence = await inspectNativeDesktop({
    platform: process.platform,
    userDataPath,
    sessionType: process.env.XDG_SESSION_TYPE,
    preferVision: true,
  });
  const tokens = cleanTarget.split(" ");
  const words = evidence.ocrWords;
  const scale = evidence.pixelScale > 0 ? evidence.pixelScale : 1;
  const matches: Array<{ x: number; y: number }> = [];
  for (let index = 0; index <= words.length - tokens.length; index += 1) {
    const candidate = words.slice(index, index + tokens.length);
    if (candidate.map((word) => word.text.toLocaleLowerCase()).join(" ") !== cleanTarget) continue;
    matches.push({
      x: evidence.windowRegion.left + candidate.reduce((sum, word) => sum + (word.x + word.width / 2) / scale, 0) / candidate.length,
      y: evidence.windowRegion.top + candidate.reduce((sum, word) => sum + (word.y + word.height / 2) / scale, 0) / candidate.length,
    });
  }
  if (matches.length !== 1) throw new Error(matches.length ? "The visible text target is ambiguous." : "The requested visible text was not found in the active window.");
  const { mouse } = await import("@nut-tree/nut-js");
  await mouse.setPosition(matches[0]!);
  await mouse.leftClick();
}

export async function clickNativeCoordinates(x: number, y: number, button: "left" | "right" = "left", double = false): Promise<void> {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 100_000 || y > 100_000) {
    throw new Error("Native click coordinates are out of bounds.");
  }
  const nut = await import("@nut-tree/nut-js");
  const { mouse } = nut;
  await mouse.setPosition(new nut.Point(Math.round(x), Math.round(y)));
  const targetButton = button === "right" ? nut.Button.RIGHT : nut.Button.LEFT;
  if (double) {
    await mouse.doubleClick(targetButton);
  } else if (button === "right") {
    await mouse.rightClick();
  } else {
    await mouse.leftClick();
  }
}

const NATIVE_KEY_ALIASES: Record<string, string> = {
  space: "Space",
  escape: "Escape",
  esc: "Escape",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
};

const NATIVE_MODIFIER_ALIASES: Record<string, string> = {
  ctrl: "LeftControl",
  control: "LeftControl",
  alt: "LeftAlt",
  shift: "LeftShift",
  meta: "LeftWin",
  cmd: "LeftCmd",
  win: "LeftWin",
};

export async function pressNativeKey(key: string, modifiers: string[] = []): Promise<void> {
  const cleanKey = key.trim().toLowerCase();
  const nutKeyName = NATIVE_KEY_ALIASES[cleanKey] ?? (/^f([1-9]|1[0-2])$/.test(cleanKey) ? cleanKey.toUpperCase() : undefined);
  if (!nutKeyName) throw new Error(`Unsupported native key: ${key}`);
  const { Key, keyboard } = await import("@nut-tree/nut-js");
  const keyMap = Key as unknown as Record<string, unknown>;
  const targetKey = keyMap[nutKeyName];
  if (typeof targetKey !== "number") throw new Error(`Unsupported native key: ${key}`);
  const modifierKeys = modifiers.map((modifier) => {
    const alias = NATIVE_MODIFIER_ALIASES[modifier.toLowerCase()];
    if (!alias) throw new Error(`Unsupported modifier: ${modifier}`);
    const resolved = keyMap[alias];
    if (typeof resolved !== "number") throw new Error(`Unsupported modifier: ${modifier}`);
    return resolved;
  });
  for (const modifier of modifierKeys) await keyboard.pressKey(modifier as never);
  await keyboard.type(targetKey as never);
  for (const modifier of [...modifierKeys].reverse()) await keyboard.releaseKey(modifier as never);
}

export async function scrollNativeWindow(dx: number, dy: number): Promise<void> {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > 5_000 || Math.abs(dy) > 5_000) {
    throw new Error("Native scroll amount is out of bounds.");
  }
  const { mouse } = await import("@nut-tree/nut-js");
  const downSteps = Math.max(-100, Math.min(100, Math.round(dy)));
  if (downSteps > 0) await mouse.scrollDown(downSteps);
  else if (downSteps < 0) await mouse.scrollUp(-downSteps);
  const rightSteps = Math.max(-100, Math.min(100, Math.round(dx)));
  if (rightSteps > 0) await mouse.scrollRight(rightSteps);
  else if (rightSteps < 0) await mouse.scrollLeft(-rightSteps);
}

export async function dragNativeMouse(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  bounds?: { left: number; top: number; width: number; height: number },
): Promise<void> {
  for (const value of [fromX, fromY, toX, toY]) {
    if (!Number.isFinite(value) || value < 0 || value > 100_000) throw new Error("Native drag coordinates are out of bounds.");
  }
  if (bounds) {
    const inside = (x: number, y: number) =>
      x >= bounds.left && x <= bounds.left + bounds.width && y >= bounds.top && y <= bounds.top + bounds.height;
    if (!inside(fromX, fromY) || !inside(toX, toY)) {
      throw new Error("Native drag coordinates must stay inside the active window region.");
    }
  }
  const nut = await import("@nut-tree/nut-js");
  const { mouse } = nut;
  await mouse.setPosition(new nut.Point(Math.round(fromX), Math.round(fromY)));
  await mouse.drag([new nut.Point(Math.round(toX), Math.round(toY))]);
}

export type GroundingTarget = {
  text?: string;
  x?: number;
  y?: number;
  /** Screenshot pixel coordinates (from a visual model looking at evidence.screenshotBase64). */
  screenshotX?: number;
  screenshotY?: number;
};

export type GroundingResult = {
  x: number;
  y: number;
  source: "ocr_text" | "coordinates";
  confidence: number;
};

export function groundNativeTarget(
  target: GroundingTarget,
  evidence: {
    windowRegion: { left: number; top: number; width: number; height: number };
    ocrWords: Array<{ text: string; x: number; y: number; width: number; height: number }>;
    pixelScale?: number;
    screenshotWidth?: number;
    screenshotHeight?: number;
  },
): GroundingResult {
  const hasText = typeof target.text === "string" && target.text.trim().length > 0;
  const hasPoint =
    typeof target.x === "number" && Number.isFinite(target.x) &&
    typeof target.y === "number" && Number.isFinite(target.y) &&
    target.x >= 0 && target.y >= 0;
  // OCR word boxes are in screenshot physical pixels; mouse coordinates are
  // in window DIP. Scale evidence boxes back into window units.
  const scale = evidence.pixelScale && evidence.pixelScale > 0 ? evidence.pixelScale : 1;

  if (hasText) {
    const cleanTarget = target.text!.replace(/\s+/g, " ").trim().toLocaleLowerCase();
    const tokens = cleanTarget.split(" ");
    const words = evidence.ocrWords;
    const matches: Array<{ x: number; y: number; confidence: number }> = [];
    for (let index = 0; index <= words.length - tokens.length; index += 1) {
      const candidate = words.slice(index, index + tokens.length);
      const joined = candidate.map((word) => word.text.toLocaleLowerCase()).join(" ");
      if (joined !== cleanTarget) continue;
      matches.push({
        x: evidence.windowRegion.left + candidate.reduce((sum, word) => sum + (word.x + word.width / 2) / scale, 0) / candidate.length,
        y: evidence.windowRegion.top + candidate.reduce((sum, word) => sum + (word.y + word.height / 2) / scale, 0) / candidate.length,
        confidence: candidate.length,
      });
    }
    if (matches.length === 1) {
      return { x: matches[0]!.x, y: matches[0]!.y, source: "ocr_text", confidence: Math.min(1, matches[0]!.confidence / 3) };
    }
    if (matches.length > 1) throw new Error("The grounding text target is ambiguous on screen.");
  }

  if (hasPoint) {
    if (target.x! > evidence.windowRegion.width || target.y! > evidence.windowRegion.height) {
      throw new Error("Grounding coordinates fall outside the active window region.");
    }
    return {
      x: evidence.windowRegion.left + target.x!,
      y: evidence.windowRegion.top + target.y!,
      source: "coordinates",
      confidence: 1,
    };
  }

  const hasScreenshotPoint =
    typeof target.screenshotX === "number" && Number.isFinite(target.screenshotX) &&
    typeof target.screenshotY === "number" && Number.isFinite(target.screenshotY) &&
    target.screenshotX >= 0 && target.screenshotY >= 0;
  if (hasScreenshotPoint) {
    const screenshotWidth = evidence.screenshotWidth ?? 0;
    if (!screenshotWidth) throw new Error("Screenshot-pixel grounding requires fresh screen evidence.");
    if (target.screenshotX! > screenshotWidth || target.screenshotY! > (evidence.screenshotHeight ?? 0)) {
      throw new Error("Screenshot grounding coordinates fall outside the captured screenshot.");
    }
    return {
      x: evidence.windowRegion.left + target.screenshotX! / scale,
      y: evidence.windowRegion.top + target.screenshotY! / scale,
      source: "coordinates",
      confidence: 0.9,
    };
  }

  throw new Error(hasText
    ? "The requested grounding text was not found in the active window."
    : "Grounding requires either visible text or in-window coordinates.");
}

export async function clickGroundedTarget(
  target: GroundingTarget,
  userDataPath: string,
  button: "left" | "right" = "left",
  double = false,
): Promise<GroundingResult> {
  const evidence = await inspectNativeDesktop({
    platform: process.platform,
    userDataPath,
    sessionType: process.env.XDG_SESSION_TYPE,
    preferVision: true,
  });
  const grounded = groundNativeTarget(target, evidence);
  await clickNativeCoordinates(grounded.x, grounded.y, button, double);
  return grounded;
}

export async function waitForNativeText(
  target: string,
  userDataPath: string,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<{ found: boolean; elapsedMs: number }> {
  const cleanTarget = target.replace(/\s+/g, " ").trim().toLocaleLowerCase();
  if (!cleanTarget || cleanTarget.length > 160) throw new Error("wait_for_text requires a short visible text label.");
  const timeoutMs = Math.min(60_000, Math.max(1_000, options.timeoutMs ?? 10_000));
  const intervalMs = Math.min(5_000, Math.max(500, options.intervalMs ?? 1_500));
  const startedAt = Date.now();
  for (;;) {
    const evidence = await inspectNativeDesktop({
      platform: process.platform,
      userDataPath,
      sessionType: process.env.XDG_SESSION_TYPE,
      preferVision: true,
    });
    const haystack = evidence.ocrText.replace(/\s+/g, " ").toLocaleLowerCase();
    if (haystack.includes(cleanTarget)) {
      return { found: true, elapsedMs: Date.now() - startedAt };
    }
    if (Date.now() - startedAt >= timeoutMs) {
      return { found: false, elapsedMs: Date.now() - startedAt };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function typeIntoNativeControl(target: string, value: string, _userDataPath: string): Promise<void> {
  const cleanTarget = target.replace(/\s+/g, " ").trim().toLocaleLowerCase();
  if (!cleanTarget || cleanTarget.length > 160 || value.length > 10_000) throw new Error("Native text entry is invalid or too long.");
  const { getActiveWindow, mouse, keyboard } = await import("@nut-tree/nut-js");
  const window = await getActiveWindow();
  let tree: NativeWindowNode;
  try {
    tree = await window.getElements(MAX_TREE_NODES) as NativeWindowNode;
  } catch (error) {
    throw new Error("Native text entry requires an accessibility element inspector; OCR alone cannot safely determine whether the target is a credential field.", { cause: error });
  }
  if (isSensitiveNativeTree(tree)) throw new Error("A password, OTP, or verification field is present; native text entry was blocked.");
  const matches: NativeWindowNode[] = [];
  const find = (node: NativeWindowNode) => {
    const label = String(node.title ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
    if (label === cleanTarget && node.region && /edit|text|input/i.test(`${node.role ?? ""} ${node.type ?? ""} ${node.subRole ?? ""}`)) matches.push(node);
    for (const child of node.children ?? []) find(child);
  };
  find(tree);
  if (matches.length !== 1) throw new Error(matches.length ? "The native text field target is ambiguous." : "A matching accessible text field was not found.");
  const element = matches[0]!;
  if (element.isEnabled === false) throw new Error("The native text field is disabled.");
  const region = element.region;
  const left = region?.left;
  const top = region?.top;
  const width = region?.width;
  const height = region?.height;
  if (
    typeof left !== "number" || !Number.isFinite(left) ||
    typeof top !== "number" || !Number.isFinite(top) ||
    typeof width !== "number" || !Number.isFinite(width) || width <= 0 ||
    typeof height !== "number" || !Number.isFinite(height) || height <= 0
  ) {
    throw new Error("The native text field has no safe clickable bounds.");
  }
  await window.focus();
  await mouse.setPosition({ x: left + width / 2, y: top + height / 2 });
  await mouse.leftClick();
  await keyboard.type(value);
}

export type NativeWindowSummary = {
  title: string;
  region: { left: number; top: number; width: number; height: number };
};

export async function listNativeWindows(limit = 24): Promise<NativeWindowSummary[]> {
  const { getWindows } = await import("@nut-tree/nut-js");
  const windows = await getWindows();
  const summaries: NativeWindowSummary[] = [];
  for (const window of windows.slice(0, Math.min(64, limit * 3))) {
    try {
      const title = (await window.title).trim();
      if (!title) continue;
      const region = await window.region;
      if (region.width <= 0 || region.height <= 0) continue;
      summaries.push({
        title: title.slice(0, 300),
        region: { left: region.left, top: region.top, width: region.width, height: region.height },
      });
      if (summaries.length >= limit) break;
    } catch {
      /* windows that disappear mid-iteration are skipped */
    }
  }
  return summaries;
}

export async function focusNativeWindowByTitle(target: string): Promise<{ focused: boolean; matched: string | null }> {
  const cleanTarget = target.replace(/\s+/g, " ").trim().toLocaleLowerCase();
  if (!cleanTarget || cleanTarget.length > 300) throw new Error("focus_window requires a window title of up to 300 characters.");
  const windows = await listNativeWindows(64);
  const exact = windows.find((window) => window.title.toLocaleLowerCase() === cleanTarget);
  const partial = windows.find((window) => window.title.toLocaleLowerCase().includes(cleanTarget));
  const matched = exact ?? partial;
  if (!matched) return { focused: false, matched: null };
  const { getActiveWindow } = await import("@nut-tree/nut-js");
  const active = await getActiveWindow();
  const activeTitle = (await active.title).trim().toLocaleLowerCase();
  if (activeTitle === matched.title.toLocaleLowerCase()) return { focused: true, matched: matched.title };
  // Re-scan handles by matching title through getWindows since Window handles are opaque.
  const { getWindows: getWindowsAgain } = await import("@nut-tree/nut-js");
  for (const window of await getWindowsAgain()) {
    try {
      if ((await window.title).trim().toLocaleLowerCase() !== matched.title.toLocaleLowerCase()) continue;
      await window.focus();
      return { focused: true, matched: matched.title };
    } catch {
      /* skip */
    }
  }
  return { focused: false, matched: matched.title };
}

export async function readNativeClipboard(): Promise<string> {
  const { clipboard } = await import("@nut-tree/nut-js");
  const text = await clipboard.getContent();
  return String(text ?? "").slice(0, 20_000);
}

export async function writeNativeClipboard(value: string): Promise<void> {
  if (value.length > 100_000) throw new Error("Clipboard payload exceeds the 100,000 character limit.");
  const { clipboard } = await import("@nut-tree/nut-js");
  await clipboard.setContent(value);
}

export async function pasteNativeClipboard(userDataPath: string): Promise<void> {
  const { keyboard, Key } = await import("@nut-tree/nut-js");
  await keyboard.pressKey(Key.LeftControl);
  await keyboard.type(Key.V);
  await keyboard.releaseKey(Key.LeftControl);
}

export type LaunchedApp = { pid: number | undefined; command: string };

export async function launchApplication(command: string): Promise<LaunchedApp> {
  const clean = command.trim();
  if (!clean || clean.length > 300) throw new Error("launch requires a command of up to 300 characters.");
  // Allowlist style check: no shell metacharacters that would allow chaining.
  if (/[;&|`$><]/.test(clean)) throw new Error("launch forbids shell metacharacters; run one simple command at a time.");
  const { spawn } = await import("node:child_process");
  const platform = process.platform;
  let child;
  if (platform === "win32") {
    child = spawn(clean, { shell: false, detached: true, stdio: "ignore" });
  } else {
    child = spawn(clean, [], { shell: false, detached: true, stdio: "ignore" });
  }
  child.unref();
  return { pid: child.pid, command: clean };
}

export async function closeApplicationByPid(pid: number): Promise<{ closed: boolean }> {
  if (!Number.isInteger(pid) || pid <= 0 || pid > 4_194_304) throw new Error("close requires a valid process id.");
  if (pid === process.pid) throw new Error("Refusing to close the Helstera Desktop process itself.");
  const { execFile } = await import("node:child_process");
  const platform = process.platform;
  await new Promise<void>((resolve, reject) => {
    if (platform === "win32") {
      // taskkill sends WM_CLOSE first (graceful), /F only if we ask.
      execFile("taskkill", ["/PID", String(pid)], { windowsHide: true }, (error) => (error ? reject(error) : resolve()));
    } else if (platform === "darwin") {
      execFile("kill", ["-15", String(pid)], (error) => (error ? reject(error) : resolve()));
    } else {
      execFile("kill", ["-15", String(pid)], (error) => (error ? reject(error) : resolve()));
    }
  });
  return { closed: true };
}
