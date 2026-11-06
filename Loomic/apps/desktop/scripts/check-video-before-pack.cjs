const { join } = require("node:path");

exports.default = async function checkVideoBeforePack(context) {
  if (context.electronPlatformName !== "win32") return;
  const { verifyWindowsVideoResources } = await import("./verify-video-resources.mjs");
  verifyWindowsVideoResources(join(context.packager.projectDir, "resources", "ffmpeg", "win-x64"));
};
