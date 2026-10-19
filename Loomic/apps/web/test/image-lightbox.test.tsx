// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";

import { ImageLightbox } from "../src/components/chat/image-lightbox";

function Harness() {
  const [open, setOpen] = useState(false);
  return <><button type="button" onClick={() => setOpen(true)}>打开图片</button>{open ? <ImageLightbox src="/image.png" alt="商品图" onClose={() => setOpen(false)} /> : null}</>;
}

describe("ImageLightbox", () => {
  afterEach(cleanup);

  it("moves focus into the modal and restores it after closing", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "打开图片" });
    await user.click(trigger);

    expect(screen.getByRole("dialog", { name: "查看图片：商品图" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭图片查看器" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "缩小 (-)" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭图片查看器" }));
    expect(trigger).toHaveFocus();
  });
});
