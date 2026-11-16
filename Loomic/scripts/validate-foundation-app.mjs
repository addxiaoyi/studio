import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const mode = process.argv[2] ?? "typecheck";
const cwd = process.cwd();
if (!["build", "typecheck"].includes(mode)) {
  throw new Error(`Unknown validation mode: ${mode}`);
}
const outputDir = path.join(cwd, "dist");
const marker = path.join(outputDir, ".helstera-build");
if (mode === "build") await rm(marker, { force: true });

const formatHost = {
  getCurrentDirectory: () => cwd,
  getCanonicalFileName: (fileName) => fileName,
  getNewLine: () => ts.sys.newLine,
};

const manifest = JSON.parse(
  await readFile(path.join(cwd, "package.json"), "utf8"),
);

if (
  !manifest.private ||
  manifest.type !== "module" ||
  typeof manifest.name !== "string" ||
  !manifest.name.startsWith("@helstera/")
) {
  throw new Error(
    "App manifests must stay private, ESM, and scoped under @helstera/.",
  );
}

const configResult = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
if (configResult.error) {
  throw new Error(
    ts.formatDiagnosticsWithColorAndContext([configResult.error], formatHost),
  );
}

const parsed = ts.parseJsonConfigFileContent(configResult.config, ts.sys, cwd);
if (parsed.errors.length > 0) {
  throw new Error(
    ts.formatDiagnosticsWithColorAndContext(parsed.errors, formatHost),
  );
}

if (parsed.options.noEmit !== true) {
  throw new Error(
    "App tsconfig files must set noEmit=true for the TypeScript runtime.",
  );
}

const program = ts.createProgram({
  rootNames: parsed.fileNames,
  options: parsed.options,
  projectReferences: parsed.projectReferences,
});
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length > 0) {
  throw new Error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost),
  );
}

if (mode === "build") {
  await mkdir(outputDir, { recursive: true });
  await writeFile(marker, "TypeScript runtime validated\n", "utf8");
}
