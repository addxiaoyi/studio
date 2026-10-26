/**
 * Desktop agent real-machine smoke checks.
 * Run inside the Electron main process context: the checks that need a GUI
 * (OCR, screenshot, key events) require the packaged app or `pnpm --filter @helstera/desktop dev`.
 * This script validates everything that works in plain Node on the dev machine.
 */
import { execSync } from "node:child_process";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// 1. nut-js loads and enumerates keys (runtime deps healthy)
try {
  const nut = (await import("@nut-tree/nut-js")).default ?? await import("@nut-tree/nut-js");
  const keys = Object.keys(nut.Key ?? {});
  check("nut-js Key enum loaded", keys.length > 100, `${keys.length} keys`);
  check("nut-js Escape key present", "Escape" in (nut.Key ?? {}));
  check("nut-js Escape maps to 0 (falsy guard needed)", nut.Key.Escape === 0);
  check("nut-js Button enum loaded", "LEFT" in (nut.Button ?? {}));
  check("nut-js clipboard API present", typeof (nut.clipboard ?? {}).getContent === "function" || typeof nut.clipboard?.getContent === "function");
  check("nut-js getWindows exported", typeof nut.getWindows === "function");
} catch (error) {
  check("nut-js loads", false, error instanceof Error ? error.message : String(error));
}

// 2. tesseract.js worker creates (OCR pipeline healthy)
try {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(["eng"]);
  await worker.terminate();
  check("tesseract worker create/terminate", true);
} catch (error) {
  check("tesseract worker create/terminate", false, error instanceof Error ? error.message : String(error));
}

// 3. Electron desktopCapturer screen sources (needs Electron runtime; skipped in plain Node)
if (process.versions.electron) {
  try {
    const { desktopCapturer, screen } = await import("electron");
    const displays = screen.getAllDisplays();
    check("multiple displays enumerated", displays.length >= 1, `${displays.length} displays, primary scale ${screen.getPrimaryDisplay().scaleFactor}`);
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } });
    check("desktopCapturer screen sources", sources.length >= 1, `${sources.length} sources; display_ids: ${sources.map((s) => s.display_id).join(",")}`);
    const displayIds = new Set(displays.map((d) => String(d.id)));
    check("every display has a capturer source", displays.every((d) => sources.some((s) => s.display_id === String(d.id))));
  } catch (error) {
    check("electron screen enumeration", false, error instanceof Error ? error.message : String(error));
  }
} else {
  console.log("SKIP  Electron-only checks (desktopCapturer/audio) — run via `pnpm --filter @helstera/desktop dev` console");
}

// 4. live screen interaction: screenshot -> pixelScale -> OCR word boxes (the real high-DPI test)
try {
  const { inspectNativeDesktop } = await import(new URL("../dist-electron/electron/native-automation.js", import.meta.url).href);
  const evidence = await inspectNativeDesktop({
    platform: process.platform,
    userDataPath: process.cwd(),
    sessionType: process.env.XDG_SESSION_TYPE,
    preferVision: true,
  });
  check("live screenshot captured", evidence.screenshotBase64.length > 1000, `${evidence.screenshotWidth}x${evidence.screenshotHeight}`);
  check("pixelScale measured", Number.isFinite(evidence.pixelScale) && evidence.pixelScale > 0, `scale=${evidence.pixelScale.toFixed(2)} (1.0 = no HiDPI, 1.25/1.5/2 = scaled)`);
  check("OCR produced word boxes", evidence.ocrWords.length > 0, `${evidence.ocrWords.length} words, first: "${evidence.ocrWords[0]?.text ?? ""}"`);
  check("no credential guard trip", !/credential|password|OTP/i.test(evidence.fallbackReason ?? ""), evidence.fallbackReason ?? "");
} catch (error) {
  check("live screenshot + OCR", false, error instanceof Error ? error.message.slice(0, 200) : String(error));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
