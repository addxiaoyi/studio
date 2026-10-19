// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";

import { EcomImagePreviewDialog } from "../src/components/ecom-image-preview-dialog";

function Harness() {
  const [open, setOpen] = useState(false);
  return <><button type="button" onClick={() => setOpen(true)}>打开原图</button>{open ? <EcomImagePreviewDialog src="/result.png" onClose={() => setOpen(false)} /> : null}</>;
}

describe("EcomImagePreviewDialog", () => {
  afterEach(cleanup);

  it("restores focus and closes with Escape", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "打开原图" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "查看生成原图" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭预览" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "查看生成原图" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
