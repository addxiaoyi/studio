import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { expect, it, vi } from "vitest";
import { registerUploadRoutes } from "./uploads.js";

it("accepts private timeline audio and rejects mislabeled or try-on audio before storage", async () => {
  const app = Fastify(),
    uploadFile = vi.fn(async () => ({
      asset: {
        id: "11111111-1111-4111-8111-111111111111",
        workspaceId: "22222222-2222-4222-8222-222222222222",
        projectId: null,
        bucket: "private-video",
        objectPath: "audio/test.wav",
        mimeType: "audio/wav",
        byteSize: 44,
        createdAt: new Date().toISOString(),
      },
      url: "/api/uploads/test/file",
    }));
  await app.register(multipart);
  await registerUploadRoutes(app, {
    auth: { authenticate: async () => ({ id: "user" }) } as never,
    viewerService: {
      ensureViewer: async () => ({
        workspace: { id: "22222222-2222-4222-8222-222222222222" },
      }),
    } as never,
    uploadService: { uploadFile } as never,
  });
  const wav = Buffer.alloc(44);
  wav.write("RIFF");
  wav.write("WAVE", 8);
  const send = (bytes: Buffer, purpose = "timeline-audio") =>
    app.inject({
      method: "POST",
      url: `/api/uploads?purpose=${purpose}`,
      headers: { "content-type": "multipart/form-data; boundary=media" },
      payload: Buffer.concat([
        Buffer.from(
          '--media\r\nContent-Disposition: form-data; name="file"; filename="sound.wav"\r\nContent-Type: audio/wav\r\n\r\n',
        ),
        bytes,
        Buffer.from("\r\n--media--\r\n"),
      ]),
    });
  try {
    const accepted = await send(wav);
    expect(accepted.statusCode, accepted.body).toBe(201);
    expect(uploadFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bucket: "private-video",
        mimeType: "audio/wav",
      }),
    );
    expect((await send(Buffer.from("not audio"))).statusCode).toBe(400);
    expect((await send(wav, "try-on")).statusCode).toBe(400);
    expect(uploadFile).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
});
