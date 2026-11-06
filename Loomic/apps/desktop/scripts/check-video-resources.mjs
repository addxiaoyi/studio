import { fileURLToPath } from "node:url";
import { verifyWindowsVideoResources } from "./verify-video-resources.mjs";

if (process.platform === "win32") {
  verifyWindowsVideoResources(fileURLToPath(new URL("../resources/ffmpeg/win-x64/", import.meta.url)));
}
