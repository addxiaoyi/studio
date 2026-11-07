// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LegacyFashionGallery as FashionGalleryPage } from "@/components/legacy-fashion-gallery";

vi.mock("@/components/fashion-try-on", () => ({ FashionTryOn: () => <><input aria-label="photo" /><button type="button">try on</button></> }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("fashion gallery", () => {
  it("keeps keyboard focus in the preview and restores it on close", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [
      { id: "TEST-1", category: "test", keywords: "dress", thumb: "a.webp", image: "b.webp" },
    ] }));
    render(<FashionGalleryPage />);
    const trigger = await screen.findByRole("button", { name: /TEST-1/ });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    const close = dialog.querySelector("button");
    expect(close).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    const last = screen.getByRole("button", { name: "try on" });
    expect(last).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(trigger).toHaveFocus();
  });
  it("filters the catalog and opens and closes the original image", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [
      { id: "SPR-1", category: "春", keywords: "blue dress", thumb: "thumbs/a.webp", image: "img/a.webp" },
      { id: "WIN-1", category: "冬", keywords: "coat", thumb: "thumbs/b.webp", image: "img/b.webp" },
    ] }));
    render(<FashionGalleryPage />);
    expect(await screen.findByText("SPR-1 · 春季")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "冬季" }));
    expect(screen.queryByText("SPR-1 · 春季")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /冬季穿搭 WIN-1/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("搜索穿搭"), { target: { value: "missing" } });
    expect(screen.getByText("没有找到符合条件的穿搭。")).toBeInTheDocument();
  });
});
