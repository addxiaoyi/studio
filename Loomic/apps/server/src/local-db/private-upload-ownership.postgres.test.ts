import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createLocalUploadService } from "./upload-service.js";

describe.skipIf(!process.env.HELT_TEST_DATABASE_URL)("private upload ownership", () => {
  it("blocks another team member from deleting private media while preserving shared uploads", async () => {
    const url = new URL(process.env.HELT_TEST_DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Use local test PostgreSQL only.");
    const admin = new Pool({ connectionString: url.href });
    const schema = `private_upload_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`create schema ${schema}`);
    const db = new Pool({ connectionString: url.href, options: `-c search_path=${schema}` });
    const root = await mkdtemp(join(tmpdir(), "private-upload-"));
    try {
      await db.query("create table workspace_members(workspace_id uuid,user_id uuid); create table asset_objects(id uuid primary key,workspace_id uuid,created_by uuid,bucket text,object_path text)");
      const owner = randomUUID(), member = randomUUID(), workspace = randomUUID();
      await db.query("insert into workspace_members values($1,$2),($1,$3)", [workspace, owner, member]);
      const service = createLocalUploadService(db, root);
      for (const bucket of ["private-video", "private-try-on"]) {
        const id = randomUUID();
        await mkdir(join(root, bucket));
        await writeFile(join(root, bucket, "original"), "private media");
        await db.query("insert into asset_objects values($1,$2,$3,$4,'original')", [id, workspace, owner, bucket]);
        await expect(service.getAssetUrl({ id: member } as never, id)).rejects.toMatchObject({ code: "asset_not_found" });
        await expect(service.deleteAsset({ id: member } as never, id)).rejects.toMatchObject({ code: "asset_not_found" });
        expect(await readFile(join(root, bucket, "original"), "utf8")).toBe("private media");
        expect(await service.getAssetUrl({ id: owner } as never, id)).toBe(`/api/uploads/${id}/file`);
        await service.deleteAsset({ id: owner } as never, id);
        expect((await db.query("select id from asset_objects where id=$1", [id])).rows).toEqual([]);
      }
      const shared = randomUUID();
      await db.query("insert into asset_objects values($1,$2,$3,'project-assets','shared')", [shared, workspace, owner]);
      expect(await service.getAssetUrl({ id: member } as never, shared)).toBe(`/api/uploads/${shared}/file`);
    } finally {
      await db.end();
      await admin.query(`drop schema ${schema} cascade`);
      await admin.end();
      await rm(root, { recursive: true, force: true });
    }
  });
});
