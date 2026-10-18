import { afterEach, describe, expect, it, vi } from "vitest";
import { getExecutor } from "../job-executor.js";
import type { Pool } from "pg";
import type { ExecutorContext } from "../job-executor.js";

const { providerGenerate, generateConfiguredVideoMock, resolveFeedInputImagesMock } = vi.hoisted(() => ({ providerGenerate: vi.fn(), generateConfiguredVideoMock: vi.fn(), resolveFeedInputImagesMock: vi.fn() }));
const { resolveImageModelMock, generateConfiguredImageMock, generateImageMock } = vi.hoisted(() => ({ resolveImageModelMock: vi.fn(), generateConfiguredImageMock: vi.fn(), generateImageMock: vi.fn() }));

vi.mock("../../../generation/video-generation.js", () => ({
  generateVideo: vi.fn((_provider: string, params: unknown) => providerGenerate(params)),
}));
vi.mock("../../../local-db/provider-generation.js", () => ({
  generateConfiguredVideo: generateConfiguredVideoMock.mockResolvedValue(null),
}));
vi.mock("../../../generation/providers/registry.js", () => ({
  resolveVideoProviderName: vi.fn().mockReturnValue("test-video-provider"),
  getVideoProvider: vi.fn().mockReturnValue({ name: "test-video-provider", models: [], generate: providerGenerate }),
  resolveImageProviderName: vi.fn(),
}));
vi.mock("../../../http/model-availability.js", () => ({ resolveConfiguredModel: resolveImageModelMock }));
vi.mock("../../../generation/image-generation.js", () => ({ generateImage: generateImageMock }));
vi.mock("../../../local-db/provider-generation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../local-db/provider-generation.js")>()),
  generateConfiguredVideo: generateConfiguredVideoMock.mockResolvedValue(null),
  generateConfiguredImage: generateConfiguredImageMock,
}));
vi.mock("./feed-render.js", () => ({
  recordFeedArtifact: vi.fn().mockResolvedValue(null),
  resolveFeedInputImages: resolveFeedInputImagesMock.mockResolvedValue([]),
}));

import "./video-generation.js";
import "./image-generation.js";

afterEach(() => vi.unstubAllGlobals());

function makeDb(options: { canvasId?: string | null; payload?: Record<string, unknown> } = {}) {
  const canvasContent = { elements: [] as Record<string, unknown>[] };
  const queries: string[] = [];
  let providerResult: Record<string, unknown> | null = null;
  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      queries.push(sql);
      if (sql.includes("select created_by, workspace_id")) return { rows: [{ created_by: "user-1", workspace_id: "workspace-1", canvas_id: options.canvasId === undefined ? "canvas-1" : options.canvasId, session_id: "session-1", status: "running", payload: options.payload ?? { prompt: "move product", model: "google-vertex/veo-3.1-generate-001", duration: 6 }, provider_result: providerResult }] };
      if (sql.includes("set provider_result")) { providerResult = values?.[0] as Record<string, unknown>; return { rows: [] }; }
      if (sql.includes("insert into asset_objects")) return { rows: [{ id: "asset-1" }] };
      if (sql.includes("select content from canvases")) return { rows: [{ content: canvasContent }] };
      if (sql.includes("update canvases set content")) {
        canvasContent.elements = JSON.parse(String(values?.[0])).elements;
        return { rows: [] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { db: { connect: vi.fn().mockResolvedValue(client), query: client.query } as unknown as Pool, client, queries, canvasContent, getProviderResult: () => providerResult };
}

function makeContext(db: Pool, storage: { upload: ReturnType<typeof vi.fn>; getPublicUrl: ReturnType<typeof vi.fn>; download?: ReturnType<typeof vi.fn> }, localDb = true): ExecutorContext {
  return {
    ...(localDb ? { localDb: db } : {}),
    storage: storage as never,
    jobService: { updateProgress: vi.fn(), saveProviderResult: vi.fn(async (jobId: string, result: Record<string, unknown>) => { await db.query("update background_jobs set provider_result = $1::jsonb where id = $2", [result, jobId]); }) } as never,
    pgmq: {} as never,
    getAdminClient: vi.fn() as never,
    env: {} as never,
    queue: "video_generation",
    msgId: 1,
    renewVt: vi.fn().mockResolvedValue(undefined),
    heartbeat: vi.fn().mockResolvedValue(undefined),
  };
}

describe("video generation worker persistence", () => {
  it("resumes from the Provider checkpoint after a transient download failure", async () => {
    const { db, getProviderResult } = makeDb({ canvasId: null });
    const storage = {
      upload: vi.fn().mockResolvedValue({ error: null }),
      getPublicUrl: vi.fn().mockResolvedValue({ data: { signedUrl: "https://assets.test/checkpoint.mp4" }, error: null }),
    };
    generateConfiguredVideoMock.mockResolvedValue({ url: "https://provider.test/video", mimeType: "video/mp4", width: 1280, height: 720, durationSeconds: 6 });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("temporary CDN error", { status: 502 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "video/mp4" } }));
    vi.stubGlobal("fetch", fetchMock);
    const run = getExecutor("video_generation");

    await expect(run!("job-checkpoint", {}, makeContext(db, storage))).rejects.toThrow(/Failed to download video: 502/);
    expect(getProviderResult()).toMatchObject({ url: "https://provider.test/video" });
    await expect(run!("job-checkpoint", {}, makeContext(db, storage))).resolves.toMatchObject({ asset_id: "asset-1" });

    expect(generateConfiguredVideoMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(storage.upload).toHaveBeenCalledTimes(1);
    expect(storage.upload.mock.calls[0]?.[1]).toBe("workspace-1/generated/job-checkpoint.mp4");
  });

  it("stops a minimax job before Provider submission when a resolver leaks inline input", async () => {
    const assetId = "3184dbec-d00b-4f1a-a8dc-4f63f4262ab7";
    const { db } = makeDb({
      canvasId: null,
      payload: {
        prompt: "animate this frame",
        model: "minimax-h3",
        duration: 5,
        input_asset_ids: [assetId],
        input_images: ["data:image/png;base64,Zmlyc3QtZnJhbWU="],
      },
    });
    const storage = {
      upload: vi.fn(),
      getPublicUrl: vi.fn(),
    };
    const providerCallsBefore = generateConfiguredVideoMock.mock.calls.length;
    resolveFeedInputImagesMock.mockResolvedValueOnce([
      "https://studio.example/api/provider-assets/reference?expires=1",
      "data:image/png;base64,Zmlyc3QtZnJhbWU=",
    ]);
    const run = getExecutor("video_generation");

    await expect(run!("job-inline-reference", {}, makeContext(db, storage))).rejects.toMatchObject({
      code: "invalid_input",
      message: expect.stringContaining("public HTTP(S)"),
    });

    expect(generateConfiguredVideoMock.mock.calls.length).toBe(providerCallsBefore);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("downloads, persists the asset, and inserts the video into its canvas", async () => {
    const { db, queries, canvasContent } = makeDb();
    const stored: { body?: Buffer; options?: Record<string, unknown> } = {};
    const storage = {
      upload: vi.fn(async (_bucket: string, _path: string, body: Buffer, options: Record<string, unknown>) => {
        stored.body = body;
        stored.options = options;
        return { error: null };
      }),
      getPublicUrl: vi.fn().mockResolvedValue({ data: { signedUrl: "https://assets.test/video.mp4" }, error: null }),
    };
    generateConfiguredVideoMock.mockResolvedValue({ url: "data:video/mp4;base64,AQID", mimeType: "video/mp4", width: 1920, height: 1080, durationSeconds: 6 });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const run = getExecutor("video_generation");
    expect(run).toBeTypeOf("function");

    const result = await run!("job-1", {}, makeContext(db, storage));

    expect(stored.body).toEqual(Buffer.from([1, 2, 3]));
    expect(stored.options).toMatchObject({ contentType: "video/mp4", upsert: true });
    expect(queries.some((sql) => sql.includes("insert into asset_objects"))).toBe(true);
    expect(canvasContent.elements).toHaveLength(1);
    expect(canvasContent.elements[0]).toMatchObject({ type: "embeddable", customData: expect.objectContaining({ assetId: "asset-1", jobId: "job-1" }) });
    expect(result).toMatchObject({ asset_id: "asset-1", signed_url: "/api/uploads/asset-1/file", canvas_element_id: expect.any(String) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("downloads an authenticated Google video URL and returns only the persisted asset URL", async () => {
    const { db } = makeDb();
    const assetInsert = vi.fn().mockReturnThis();
    const assetUpsert = vi.fn().mockReturnThis();
    const assetSelect = vi.fn().mockReturnThis();
    const assetSingle = vi.fn().mockResolvedValue({ data: { id: "asset-supabase" }, error: null });
    const canvases = new Map<string, Record<string, unknown>>([[
      "canvas-1",
      { elements: [] },
    ]]);
    const canvasQueries = vi.fn((table: string) => {
      const state = canvases.get("canvas-1")!;
      const builder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        update: vi.fn((value: { content: Record<string, unknown> }) => {
          if (value.content.elements) canvases.set("canvas-1", value.content);
          return builder;
        }),
        filter: vi.fn((_column: string, _operator: string, containment: string) => {
          const marker = JSON.parse(containment)[0].customData.jobId;
          if ((state.elements as Array<{ customData?: { jobId?: string } }>).some((element) => element.customData?.jobId === marker)) {
            builder.single = vi.fn().mockResolvedValue({ data: null, error: null });
          } else {
            builder.single = vi.fn().mockResolvedValue({ data: { id: "canvas-1" }, error: null });
          }
          return builder;
        }),
        maybeSingle: vi.fn().mockImplementation(async () => {
          const latestElements = (canvases.get("canvas-1")!.elements ?? []) as Array<{ customData?: { jobId?: string } }>;
          if (latestElements.some((element) => element.customData?.jobId === "job-auth-url")) return { data: { id: "canvas-1" }, error: null };
          return { data: { id: "canvas-1" }, error: null };
        }),
        single: vi.fn().mockResolvedValue({ data: { content: state }, error: null }),
      };
      if (table === "canvases") return builder;
      if (table === "background_jobs") return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { created_by: "user-1", workspace_id: "workspace-1", canvas_id: "canvas-1", session_id: "session-1", status: "running", payload: { prompt: "move product", model: "google-vertex/veo-3.1-generate-001", duration: 6 } }, error: null }) }) }) };
      if (table === "asset_objects") return { insert: assetInsert, upsert: assetUpsert, select: assetSelect, single: assetSingle };
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: null, error: null }) };
    });
    const admin = {
      from: canvasQueries,
    };
    const upload = vi.fn().mockResolvedValue({ error: null });
    const getPublicUrl = vi.fn().mockResolvedValue({ data: { signedUrl: "https://storage.test/signed/project-assets/video.mp4" }, error: null });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([7, 8, 9]), { status: 200, headers: { "content-type": "video/mp4" } }));
    vi.stubGlobal("fetch", fetchMock);
    providerGenerate.mockResolvedValue({ url: "https://generativelanguage.googleapis.com/video.mp4?key=secret", mimeType: "video/mp4", width: 1280, height: 720, durationSeconds: 6 });
    const ctx = makeContext(db, { upload, getPublicUrl }, false);
    ctx.getAdminClient = vi.fn(() => admin as never);
    const run = getExecutor("video_generation");
    const result = await run!("job-auth-url", {}, ctx);

    expect(fetchMock).toHaveBeenCalledWith("https://generativelanguage.googleapis.com/video.mp4?key=secret", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(upload).toHaveBeenCalledWith("project-assets", "workspace-1/generated/job-auth-url.mp4", Buffer.from([7, 8, 9]), { contentType: "video/mp4", upsert: true });
    expect(assetUpsert).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: "workspace-1", bucket: "project-assets", mime_type: "video/mp4", byte_size: 3 }), { onConflict: "object_path" });
    expect(getPublicUrl).toHaveBeenCalledWith("project-assets", expect.stringMatching(/job-auth-url\.mp4$/));
    expect(result.signed_url).toBe("https://storage.test/signed/project-assets/video.mp4");
    expect((canvases.get("canvas-1")!.elements as Array<Record<string, unknown>>)[0]).toMatchObject({ link: result.signed_url, customData: { jobId: "job-auth-url", assetId: "asset-supabase" } });
    expect(result.canvas_element_id).toBeTypeOf("string");
    expect(JSON.stringify(result)).not.toContain("key=secret");
  });

  it("returns a sync-pending result when Canvas insertion fails after Provider success", async () => {
    const { db } = makeDb();
    const assetInsert = vi.fn().mockReturnThis();
    const assetUpsert = vi.fn().mockReturnThis();
    const assetSelect = vi.fn().mockReturnThis();
    const assetSingle = vi.fn().mockResolvedValue({ data: { id: "asset-retry" }, error: null });
    const elements: Array<Record<string, unknown>> = [];
    let failCanvasWrite = true;
    const admin = {
      from: vi.fn((table: string) => {
        if (table === "background_jobs") {
          return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { created_by: "user-1", workspace_id: "workspace-1", canvas_id: "canvas-1", session_id: "s", status: "running", payload: { prompt: "x", model: "google-vertex/veo-3.1-generate-001", duration: 6 } }, error: null }) }) }) };
        }
        if (table === "asset_objects") return { insert: assetInsert, upsert: assetUpsert, select: assetSelect, single: assetSingle };
        if (table !== "canvases") return {};

        let candidateElements: Array<Record<string, unknown>> = [];
        const builder = {
          update: vi.fn((value: { content?: { elements?: Array<Record<string, unknown>> } }) => { candidateElements = value.content?.elements ?? []; return builder; }),
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockImplementation(async () => {
            if (!candidateElements.length) return { data: { content: { elements } }, error: null };
            if (failCanvasWrite) {
              failCanvasWrite = false;
              return { data: null, error: { message: "temporary canvas write failure" } };
            }
            elements.splice(0, elements.length, ...candidateElements);
            return { data: { id: "canvas-1" }, error: null };
          }),
          single: vi.fn().mockResolvedValue({ data: { content: { elements } }, error: null }),
          filter: vi.fn().mockReturnThis(),
        };
        return builder;
      }),
    };
    const storage = {
      upload: vi.fn().mockResolvedValue({ error: null }),
      getPublicUrl: vi.fn().mockResolvedValue({ data: { signedUrl: "https://storage.test/retry.mp4" }, error: null }),
    };
    providerGenerate.mockResolvedValue({ url: "data:video/mp4;base64,AQID", mimeType: "video/mp4", width: 1280, height: 720, durationSeconds: 6 });
    const ctx = makeContext(db, storage, false);
    ctx.getAdminClient = vi.fn(() => admin as never);
    const run = getExecutor("video_generation");

    await expect(run!("job-retry", {}, ctx)).resolves.toMatchObject({ sync_pending: true, sync_error_code: "canvas_sync_failed" });
    expect(storage.upload).toHaveBeenCalledOnce();
    expect(elements.filter((element) => (element.customData as { jobId?: string })?.jobId === "job-retry")).toHaveLength(0);
  });

  it("does not upload or register an asset when the provider MIME conflicts with the downloaded video", async () => {
    const { db, queries, canvasContent } = makeDb();
    const storage = {
      upload: vi.fn().mockResolvedValue({ error: null }),
      getPublicUrl: vi.fn(),
    };
    generateConfiguredVideoMock.mockResolvedValue({ url: "https://provider.test/video", mimeType: "video/mp4", width: 1920, height: 1080, durationSeconds: 6 });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "video/webm" } })));
    const run = getExecutor("video_generation");

    await expect(run!("job-2", {}, makeContext(db, storage))).rejects.toThrow(/MIME type does not match/);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(queries.some((sql) => sql.includes("insert into asset_objects"))).toBe(false);
    expect(canvasContent.elements).toHaveLength(0);
  });

  it.each([401, 403])("does not persist provider video when authenticated download returns HTTP %s", async (status) => {
    const { db, queries, canvasContent } = makeDb();
    const storage = { upload: vi.fn().mockResolvedValue({ error: null }), getPublicUrl: vi.fn() };
    generateConfiguredVideoMock.mockResolvedValue({ url: "https://generativelanguage.googleapis.com/video.mp4?key=secret", mimeType: "video/mp4", width: 1280, height: 720, durationSeconds: 6 });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response("auth denied", { status })));
    const run = getExecutor("video_generation");

    await expect(run!("job-denied", {}, makeContext(db, storage))).rejects.toThrow(`Failed to download video: ${status}`);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(queries.some((sql) => sql.includes("insert into asset_objects"))).toBe(false);
    expect(canvasContent.elements).toHaveLength(0);
  });

  it("does not register an asset when Storage rejects the video upload", async () => {
    const { db, queries, canvasContent } = makeDb();
    const storage = {
      upload: vi.fn().mockResolvedValue({ error: new Error("storage offline") }),
      getPublicUrl: vi.fn(),
    };
    generateConfiguredVideoMock.mockResolvedValue({ url: "data:video/mp4;base64,AQID", mimeType: "video/mp4", width: 1280, height: 720, durationSeconds: 6 });
    const run = getExecutor("video_generation");

    await expect(run!("job-upload-failed", {}, makeContext(db, storage))).rejects.toThrow(/Storage upload failed: storage offline/);
    expect(storage.upload).toHaveBeenCalledOnce();
    expect(queries.some((sql) => sql.includes("insert into asset_objects"))).toBe(false);
    expect(canvasContent.elements).toHaveLength(0);
  });

  it("dead-letters a retired image job before configured rerouting or provider generation", async () => {
    const query = vi.fn(async (sql: string) => sql.includes("select created_by, workspace_id")
      ? { rows: [{ created_by: "user-1", workspace_id: "workspace-1", canvas_id: null, session_id: "s", status: "running", payload: { prompt: "edit", model: "doubao-seededit-3-0-i2i-250628" } }] }
      : { rows: [] });
    const db = { query } as unknown as Pool;
    const ctx = makeContext(db, { upload: vi.fn(), getPublicUrl: vi.fn() });
    const run = getExecutor("image_generation");

    await expect(run!("job-retired", {}, ctx)).rejects.toMatchObject({ code: "model_not_found", message: expect.stringContaining("retired") });
    expect(resolveImageModelMock).not.toHaveBeenCalled();
    expect(generateConfiguredImageMock).not.toHaveBeenCalled();
    expect(generateImageMock).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
