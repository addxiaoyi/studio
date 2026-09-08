// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;
const mockToken = "session-token";

vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    session: {
      access_token: mockToken,
      user: { id: "user-1", email: "test@helstera.com" },
    },
    loading: false,
    signOut: vi.fn(),
  }),
}));

vi.mock("../src/hooks/use-credits", () => ({
  useCredits: () => ({
    balance: 10_000,
    totalToppedUp: 0,
    totalSpent: 0,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

import EcomImagesPage, { SCENES, RATIOS, CATEGORIES } from "../src/app/(workspace)/ecom-images/page";

// ---------------------------------------------------------------------------
// Constants tests
// ---------------------------------------------------------------------------

describe("SCENES constant", () => {
  it("has exactly 25 entries", () => {
    expect(SCENES).toHaveLength(25);
  });

  it("all entries have unique ids", () => {
    const ids = SCENES.map((s) => s.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(25);
  });

  it("ids match the pattern ^\\d{2}-[a-z-]+$", () => {
    const pattern = /^\d{2}-[a-z-]+$/;
    for (const scene of SCENES) {
      expect(scene.id).toMatch(pattern);
    }
  });

  it("is categorized into 3 groups: 产品 / 营销 / 信息", () => {
    const cats = [...new Set(SCENES.map((s) => s.category))];
    expect(cats).toHaveLength(3);
    expect(cats).toContain("产品");
    expect(cats).toContain("营销");
    expect(cats).toContain("信息");
  });

  it("each scene has name, nameZh, category fields", () => {
    for (const scene of SCENES) {
      expect(scene).toHaveProperty("id");
      expect(scene).toHaveProperty("name");
      expect(scene).toHaveProperty("nameZh");
      expect(scene).toHaveProperty("category");
      expect(typeof scene.name).toBe("string");
      expect(typeof scene.nameZh).toBe("string");
      expect(typeof scene.category).toBe("string");
    }
  });
});

describe("RATIOS constant", () => {
  it("has exactly 8 expected ratios", () => {
    expect(RATIOS).toHaveLength(8);
  });

  it("contains all expected ratio strings", () => {
    const expected = ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "16:9", "9:16"];
    expect([...RATIOS]).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Component tests
// ---------------------------------------------------------------------------

function setup() {
  const user = userEvent.setup();
  render(<EcomImagesPage />);
  return { user };
}

describe("EcomImagesPage renders", () => {
  afterEach(cleanup);

  it("renders without throwing", () => {
    expect(() => render(<EcomImagesPage />)).not.toThrow();
  });

  it("page header shows 电商详情图生成 text", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("电商详情图生成");
  });

  it("renders 25 scene cards (buttons)", () => {
    setup();
    // Every scene button is a <button> with class containing "rounded-xl" inside the scene selector
    const sceneButtons = screen.getAllByRole("button").filter((btn) =>
      btn.className.includes("rounded-xl"),
    );
    expect(sceneButtons).toHaveLength(25);
  });

  it("renders all 8 ratio buttons", () => {
    setup();
    const ratioButtons = screen.getAllByRole("button", { name: /^\d+:\d+$/ });
    expect(ratioButtons).toHaveLength(8);
  });
});

describe("EcomImagesPage interactions", () => {
  afterEach(cleanup);

  it("selecting a scene adds it to selectedScenes", async () => {
    const { user } = setup();

    // The first "产品" scene button — click it
    const productButtons = screen.getAllByRole("button").filter(
      (btn) => btn.className.includes("rounded-xl"),
    );
    await user.click(productButtons[0]!);

    // Selected count badge should appear
    expect(screen.getByText(/已选 1/)).toBeInTheDocument();
  });

  it("clicking a selected scene removes it", async () => {
    const { user } = setup();

    const productButtons = screen.getAllByRole("button").filter(
      (btn) => btn.className.includes("rounded-xl"),
    );

    // Select it
    await user.click(productButtons[0]!);
    expect(screen.getByText(/已选 1/)).toBeInTheDocument();

    // Deselect it
    await user.click(productButtons[0]!);
    // The "已选" badge should disappear
    expect(screen.queryByText(/已选/)).not.toBeInTheDocument();
  });

  it("product name input updates state", async () => {
    const { user } = setup();
    const input = screen.getByRole("textbox", { name: /商品名称/ });
    await user.type(input, "空气净化器");
    expect(input).toHaveValue("空气净化器");
  });

  it("product description textarea updates state", async () => {
    const { user } = setup();
    const textarea = screen.getByRole("textbox", { name: /商品描述/ });
    await user.type(textarea, "HEPA 滤网，PM2.5 过滤 99.97%");
    expect(textarea).toHaveValue("HEPA 滤网，PM2.5 过滤 99.97%");
  });

  it("ratio buttons update state on click", async () => {
    const { user } = setup();
    // Default ratio is 1:1 (first button)
    const ratio3_2 = screen.getByRole("button", { name: "3:2" });
    await user.click(ratio3_2);
    expect(ratio3_2).toHaveClass("bg-foreground");
  });

  it("generate button is disabled when no product name", () => {
    setup();
    const generateBtn = screen.getByRole("button", { name: /生成 \d+ 张图片/ });
    expect(generateBtn).toBeDisabled();
  });

  it("generate button is disabled when no scenes selected", async () => {
    const { user } = setup();
    // Enter a product name but no scenes
    const input = screen.getByRole("textbox", { name: /商品名称/ });
    await user.type(input, "空气净化器");
    const generateBtn = screen.getByRole("button", { name: /生成 \d+ 张图片/ });
    expect(generateBtn).toBeDisabled();
  });

  it("generate button is enabled when product name + scenes selected", async () => {
    const { user } = setup();
    const input = screen.getByRole("textbox", { name: /商品名称/ });
    await user.type(input, "空气净化器");

    const sceneButtons = screen.getAllByRole("button").filter(
      (btn) => btn.className.includes("rounded-xl"),
    );
    await user.click(sceneButtons[0]!);

    const generateBtn = screen.getByRole("button", { name: /生成 \d+ 张图片/ });
    expect(generateBtn).toBeEnabled();
  });

  it("searching with filter input narrows down visible scenes", async () => {
    const { user } = setup();

    // All product scenes visible initially under "产品"
    const productCategory = screen.getByText("产品");
    expect(productCategory).toBeInTheDocument();

    // Type a filter that only matches "hero"
    const searchInput = screen.getByPlaceholderText("搜索场景...");
    await user.type(searchInput, "hero");

    // Scene buttons should still be present but fewer
    const visibleButtons = screen.getAllByRole("button").filter(
      (btn) => btn.className.includes("rounded-xl"),
    );
    // Only "Hero Image" matches "hero"
    expect(visibleButtons).toHaveLength(1);
  });

  it("reference image upload area renders correctly", () => {
    setup();
    // The upload label/text should be present
    expect(screen.getByText("拖拽或点击上传")).toBeInTheDocument();
    // There should be a hidden file input
    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).toBeInTheDocument();
  });
});
