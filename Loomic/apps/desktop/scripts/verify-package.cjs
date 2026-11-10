const { closeSync, openSync, readSync, existsSync, statSync } = require("node:fs");
const { join } = require("node:path");

function readAsarFiles(path) {
  const fd = openSync(path, "r");
  try {
    const prefix = Buffer.alloc(16);
    readSync(fd, prefix, 0, 16, 0);
    const size = prefix.readUInt32LE(12);
    if (size < 2 || size > 16 * 1024 * 1024) throw new Error("Invalid app.asar header size.");
    const header = Buffer.alloc(size);
    readSync(fd, header, 0, size, 16);
    const paths = new Map();
    const walk = (tree, parent = "") => {
      for (const [name, entry] of Object.entries(tree.files ?? {})) {
        const path = parent + name;
        if (entry.files) walk(entry, `${path}/`);
        else paths.set(path, entry);
      }
    };
    walk(JSON.parse(header.toString("utf8")));
    return paths;
  } finally { closeSync(fd); }
}

function verifyPackage(directory, platform, productName = "Helstera") {
  const resources = platform === "darwin" ? join(directory, `${productName}.app`, "Contents", "Resources") : join(directory, "resources");
  const files = readAsarFiles(join(resources, "app.asar"));
  const required = ["dist-electron/main.js", "dist-electron/preload.js", "dist-electron/recorder-preload.js",
    "node_modules/tesseract.js/src/index.js", "node_modules/ws/index.js",
    `node_modules/@nut-tree/libnut-${platform}/build/Release/libnut.node`];
  for (const core of ["tesseract-core", "tesseract-core-lstm", "tesseract-core-simd", "tesseract-core-simd-lstm", "tesseract-core-relaxedsimd", "tesseract-core-relaxedsimd-lstm"]) {
    required.push(`node_modules/tesseract.js-core/${core}.js`, `node_modules/tesseract.js-core/${core}.wasm`);
  }
  for (const path of required) {
    const entry = files.get(path);
    if (!entry?.size) throw new Error(`Packaged runtime resource missing: ${path}`);
    if (entry.unpacked && !existsSync(join(resources, "app.asar.unpacked", path))) throw new Error(`Unpacked resource missing: ${path}`);
  }
  for (const path of files.keys()) {
    if (path !== "package.json" && !/^(dist\/|dist-electron\/|node_modules\/)/.test(path)) {
      throw new Error(`Unintended development file in package: ${path}`);
    }
    if (/tesseract\.js-core\/.*\.wasm\.js$|^dist-electron\/.+\/|node_modules\/(react|react-dom)\//.test(path)) throw new Error(`Duplicate build resource in package: ${path}`);
    const native = path.match(/node_modules\/@nut-tree\/libnut-(win32|linux|darwin)\//);
    if (native && native[1] !== platform) throw new Error(`Wrong-platform native resource: ${path}`);
  }
  for (const path of ["icon.png", "startup.html", "startup.css", "startup.js", "setup.html", "setup.css", "setup.js", "snapshots.html", "snapshots.css", "snapshots.js", "licenses/react.txt", "licenses/react-dom.txt"]) {
    if (!existsSync(join(resources, path)) || !statSync(join(resources, path)).size) throw new Error(`Desktop support resource missing: ${path}`);
  }
  return { files: files.size, asarBytes: statSync(join(resources, "app.asar")).size };
}

exports.verifyPackage = verifyPackage;
exports.default = async (context) => {
  const report = verifyPackage(context.appOutDir, context.electronPlatformName, context.packager.appInfo.productFilename);
  if (context.electronPlatformName === "win32") {
    const { verifyWindowsVideoResources } = await import("./verify-video-resources.mjs");
    verifyWindowsVideoResources(join(context.appOutDir, "resources", "ffmpeg", "win-x64"));
  }
  console.log("DESKTOP_PACKAGE_VERIFIED", JSON.stringify(report));
};
