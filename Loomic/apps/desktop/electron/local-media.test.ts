import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { LocalMedia } from "./local-media.js";

it("streams seek ranges, rejects changed files and revokes grants when the workspace changes", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "helstera-preview-")));
  try {
    let selected = root;
    const media = new LocalMedia(async () => selected);
    const path = join(root, "video.mp4"); await writeFile(path, "0123456789");
    const url = await media.grant(root, path, "video/mp4");
    const response = await media.respond(new Request(url, { headers: { Range: "bytes=3-6" } }));
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 3-6/10");
    expect(await response.text()).toBe("3456");
    expect((await media.respond(new Request(url, { headers: { Range: "bytes=99-" } }))).status).toBe(416);
    selected = join(root, "another");
    expect((await media.respond(new Request(url))).status).toBe(410);
    selected = root; await writeFile(path, "changed");
    expect((await media.respond(new Request(url))).status).toBe(410);
    expect((await media.respond(new Request("helstera-media://local/unknown"))).status).toBe(404);
  } finally { await rm(root, { recursive: true, force: true }); }
});
