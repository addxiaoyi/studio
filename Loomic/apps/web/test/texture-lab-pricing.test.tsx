// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchImageModels } = vi.hoisted(() => ({ fetchImageModels: vi.fn() }));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ session: { access_token: "test-token" } }),
}));

vi.mock("@/lib/server-api", () => ({
  fetchImageModels,
  generateImageDirect: vi.fn(),
}));

import { TextureLab } from "@/components/texture-lab";

describe("TextureLab pricing", () => {
  beforeEach(() => {
    fetchImageModels.mockResolvedValue({
      defaultModel: "gpt-image-2",
      unavailableModels: [],
      models: [{
        id: "gpt-image-2",
        displayName: "GPT Image 2",
        description: "test",
        provider: "configured",
        accessible: true,
        billingUnit: "per_generation",
        providerPriceCny: 0.08,
      }],
    });
  });

  it("shows the actual per-image price before generation", async () => {
    render(<TextureLab />);
    expect(await screen.findByText("¥0.08 / 张")).toBeTruthy();
    expect(screen.getByText(/使用 GPT Image 2/)).toBeTruthy();
  }, 20_000);
});
