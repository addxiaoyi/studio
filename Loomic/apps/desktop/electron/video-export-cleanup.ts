import { rm } from "node:fs/promises";

export type VideoExportResult = { path: string; cleanupWarnings?: string[] };

export async function withVideoExportCleanup(
  directory: string,
  work: () => Promise<VideoExportResult>,
  cleanup: (path: string) => Promise<void> = (path) => rm(path, { recursive: true, force: true }),
): Promise<VideoExportResult> {
  let saved: VideoExportResult;
  try {
    saved = await work();
  } catch (error) {
    try { await cleanup(directory); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], `Video export failed and temporary files could not be removed: ${directory}`); }
    throw error;
  }
  try {
    await cleanup(directory);
    return saved;
  } catch {
    return { ...saved, cleanupWarnings: [...(saved.cleanupWarnings ?? []), directory] };
  }
}
