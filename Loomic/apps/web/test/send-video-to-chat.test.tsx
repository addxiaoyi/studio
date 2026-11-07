import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SendVideoToChat } from "../src/components/send-video-to-chat";
import { selectOption } from "./select-option";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("preserves cookie authentication while listing and delivering to chat", async () => {
  document.documentElement.lang = "zh-CN";
  const request = vi.fn(async () => new Response(JSON.stringify({ sessions: [{ id: "session", title: "Review", canvasName: "Results", canvasId: "canvas" }] }), { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", request);
  render(<SendVideoToChat assetId="video" token="local-cookie" />);
  fireEvent.click(screen.getByRole("button", { name: "发送到聊天" }));
  const select = await screen.findByRole("combobox");
  await selectOption(select, /Review/);
  fireEvent.click(screen.getByRole("button", { name: /^发送$/ }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  for (const args of request.mock.calls as unknown as [string, RequestInit][]) expect(args[1].credentials).toBe("include");
});
