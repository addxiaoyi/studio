import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { createGalleryBrowserFixture } from "../../server/src/features/assets/gallery-browser-fixture";

let fixture: Awaited<ReturnType<typeof createGalleryBrowserFixture>>;
test.beforeAll(async () => {
  const database = process.env.HELT_TEST_DATABASE_URL;
  if (!database)
    throw new Error(
      "Set an explicit loopback test database for Gallery acceptance.",
    );
  fixture = await createGalleryBrowserFixture(database, resolve("out"));
});
test.afterAll(async () => {
  await fixture?.close();
});

test("published image and video decode publicly while withdrawal and private access stay enforced", async ({
  browser,
  context,
  page,
}, info) => {
  const ownerHeaders = { authorization: `Bearer ${fixture.owner.accessToken}` };
  const peerHeaders = { authorization: `Bearer ${fixture.peer.accessToken}` };
  const caption = {
    vtt: "WEBVTT\n\n00:00.000 --> 00:01.000\nFirst caption\n\n00:01.000 --> 00:02.000\nSecond caption",
    language: "en",
    label: "English captions",
    consent: true,
  };
  const publication = async (assetId: string, withCaption = false) => {
    const response = await context.request.post(
      `${fixture.api}/api/gallery/${assetId}/publish`,
      { headers: ownerHeaders, data: withCaption ? { caption } : {} },
    );
    expect(response.status()).toBe(200);
    return String((await response.json()).data.id);
  };
  expect(
    (await context.request.get(`${fixture.api}/api/gallery`)).status(),
  ).toBe(200);
  expect(
    (await (await context.request.get(`${fixture.api}/api/gallery`)).json())
      .data,
  ).toEqual([]);
  expect(
    (
      await context.request.post(
        `${fixture.api}/api/gallery/${fixture.imageId}/publish`,
        { headers: peerHeaders },
      )
    ).status(),
  ).toBe(404);
  const imageGallery = await publication(fixture.imageId);
  await context.addCookies([
    {
      name: "gallery_test_session",
      value: fixture.owner.accessToken,
      url: fixture.origin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto(`${fixture.origin}/assets/`);
  const videoCard = page
    .locator("article")
    .filter({ has: page.getByText("真实视频作品", { exact: true }) });
  await videoCard
    .getByRole("button", { name: "公开作品", exact: true })
    .click();
  const publishDialog = page.getByRole("dialog");
  await expect(
    publishDialog.getByRole("checkbox", { name: "同时公开我选择的字幕" }),
  ).not.toBeChecked();
  await publishDialog
    .getByRole("checkbox", { name: "同时公开我选择的字幕" })
    .check();
  await publishDialog.getByLabel("字幕文件（WebVTT）").setInputFiles({
    name: "public-captions.vtt",
    mimeType: "text/vtt",
    buffer: Buffer.from(caption.vtt),
  });
  await publishDialog.getByLabel("字幕语言").selectOption("en");
  await publishDialog.getByLabel("播放器字幕名称").fill(caption.label);
  await expect(
    publishDialog.getByRole("region", { name: "将公开的字幕预览" }),
  ).toContainText("First caption");
  await page.screenshot({
    path: info.outputPath("gallery-caption-consent.png"),
  });
  const publicationResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/gallery/") &&
      response.url().endsWith("/publish") &&
      response.request().method() === "POST",
  );
  await publishDialog
    .getByRole("button", { name: "确认公开作品和字幕" })
    .click();
  const publishedVideo = await publicationResponse;
  expect(publishedVideo.status()).toBe(200);
  const videoGallery = String((await publishedVideo.json()).data.id);
  await expect(publishDialog).toHaveCount(0);
  const media = [
    {
      id: imageGallery,
      objectId: fixture.imageId,
      file: fixture.imageFile,
      mime: "image/png",
    },
    {
      id: videoGallery,
      objectId: fixture.videoId,
      file: fixture.videoFile,
      mime: "video/mp4",
    },
  ];
  const feed = await (
    await context.request.get(`${fixture.api}/api/gallery`)
  ).json();
  expect(
    feed.data.map((item: { object_url: string }) => item.object_url).sort(),
  ).toEqual(media.map((item) => `/api/gallery/${item.id}/media`).sort());

  const anonymous = await browser.newContext();
  const visitor = await anonymous.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  visitor.on("pageerror", (error) => errors.push(error.message));
  try {
    const navigation = await visitor.goto(
      `${fixture.origin}/__fixture__/media`,
    );
    await info.attach("anonymous-document", {
      body: JSON.stringify({
        url: visitor.url(),
        status: navigation?.status(),
        body: await visitor.locator("body").innerText(),
      }),
      contentType: "application/json",
    });
    expect(navigation?.status()).toBe(200);
    await expect(
      visitor.getByRole("heading", { name: "Published gallery media" }),
    ).toBeVisible();
    const preliminaryImage = await anonymous.request.get(
      `${fixture.api}/api/gallery/${imageGallery}/media`,
    );
    await info.attach("anonymous-image-response", {
      body: JSON.stringify({
        status: preliminaryImage.status(),
        headers: preliminaryImage.headers(),
        bytes: (await preliminaryImage.body()).length,
      }),
      contentType: "application/json",
    });
    expect(preliminaryImage.status()).toBe(200);
    const decoded = await visitor.evaluate(
      async ({ imagePath, videoPath }) => {
        const image = new Image();
        image.src = imagePath;
        image.alt = "Published image";
        document.body.append(image);
        await image.decode();
        const video = document.createElement("video");
        video.src = videoPath;
        video.muted = true;
        video.controls = true;
        video.playsInline = true;
        document.body.append(video);
        await new Promise<void>((done, fail) => {
          video.addEventListener("loadeddata", () => done(), { once: true });
          video.addEventListener(
            "error",
            () => fail(new Error("Published video decode failed")),
            { once: true },
          );
          video.load();
        });
        await video.play();
        await new Promise<void>((done, fail) => {
          const timeout = setTimeout(
            () => fail(new Error("Video did not advance")),
            5000,
          );
          const observe = () => {
            if (video.currentTime > 0.2) {
              clearTimeout(timeout);
              video.removeEventListener("timeupdate", observe);
              done();
            }
          };
          video.addEventListener("timeupdate", observe);
        });
        video.pause();
        return {
          imageWidth: image.naturalWidth,
          imageHeight: image.naturalHeight,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          duration: video.duration,
          currentTime: video.currentTime,
        };
      },
      {
        imagePath: `/api/gallery/${imageGallery}/media`,
        videoPath: `/api/gallery/${videoGallery}/media`,
      },
    );
    expect(decoded).toMatchObject({
      imageWidth: 320,
      imageHeight: 180,
      videoWidth: 160,
      videoHeight: 120,
    });
    expect(decoded.duration).toBeGreaterThan(1.9);
    expect(decoded.currentTime).toBeGreaterThan(0.2);
    const subtitleResponse = await anonymous.request.get(
      `${fixture.api}/api/gallery/${videoGallery}/captions.vtt`,
    );
    expect(subtitleResponse.status()).toBe(200);
    expect(subtitleResponse.headers()["content-type"]).toContain("text/vtt");
    expect(subtitleResponse.headers()["cache-control"]).toContain("no-store");
    await visitor.screenshot({
      path: info.outputPath("gallery-anonymous-decoded.png"),
    });

    const etags = new Map<string, string>();
    const identities: { id: string; bytes: number; sha256: string }[] = [];
    for (const item of media) {
      const url = `${fixture.api}/api/gallery/${item.id}/media`;
      const original = await readFile(item.file);
      const full = await anonymous.request.get(url);
      expect(full.status()).toBe(200);
      expect(full.headers()["content-type"]).toBe(item.mime);
      expect(full.headers()["cache-control"]).toContain("no-store");
      expect(await full.body()).toEqual(original);
      etags.set(item.id, full.headers().etag);
      identities.push({
        id: item.id,
        bytes: original.length,
        sha256: createHash("sha256").update(original).digest("hex"),
      });
      const range = await anonymous.request.get(url, {
        headers: { range: "bytes=0-15", "if-range": full.headers().etag },
      });
      expect(range.status()).toBe(206);
      expect(await range.body()).toEqual(original.subarray(0, 16));
      const head = await anonymous.request.head(url);
      expect(head.status()).toBe(200);
      expect(Number(head.headers()["content-length"])).toBe(original.length);
      expect((await head.body()).length).toBe(0);
      expect(
        (
          await anonymous.request.get(
            `${fixture.api}/api/uploads/${item.objectId}/file`,
          )
        ).status(),
      ).toBe(401);
      expect(
        (
          await anonymous.request.get(
            `${fixture.api}/api/uploads/${item.objectId}/file`,
            { headers: peerHeaders },
          )
        ).status(),
      ).toBe(404);
    }

    await context.addCookies([
      {
        name: "gallery_test_session",
        value: fixture.peer.accessToken,
        url: fixture.origin,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    fixture.failListOnce();
    await page.goto(`${fixture.origin}/gallery/`);
    await expect(
      page.getByRole("alert").filter({ hasText: "作品服务暂不可用" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "重新加载作品" }).click();
    await expect(
      page.getByRole("heading", { name: "真实图片作品" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "真实视频作品" }),
    ).toBeVisible();
    const player = page.getByLabel("真实视频作品", { exact: true });
    await expect
      .poll(() =>
        player.evaluate(
          (node) => (node as HTMLVideoElement).textTracks[0]?.cues?.length ?? 0,
        ),
      )
      .toBe(2);
    const cues = await player.evaluate(async (node) => {
      const video = node as HTMLVideoElement;
      video.pause();
      const track = video.textTracks[0];
      if (!track) throw new Error("Caption track was not loaded");
      track.mode = "showing";
      video.currentTime = 1.25;
      await new Promise<void>((done) =>
        video.addEventListener("seeked", () => done(), { once: true }),
      );
      return {
        language: track.language,
        label: track.label,
        cues: [...(track.cues ?? [])].map((cue) => ({
          start: cue.startTime,
          end: cue.endTime,
          text: (cue as VTTCue).text,
        })),
        active: [...(track.activeCues ?? [])].map(
          (cue) => (cue as VTTCue).text,
        ),
      };
    });
    expect(cues).toMatchObject({
      language: "en",
      label: "English captions",
      cues: [
        { start: 0, end: 1, text: "First caption" },
        { start: 1, end: 2, text: "Second caption" },
      ],
      active: ["Second caption"],
    });
    const displayed = page.getByAltText("真实图片作品");
    await expect
      .poll(() =>
        displayed.evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBe(320);
    await page.getByRole("button", { name: "点赞 真实图片作品" }).click();
    await expect(
      page.getByRole("button", { name: "点赞 真实图片作品" }),
    ).toContainText("1");
    await page.setViewportSize({ width: 320, height: 780 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("gallery-built-mobile.png"),
      fullPage: true,
    });

    for (const item of media) {
      expect(
        (
          await context.request.delete(
            `${fixture.api}/api/gallery/${item.objectId}/publish`,
            { headers: peerHeaders },
          )
        ).status(),
      ).toBe(404);
      expect(
        (
          await context.request.delete(
            `${fixture.api}/api/gallery/${item.objectId}/publish`,
            { headers: ownerHeaders },
          )
        ).status(),
      ).toBe(200);
      const url = `${fixture.api}/api/gallery/${item.id}/media`;
      for (const method of ["GET", "HEAD"]) {
        const response = await anonymous.request.fetch(url, {
          method,
          headers: {
            range: "bytes=0-15",
            "if-range": etags.get(item.id) ?? "",
            "if-none-match": etags.get(item.id) ?? "",
          },
        });
        expect(response.status()).toBe(404);
        expect(response.headers()["cache-control"]).toContain("no-store");
      }
      const browserStatus = await visitor.evaluate(
        async (path) => (await fetch(path, { cache: "no-store" })).status,
        `/api/gallery/${item.id}/media`,
      );
      expect(browserStatus).toBe(404);
      if (item.id === videoGallery) {
        const captionAfterWithdrawal = await anonymous.request.get(
          `${fixture.api}/api/gallery/${videoGallery}/captions.vtt`,
          { headers: { "if-none-match": "anything" } },
        );
        expect(captionAfterWithdrawal.status()).toBe(404);
        expect(captionAfterWithdrawal.headers()["cache-control"]).toContain(
          "no-store",
        );
      }
      expect(
        (
          await context.request.get(
            `${fixture.api}/api/uploads/${item.objectId}/file`,
            { headers: ownerHeaders },
          )
        ).status(),
      ).toBe(200);
    }
    expect(
      (await (await context.request.get(`${fixture.api}/api/gallery`)).json())
        .data,
    ).toEqual([]);
    expect(errors).toEqual([]);
    await info.attach("gallery-media-evidence", {
      body: JSON.stringify(
        {
          decoded,
          identities,
          publishedThroughApi: true,
          withdrawnThroughApi: true,
          businessSqlMocked: false,
          externalPublication: false,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  } finally {
    await anonymous.close();
  }
});
