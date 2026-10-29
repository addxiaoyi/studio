// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoModelInfo } from "../src/lib/server-api";

const api = vi.hoisted(() => ({
  fetchImageModels: vi.fn(),
  fetchVideoModels: vi.fn(),
}));

vi.mock("../src/lib/server-api", () => ({
  fetchImageModels: api.fetchImageModels,
  fetchVideoModels: api.fetchVideoModels,
}));

import { ImageModelPreferencePopover } from "../src/components/image-model-preference";

function PreferencePicker() {
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={anchorRef} type="button">Open picker</button>
      <ImageModelPreferencePopover open onClose={vi.fn()} anchorRef={anchorRef} />
    </>
  );
}

const rates = [
  { resolution: "480p" as const, priceCnyPerSecond: 0.22 },
  { resolution: "768p" as const, priceCnyPerSecond: 0.3 },
  { resolution: "1088p" as const, priceCnyPerSecond: 0.34 },
  { resolution: "1440p" as const, priceCnyPerSecond: 0.38 },
];

const minimax = (id: string): VideoModelInfo => ({
  id,
  displayName: "MiniMax H3",
  description: "旗舰视频模型",
  provider: "configured",
  availability: "unverified",
  healthStatus: "unknown",
  billingUnit: "per_second",
  providerPriceCny: 0.432,
  creditCost: 0.432,
  limits: { maxDuration: 10, allowedDurations: [4, 5, 10], maxResolution: "1080p", maxInputImages: 1 },
});

describe("video model preference picker", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    api.fetchImageModels.mockReset().mockResolvedValue({ models: [], unavailableModels: [] });
    api.fetchVideoModels.mockReset().mockResolvedValue({
      models: [minimax("MiniMax-H3"), minimax("minimax-h3"), { ...minimax("hailuo-h3"), displayName: "Hailuo H3" }],
      unavailableModels: [],
    });
  });

  afterEach(cleanup);

  it("features one MiniMax H3 entry and switches the expanded price preview by resolution", async () => {
    render(<PreferencePicker />);
    await userEvent.click(screen.getByRole("button", { name: "视频" }));
    await userEvent.click(screen.getByRole("button", { name: "手动选择" }));

    expect(await screen.findByText("旗舰首推")).toBeInTheDocument();
    expect(screen.getAllByText("旗舰首推")).toHaveLength(1);
    expect(screen.getByText(/768p.*¥0\.30/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "展开 MiniMax H3 分辨率价格" }));
    const priceList = screen.getByLabelText("MiniMax H3 分辨率价格");
    expect(within(priceList).getAllByRole("radio")).toHaveLength(rates.length);

    await userEvent.click(within(priceList).getByRole("radio", { name: /1440p/ }));
    expect(screen.getByText(/1440p.*¥0\.38/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("helstera:video-model-preference") ?? "{}")).toMatchObject({
      mode: "manual", models: ["minimax-h3"], resolution: "1440p", duration: 5,
    });
  });
});
