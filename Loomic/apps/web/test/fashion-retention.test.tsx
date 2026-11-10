import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FashionResultCard } from "@/components/fashion-result-card";
const api=vi.hoisted(()=>({fetchAssetRetention:vi.fn()}));
vi.mock("@/lib/server-api",()=>api);
vi.mock("@/components/send-video-to-chat",()=>({SendVideoToChat:()=> <button>发送试穿结果</button>}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const output={jobId:"job",assetId:"asset",model:"model",image:"aGVsbG8=",mimeType:"image/png"};
it("uses the server retention deadline and removes delivery actions after expiry",async()=>{
  api.fetchAssetRetention.mockResolvedValue({assetId:"asset",state:"active",retentionUntil:"2099-01-01T00:00:00Z"});
  render(<FashionResultCard output={output} token="owner" onSaved={vi.fn()}/>);
  expect(await screen.findByText(/私有素材保留至/)).toHaveTextContent("2099");
  expect(screen.getByRole("button",{name:"发送试穿结果"})).toBeVisible();
  api.fetchAssetRetention.mockResolvedValue({assetId:"asset",state:"active",retentionUntil:"2000-01-01T00:00:00Z"});
  fireEvent.click(screen.getByRole("button",{name:"刷新保留状态"}));
  expect(await screen.findByText(/云端素材已到期/)).toBeVisible();
  expect(screen.queryByRole("button",{name:"发送试穿结果"})).toBeNull();
});
it("shows unknown status on access failure instead of inventing a three-day lifetime",async()=>{
  api.fetchAssetRetention.mockRejectedValue(new Error("404"));
  render(<FashionResultCard output={output} token="owner" onSaved={vi.fn()}/>);
  expect(await screen.findByRole("alert")).toHaveTextContent("无法核验");
  expect(screen.queryByRole("button",{name:"发送试穿结果"})).toBeNull();
  expect(screen.queryByText(/保留三天/)).toBeNull();
});
