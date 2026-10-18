import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  parseGooglePrices,
  parseMiniMaxPrices,
  parseReplicatePrices,
  getOfficialPriceSnapshots,
  isPublicOfficialPrice,
  syncOfficialModelPrices,
} from "./official-model-prices.js";
import { compareHelsteraWithOfficialMax } from "@helstera/shared";

const checkedAt = "2026-10-13T00:00:00.000Z";

describe("official model price parsers", () => {
  it("reads image sizes and video seconds from Google's pricing page", () => {
    const html = `<main>
      <h2>Gemini 3.1 Flash Image</h2>
      <p>$60.00 (images) Equivalent to $0.045 per 0.5K image, $0.067 per 1K image, $0.101 per 2K image, and $0.151 per 4K image.</p>
      <h2>Gemini 3 Pro Image</h2>
      <p>$120.00 (images) Equivalent to $0.134 per 1K/2K image and $0.24 per 4K image.</p>
      <h2>Veo 3.1</h2>
      <p>Veo 3.1 Standard video with audio price (default) $0.40 (720p and 1080p) $0.60 (4k)</p>
      <h2>Lyria</h2>
    </main>`;

    const prices = parseGooglePrices(html, checkedAt);
    expect(prices.map(({ priceKey, officialMin }) => [priceKey, officialMin])).toEqual([
      ["google-flash-image-1k", 0.067],
      ["google-flash-image-2k", 0.101],
      ["google-flash-image-4k", 0.151],
      ["google-pro-image-1k", 0.134],
      ["google-pro-image-4k", 0.24],
      ["google-veo-31-720p", 0.4],
      ["google-veo-31-4k", 0.6],
    ]);
  });

  it("selects only MiniMax H3 generation tiers, not H3 Max or regeneration", () => {
    const html = `<table>
      <tr><th>Model</th><th>Resolution</th><th>Billing</th><th>Price</th></tr>
      <tr><td>MiniMax-H3</td><td>768P</td><td>Billed per second</td><td>$0.08 / second</td></tr>
      <tr><td>MiniMax-H3</td><td>2K</td><td>Billed per second</td><td>$0.13 / second</td></tr>
      <tr><td>MiniMax-H3-Max</td><td>768P</td><td>Billed per second</td><td>$0.14 / second</td></tr>
      <tr><td>MiniMax-H3-Regeneration</td><td>768P → 2K</td><td>Billed per second</td><td>$0.05 / second</td></tr>
    </table>`;

    expect(parseMiniMaxPrices(html, checkedAt).map((price) => price.officialMin)).toEqual([0.08, 0.13]);
  });

  it("reads Replicate's structured standard and pro billing tiers", () => {
    const html = `<script type="application/json" id="model-price">${JSON.stringify({
      modelName: "kwaivgi/kling-v2.6",
      billingConfig: { current_tiers: [
        { prices: [{ price: "$0.07" }] },
        { prices: [{ price: "$0.14" }] },
      ] },
    })}</script>`;

    const [price] = parseReplicatePrices(html, checkedAt);
    expect(price).toMatchObject({ officialMin: 0.07, officialMax: 0.14, lastVerifiedAt: checkedAt });
  });
});

describe("official price comparison", () => {
  it("compares against the official maximum using matching billing units", () => {
    const image = {
      priceKey: "image", providerKey: "p", providerLabel: "P", modelId: "m", modelName: "M",
      mediaType: "image" as const, variant: "1K", officialMin: 1, officialMax: 1, currency: "USD" as const,
      unit: "per_image" as const, unitLabel: "image", helsteraCredits: 7, helsteraUnitLabel: "image",
      note: null, sourceId: "s", sourceLabel: "S", sourceUrl: "https://example.com", snapshotDate: "2026-10-13", lastVerifiedAt: null,
    };
    const video = { ...image, mediaType: "video" as const, unit: "per_second" as const, officialMin: 0.2, officialMax: 0.2, helsteraCredits: 7 };

    expect(compareHelsteraWithOfficialMax(image, 7.2)).toMatchObject({ officialMaxCny: 7.2, relation: "below" });
    expect(compareHelsteraWithOfficialMax({ ...image, helsteraCredits: 8 }, 7.2).relation).toBe("above");
    const videoComparison = compareHelsteraWithOfficialMax(video, 7.2);
    expect(videoComparison.officialMaxCny).toBeCloseTo(1.44);
    expect(videoComparison.deltaCny).toBeCloseTo(-0.04);
    expect(videoComparison.relation).toBe("below");
    expect(compareHelsteraWithOfficialMax({ ...video, helsteraCredits: 8 }, 7.2).relation).toBe("above");
    expect(() => compareHelsteraWithOfficialMax({ ...image, unit: "per_million_tokens" }, 7.2)).toThrow(/Token prices cannot be compared/);
    expect(getOfficialPriceSnapshots().filter(isPublicOfficialPrice)).toHaveLength(59);
    expect(getOfficialPriceSnapshots().filter(isPublicOfficialPrice).some((price) => /nano/i.test(price.modelName))).toBe(false);
    expect(getOfficialPriceSnapshots().filter(isPublicOfficialPrice).some((price) => /gpt image 1$/i.test(price.modelName))).toBe(false);
    expect(getOfficialPriceSnapshots()).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelId: "happyhorse-1.1-i2v", officialMax: 0.18 }),
      expect.objectContaining({ modelId: "wan2.7-t2v", officialMax: 1 / 7.2 }),
      expect.objectContaining({ modelId: "pixverse-v6-shouweizhen", officialMax: 46 / 225 }),
      expect.objectContaining({ modelId: "gpt-image-2", unit: "per_million_tokens", officialMax: 30 }),
      expect.objectContaining({ modelId: "dreamina-seedance-2-5-260628", unit: "per_million_tokens", officialMax: 11.7 }),
    ]));
  });
});

describe("syncOfficialModelPrices", () => {
  it("preserves seeded prices when all remote sources fail", async () => {
    const db = { query: vi.fn(async () => ({ rows: [] })) } as unknown as Pool;
    const fetcher = vi.fn(async () => { throw new Error("source unavailable"); }) as unknown as typeof fetch;

    await expect(syncOfficialModelPrices(db, fetcher, () => new Date(checkedAt))).resolves.toEqual({
      succeeded: 0,
      failed: 3,
      updatedPrices: 0,
    });
    expect(db.query).not.toHaveBeenCalledWith(
      expect.stringContaining("update official_model_prices"),
      expect.anything(),
    );
  });

  it("follows same-host official redirects and stores each source independently", async () => {
    const db = { query: vi.fn(async () => ({ rows: [] })) } as unknown as Pool;
    const minimaxHtml = `<table>
      <tr><td>MiniMax-H3</td><td>768P</td><td>Billed per second</td><td>$0.08 / second</td></tr>
      <tr><td>MiniMax-H3</td><td>2K</td><td>Billed per second</td><td>$0.13 / second</td></tr>
    </table>`;
    const replicateHtml = `<script type="application/json">${JSON.stringify({
      modelName: "kwaivgi/kling-v2.6",
      billingConfig: { current_tiers: [
        { prices: [{ price: "$0.07" }] },
        { prices: [{ price: "$0.14" }] },
      ] },
    })}</script>`;
    const requestedUrls: string[] = [];
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url === "https://platform.minimax.io/subscribe/token-plan?tab=api-enterprise") {
        return new Response(null, { status: 307, headers: { location: "/docs/pricing/overview" } });
      }
      if (url === "https://platform.minimax.io/docs/pricing/overview") {
        return new Response(minimaxHtml, { status: 200 });
      }
      if (url === "https://replicate.com/kwaivgi/kling-v2.6") {
        return new Response(replicateHtml, { status: 200 });
      }
      return new Response("unavailable", { status: 503 });
    }) as unknown as typeof fetch;

    await expect(syncOfficialModelPrices(db, fetcher, () => new Date(checkedAt))).resolves.toEqual({
      succeeded: 2,
      failed: 1,
      updatedPrices: 3,
    });
    expect(requestedUrls).toContain(
      "https://platform.minimax.io/docs/pricing/overview",
    );
  });
});
