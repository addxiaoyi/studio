import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createProviderAssetUrl } from "../features/uploads/provider-asset-url.js";
import { createPrivateVideoFixture } from "../local-db/private-video-fixture.js";

afterEach(() => vi.unstubAllEnvs());

function testDatabase(): string {
  const url = process.env.HELT_TEST_DATABASE_URL;
  if (!url)
    throw new Error("Provider lifecycle tests require a local database.");
  return url;
}

it.skipIf(!process.env.HELT_TEST_DATABASE_URL)(
  "revokes provider links when the private asset is deleted, expired or its owner loses membership",
  async () => {
    const fixture = await createPrivateVideoFixture(testDatabase());
    const secret = "provider-asset-lifecycle-fixture";
    vi.stubEnv("PROVIDER_CONFIG_ENCRYPTION_KEY", secret);
    try {
      const id = randomUUID();
      const path = `${fixture.workspaceId}/${id}.webp`;
      const bytes = Buffer.from("private reference image");
      await mkdir(join(fixture.root, "private-try-on", fixture.workspaceId), {
        recursive: true,
      });
      await writeFile(join(fixture.root, "private-try-on", path), bytes);
      await fixture.db.query(
        "insert into asset_objects(id,workspace_id,created_by,bucket,object_path,mime_type,byte_size) values($1,$2,$3,'private-try-on',$4,'image/webp',$5)",
        [id, fixture.workspaceId, fixture.userId, path, bytes.length],
      );
      await fixture.db.query(
        "insert into generated_assets(workspace_id,created_by,media_type,object_path,mime_type,title) values($1,$2,'image',$3,'image/webp','provider reference')",
        [fixture.workspaceId, fixture.userId, path],
      );
      const signed = new URL(
        createProviderAssetUrl({
          origin: "https://studio.example",
          assetId: id,
          secret,
        }),
      );
      const providerPath = signed.pathname + signed.search;
      const ordinaryPath = `/api/uploads/${id}/file`;
      const headers = { authorization: `Bearer ${fixture.token}` };
      const active = await fixture.app.inject(providerPath);
      expect(active.statusCode).toBe(200);
      expect(active.rawPayload).toEqual(bytes);

      await fixture.db.query(
        "update generated_assets set deleted_at=now(),retention_state='soft_deleted',purge_after=now()+interval '7 days' where object_path=$1",
        [path],
      );
      expect(
        (await fixture.app.inject({ url: ordinaryPath, headers })).statusCode,
      ).toBe(404);
      expect((await fixture.app.inject(providerPath)).statusCode).toBe(404);

      await fixture.db.query(
        "update generated_assets set deleted_at=null,retention_state='active',retention_until=now()-interval '1 second' where object_path=$1",
        [path],
      );
      expect((await fixture.app.inject(providerPath)).statusCode).toBe(404);

      await fixture.db.query(
        "update generated_assets set retention_until=now()+interval '3 days' where object_path=$1",
        [path],
      );
      expect((await fixture.app.inject(providerPath)).statusCode).toBe(200);
      await fixture.db.query(
        "delete from workspace_members where workspace_id=$1 and user_id=$2",
        [fixture.workspaceId, fixture.userId],
      );
      expect((await fixture.app.inject(providerPath)).statusCode).toBe(404);
      expect(active.headers["cache-control"]).toBe("private, no-store");
    } finally {
      await fixture.close();
    }
  },
);

it.skipIf(!process.env.HELT_TEST_DATABASE_URL)(
  "expires private source uploads without generated metadata while retaining active shared references",
  async () => {
    const fixture = await createPrivateVideoFixture(testDatabase());
    const secret = "provider-source-retention-fixture";
    vi.stubEnv("PROVIDER_CONFIG_ENCRYPTION_KEY", secret);
    try {
      for (const bucket of ["private-try-on", "project-assets"]) {
        const id = randomUUID();
        const path = `${fixture.workspaceId}/${id}.webp`;
        await mkdir(join(fixture.root, bucket, fixture.workspaceId), {
          recursive: true,
        });
        await writeFile(join(fixture.root, bucket, path), "reference image");
        await fixture.db.query(
          "insert into asset_objects(id,workspace_id,created_by,bucket,object_path,mime_type,created_at) values($1,$2,$3,$4,$5,'image/webp',now()-interval '4 days')",
          [id, fixture.workspaceId, fixture.userId, bucket, path],
        );
        const signed = new URL(
          createProviderAssetUrl({
            origin: "https://studio.example",
            assetId: id,
            secret,
          }),
        );
        expect(
          (await fixture.app.inject(signed.pathname + signed.search))
            .statusCode,
        ).toBe(bucket === "private-try-on" ? 404 : 200);
      }
    } finally {
      await fixture.close();
    }
  },
);
