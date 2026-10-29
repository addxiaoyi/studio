"""Prepare a website-only release against a verified production source snapshot."""

import hashlib
import json
import pathlib
import shutil
import tarfile

from importlib.machinery import SourceFileLoader

ROOT = pathlib.Path(__file__).resolve().parents[1]
ssh = SourceFileLoader("website_ssh", str(ROOT / "scripts/inspect-website-release.py")).load_module()
CANDIDATE = ROOT / "release-candidates/website-minimax-20261024"
BACKEND = [
    "apps/server/src/http/video-models.ts",
    "apps/server/src/http/model-availability.ts",
    "apps/server/src/http/jobs.ts", "apps/server/src/http/generate.ts",
    "apps/server/src/features/credits/tier-guard.ts",
    "apps/server/src/agent/message-billing.ts", "apps/server/src/http/runs.ts",
    "apps/server/src/ws/handler.ts",
    "apps/server/src/agent/tools/video-generate.ts",
    "apps/server/src/generation/types.ts",
    "apps/server/src/generation/providers/replicate-video.ts",
]


def replace_once(text, before, after):
    if text.count(before) != 1:
        raise RuntimeError("Production source anchor changed: " + before[:100])
    return text.replace(before, after, 1)


def main():
    if CANDIDATE.exists():
        raise RuntimeError("Candidate already exists; inspect it before preparing another")
    client, proxy = ssh.connect()
    archive = ROOT / "release-candidates/website-production-source.tar.gz"
    try:
        remote_archive = ssh.run(client, "mktemp /www/helstera/.website-source.XXXXXX.tar.gz")
        if not remote_archive.startswith("/www/helstera/.website-source."):
            raise RuntimeError("Unexpected remote archive path")
        ssh.run(client, "cd /www/helstera && tar -czf " + remote_archive + " apps/server/src apps/server/package.json apps/server/tsconfig.json packages/shared/dist packages/shared/package.json packages/config package.json", timeout=120)
        with client.open_sftp() as sftp:
            sftp.get(remote_archive, str(archive))
    finally:
        client.close()
        proxy.close()
    with tarfile.open(archive) as bundle:
        bundle.extractall(CANDIDATE, filter="data")
    baseline = {}
    for path in CANDIDATE.rglob("*"):
        if path.is_file():
            baseline[path.relative_to(CANDIDATE).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    for relative in BACKEND:
        shutil.copy2(ROOT / relative, CANDIDATE / relative)
    # These files contain website billing only. Preserve production desktop contracts.
    for name in ("credits.js", "credits.d.ts", "upstream-pricing.js", "upstream-pricing.d.ts"):
        shutil.copy2(ROOT / "packages/shared/dist" / name, CANDIDATE / "packages/shared/dist" / name)
    shutil.copy2(ROOT / "packages/shared/dist/contracts.d.ts", CANDIDATE / "packages/shared/dist/contracts.d.ts")
    for name in ("index.js", "index.d.ts"):
        index = CANDIDATE / "packages/shared/dist" / name
        content = index.read_text("utf-8")
        if 'export * from "./upstream-pricing.js";' not in content:
            index.write_text(content + '\nexport * from "./upstream-pricing.js";\n', encoding="utf-8")
    handler = CANDIDATE / "apps/server/src/ws/handler.ts"
    content = handler.read_text("utf-8")
    content = content.replace('            ...(p.desktopExecutionContext !== undefined\n              ? { desktopExecutionContext: p.desktopExecutionContext }\n              : {}),\n', '')
    handler.write_text(content, encoding="utf-8")
    contracts = CANDIDATE / "packages/shared/dist/contracts.js"
    content = contracts.read_text("utf-8")
    content = replace_once(content,
        'export const videoGenerationPreferenceSchema = z.object({\n    mode: z.enum(["auto", "manual"]),\n    models: z.array(z.string().min(1)),\n    duration: z.number().int().min(1).optional(),',
        'export const videoGenerationPreferenceSchema = z.object({\n    mode: z.enum(["auto", "manual"]),\n    models: z.array(z.string().min(1)),\n    duration: z.number().int().min(1).optional(),\n    resolution: z.enum(["480p", "720p", "768p", "1080p", "1088p", "1440p", "2160p", "4k"]).optional(),')
    contracts.write_text(content, encoding="utf-8")
    # Runtime is patched from production so unfinished desktop execution changes stay local.
    runtime = CANDIDATE / "apps/server/src/agent/runtime.ts"
    content = runtime.read_text("utf-8")
    content = 'import { resolveVideoResolution, type VideoResolution } from "@helstera/shared";\nimport { accumulateAgentTokenUsage } from "./message-billing.js";\n' + content
    content = replace_once(content, '  const body = modelXml ? `\\n  ${modelXml}\\n` : "";', '  const resolutionXml = videoGenerationPreference.resolution ? ` resolution="${escapeXmlAttribute(videoGenerationPreference.resolution)}"` : "";\n  const body = modelXml ? `\\n  ${modelXml}\\n` : "";')
    content = replace_once(content, '${durationXml}>${body}${strictXml}', '${durationXml}${resolutionXml}>${body}${strictXml}')
    content = replace_once(content, '  controller: AbortController;', '  controller: AbortController;\n  modelUsage: { inputTokens: number; outputTokens: number };\n  modelUsageSettlement: Promise<void>;\n  tokenUsageChargeError?: string;\n  onModelUsage?: (usage: { inputTokens: number; outputTokens: number }) => Promise<void>;')
    content = replace_once(content, 'runOptions?: { accessToken?: string;', 'runOptions?: { deferBillingUntilUsage?: boolean; onModelUsage?: (usage: { inputTokens: number; outputTokens: number }) => Promise<void>; onModelUsageError?: (runId: string, error: unknown) => void; accessToken?: string;')
    content = replace_once(content, '        controller: new AbortController(),', '        controller: new AbortController(),\n        modelUsage: { inputTokens: 0, outputTokens: 0 },\n        modelUsageSettlement: Promise.resolve(),\n        ...(runOptions?.onModelUsage ? { onModelUsage: runOptions.onModelUsage } : {}),')
    content = replace_once(content, '    async *streamRun(runId: string)', '    getModelUsage(runId: string) { return runs.get(runId)?.modelUsage ?? null; },\n\n    async *streamRun(runId: string)')
    content = replace_once(content, '        onModelUsage: (usage) => {', '''        onModelUsage: (usage) => {
          run.modelUsage = accumulateAgentTokenUsage(run.modelUsage, { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 });
          const cumulativeUsage = { ...run.modelUsage };
          const settle = run.onModelUsage;
          if (settle) run.modelUsageSettlement = run.modelUsageSettlement.then(() => settle(cumulativeUsage)).catch((error: unknown) => {
            run.tokenUsageChargeError = error instanceof Error ? error.message : String(error);
            console.error("[agent-billing] settlement failed", {runId});
          });''')
    content = replace_once(content, '        run.status = mapEventToStatus(event);', '        if (isTerminalEvent(event)) {\n          await run.modelUsageSettlement;\n          if (run.tokenUsageChargeError) throw new Error("Token usage settlement failed");\n        }\n        run.status = mapEventToStatus(event);')
    content = replace_once(content, '          if (selectedDuration != null) {', '          if (run.videoGenerationPreference?.resolution) input = { ...input, resolution: run.videoGenerationPreference.resolution };\n          if (selectedDuration != null) {')
    content = replace_once(content, '            input = { ...input, model: model.model_id };', '            const outputResolution = resolveVideoResolution(model.model_id, input.resolution as VideoResolution | undefined);\n            input = { ...input, model: model.model_id, ...(outputResolution ? { resolution: outputResolution } : {}) };')
    runtime.write_text(content, encoding="utf-8")
    changes = {}
    for relative, previous in baseline.items():
        path = CANDIDATE / relative
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != previous:
            changes[relative] = {"before": previous, "after": digest}
    (CANDIDATE / "WEBSITE-MANIFEST.json").write_text(json.dumps({"files": changes}, indent=2), encoding="utf-8")
    print(json.dumps({"candidate": str(CANDIDATE), "files": list(changes)}, indent=2), flush=True)


if __name__ == "__main__":
    main()
