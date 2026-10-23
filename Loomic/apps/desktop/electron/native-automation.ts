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
    const recognized = await worker.recognize(screenshotPath);
    const recognizedWords = (recognized.data as typeof recognized.data & {
      words?: Array<{ confidence: number; text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
    }).words ?? [];
    if (SECRET_HINT.test(recognized.data.text)) {
      throw new Error("OCR detected a password, OTP, or verification label. Screenshot and recognized text were blocked.");
    }
    const controls: NativeDesktopEvidence["controls"] = [];
    if (tree) flattenControls(tree, controls, { remaining: MAX_TREE_NODES });
    return {
      windowTitle: (await activeWindow.title).slice(0, 300),
      windowRegion: {
        left: (await activeWindow.region).left,
        top: (await activeWindow.region).top,
        width: (await activeWindow.region).width,
        height: (await activeWindow.region).height,
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
  const matches: Array<{ x: number; y: number }> = [];
  for (let index = 0; index <= words.length - tokens.length; index += 1) {
    const candidate = words.slice(index, index + tokens.length);
    if (candidate.map((word) => word.text.toLocaleLowerCase()).join(" ") !== cleanTarget) continue;
    matches.push({
      x: evidence.windowRegion.left + candidate.reduce((sum, word) => sum + word.x + word.width / 2, 0) / candidate.length,
      y: evidence.windowRegion.top + candidate.reduce((sum, word) => sum + word.y + word.height / 2, 0) / candidate.length,
    });
  }
  if (matches.length !== 1) throw new Error(matches.length ? "The visible text target is ambiguous." : "The requested visible text was not found in the active window.");
  const { mouse } = await import("@nut-tree/nut-js");
  await mouse.setPosition(matches[0]!);
  await mouse.leftClick();
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
