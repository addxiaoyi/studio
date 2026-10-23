import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DesktopDownloadList } from "@/components/desktop-download-list";

describe("DesktopDownloadList", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("offers the published Windows portable ZIP and version", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      const platform = String(url).match(/desktop-release-(.+)\.json/)?.[1] ?? "";
      const isWindows = platform === "windows-x64";
      return new Response(JSON.stringify({
        platform,
        version: "0.2.2",
        fileName: "Helstera-Setup-0.2.2-Windows-x64.exe",
        sha256: "a".repeat(64),
        ...(isWindows ? { portableFileName: "Helstera-0.2.2-win-x64.zip", portableSha256: "b".repeat(64) } : {}),
        publishedAt: "2026-10-21T00:00:00.000Z",
      }), { status: 200 });
    }));

    render(<DesktopDownloadList />);

    const portableLink = await screen.findByRole("link", { name: /Windows 便携包.*免安装/ });
    expect(portableLink.getAttribute("href")).toBe("/downloads/Helstera-0.2.2-win-x64.zip");
    expect(portableLink.textContent).toContain("v0.2.2");
    expect(portableLink.textContent).toContain("免安装");
  });

  it("does not invent a version when a platform has no published manifest", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      const platform = String(url).match(/desktop-release-(.+)\.json/)?.[1] ?? "";
      if (platform === "windows-x64") {
        return new Response(JSON.stringify({
          platform,
          version: "0.2.2",
          fileName: "Helstera-Setup-0.2.2-Windows-x64.exe",
          sha256: "a".repeat(64),
          portableFileName: "Helstera-0.2.2-win-x64.zip",
          portableSha256: "b".repeat(64),
          publishedAt: "2026-10-21T00:00:00.000Z",
        }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }));

    render(<DesktopDownloadList />);

    expect(await screen.findByText("x64 · v0.2.2")).toBeTruthy();
    expect(screen.getAllByText("尚未发布")).toHaveLength(3);
    expect(screen.getByText("版本与下载文件来自 Helstera 发布清单")).toBeTruthy();
  });
});
