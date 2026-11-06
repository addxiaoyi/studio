import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivateVideoConflict, savePrivateVideo } from "../features/assets/private-video.js";
import { registerPrivateVideoRoutes } from "./private-video.js";

vi.mock("../features/assets/private-video.js", async (load) => ({
  ...(await load<typeof import("../features/assets/private-video.js")>()),
  savePrivateVideo: vi.fn(),
}));

const apps: Array<ReturnType<typeof Fastify>> = [];
const key = "123e4567-e89b-42d3-a456-426614174000";

async function setup(authenticated = true) {
  const app = Fastify();
  apps.push(app);
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
  registerPrivateVideoRoutes(app, {
    auth: { authenticate: vi.fn().mockResolvedValue(authenticated ? { id: "user" } : null) } as never,
    viewerService: { ensureViewer: vi.fn().mockResolvedValue({ workspace: { id: "workspace" } }) } as never,
    db: {} as never, storage: {} as never,
  });
  await app.ready();
  return app;
}

function body(type: string, bytes: Buffer) {
  return Buffer.concat([
    Buffer.from(`--test-boundary\r\nContent-Disposition: form-data; name="file"; filename="video"\r\nContent-Type: ${type}\r\n\r\n`),
    bytes,
    Buffer.from("\r\n--test-boundary--\r\n"),
  ]);
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); vi.resetAllMocks(); });

describe("private video route", () => {
  const headers = { "content-type": "multipart/form-data; boundary=test-boundary", "idempotency-key": key };
  const mp4 = Buffer.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

  it("requires authentication and a valid idempotency key", async () => {
    const anonymous = await setup(false);
    expect((await anonymous.inject({ method: "POST", url: "/api/assets/private-video", headers, payload: body("video/mp4", mp4) })).statusCode).toBe(401);
    const app = await setup();
    expect((await app.inject({ method: "POST", url: "/api/assets/private-video", headers: { ...headers, "idempotency-key": "bad" }, payload: body("video/mp4", mp4) })).statusCode).toBe(400);
    expect(savePrivateVideo).not.toHaveBeenCalled();
  });

  it("saves verified video to the authenticated workspace and supports retries", async () => {
    vi.mocked(savePrivateVideo).mockResolvedValueOnce({ assetId: "asset", created: true }).mockResolvedValueOnce({ assetId: "asset", created: false });
    const app = await setup();
    const send = () => app.inject({ method: "POST", url: "/api/assets/private-video", headers, payload: body("video/mp4", mp4) });
    expect((await send()).statusCode).toBe(201);
    const retry = await send();
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ assetId: "asset", created: false });
    expect(savePrivateVideo).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ userId: "user", workspaceId: "workspace", uploadId: key, bytes: mp4 }));
  });

  it("rejects a spoofed file and reports idempotency conflicts", async () => {
    const app = await setup();
    const invalid = await app.inject({ method: "POST", url: "/api/assets/private-video", headers, payload: body("video/mp4", Buffer.from("not a video")) });
    expect(invalid.statusCode).toBe(400);
    vi.mocked(savePrivateVideo).mockRejectedValueOnce(new PrivateVideoConflict("conflict"));
    const conflict = await app.inject({ method: "POST", url: "/api/assets/private-video", headers, payload: body("video/mp4", mp4) });
    expect(conflict.statusCode).toBe(409);
  });
});
