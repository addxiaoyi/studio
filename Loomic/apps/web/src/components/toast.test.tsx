import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider, useToast } from "./toast";

function Trigger() {
  const { success, error } = useToast();
  return (
    <>
      <button type="button" onClick={() => success("完成")}>成功</button>
      <button type="button" onClick={() => error("失败")}>错误</button>
    </>
  );
}

describe("Toast accessibility", () => {
  it("uses status and alert live regions and exposes a close button", async () => {
    const user = userEvent.setup();
    render(<ToastProvider><Trigger /></ToastProvider>);
    await user.click(screen.getByRole("button", { name: "成功" }));
    expect(screen.getByRole("status").textContent).toContain("完成");
    await user.click(screen.getByRole("button", { name: "关闭通知" }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    await user.click(screen.getByRole("button", { name: "错误" }));
    expect(screen.getByRole("alert").textContent).toContain("失败");
  });
});
