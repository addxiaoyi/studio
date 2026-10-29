// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DesktopDownloadList } from "@/components/desktop-download-list";
import { DesktopToastProvider } from "@/components/desktop-toast";

type Manifest = {
  version: string;
  sha256: string;
  publishedAt: string;
  fileName?: string;
  portableFileName?: string;
  portableSha256?: string;
};

const BASE_MANIFEST: Manifest = {
  version: "0.2.2",
  sha256: "a".repeat(64),
  publishedAt: "2026-10-21T00:00:00.000Z",
};

function manifestFor(platform: string): Response {
  return new Response(JSON.stringify({
    platform,
    version: BASE_MANIFEST.version,
    fileName: `Helstera-Setup-0.2.2-${platform}.exe`,
    sha256: BASE_MANIFEST.sha256,
    ...(platform === "windows-x64"
      ? { portableFileName: "Helstera-0.2.2-win-x64.zip", portableSha256: "b".repeat(64) }
      : {}),
    publishedAt: BASE_MANIFEST.publishedAt,
  }), { status: 200 });
}

function stubFetch(handler: (platform: string) => Response) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const platform = String(url).match(/desktop-release-(.+)\.json/)?.[1] ?? "";
    return handler(platform);
  }));
}

function renderList() {
  return render(
    <DesktopToastProvider>
      <DesktopDownloadList />
    </DesktopToastProvider>,
  );
}

function toastByClassName(tone: "success" | "error" | "info") {
  return document.querySelector(`.desktop-toast--${tone}`);
}

describe("DesktopDownloadList feedback", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the shared empty state when no platform has a published package", async () => {
    stubFetch(() => new Response(null, { status: 404 }));
    renderList();

    expect(await screen.findByText("暂无下载记录")).toBeTruthy();
    expect(screen.getByText(/发布清单里还没有可下载的安装包/)).toBeTruthy();
    // The empty state carries the way forward instead of leaving a dead grid.
    expect(screen.getByRole("button", { name: "重新读取版本" })).toBeTruthy();
    // Proof the empty state replaced the grid rather than sitting next to it.
    expect(screen.queryByText("尚未发布")).toBeNull();
    expect(toastByClassName("error")).toBeNull();
  });

  it("keeps the platform grid, not the empty state, when a package is published", async () => {
    stubFetch((platform) => (platform === "windows-x64" ? manifestFor(platform) : new Response(null, { status: 404 })));
    renderList();

    expect(await screen.findByRole("link", { name: /Windows 便携包.*免安装/ })).toBeTruthy();
    expect(screen.queryByText("暂无下载记录")).toBeNull();
    expect(screen.getAllByText("尚未发布")).toHaveLength(3);
  });

  it("toasts the manifest failure reason instead of dropping it", async () => {
    stubFetch(() => { throw new Error("网络连接被重置"); });
    renderList();

    const toastMessage = await screen.findByText(/下载清单读取失败/);
    expect(toastMessage.textContent).toBe("下载清单读取失败：网络连接被重置");
    expect(toastByClassName("error")).not.toBeNull();
    // The inline alert kept its reason too: a silent "稍后重试" was the old behaviour.
    expect(screen.getByRole("alert").textContent).toContain("网络连接被重置");
    expect(screen.queryByText("暂无下载记录")).toBeNull();
  });

  it("reports a partial manifest failure without hiding the platforms that do work", async () => {
    stubFetch((platform) => {
      if (platform === "windows-x64") return manifestFor(platform);
      throw new Error("版本信息暂时无法获取");
    });
    renderList();

    const toastMessage = await screen.findByText(/部分平台版本信息读取失败/);
    expect(toastMessage.textContent).toBe("部分平台版本信息读取失败（3/4）：版本信息暂时无法获取");
    expect(await screen.findByRole("link", { name: /Windows 便携包.*免安装/ })).toBeTruthy();
  });

  it("confirms with a success toast once a retried read actually completes", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    stubFetch((platform) => {
      attempts += 1;
      if (attempts <= 4) throw new Error("网络连接被重置");
      return manifestFor(platform);
    });
    renderList();

    await screen.findByText(/下载清单读取失败/);
    await user.click(screen.getByRole("button", { name: "重新读取版本" }));

    const toastMessage = await screen.findByText(/下载清单已更新/);
    expect(toastMessage.textContent).toBe("下载清单已更新：4 个平台可下载");
    expect(toastByClassName("success")).not.toBeNull();
  });

  it("announces a started download when the user picks a package", async () => {
    const user = userEvent.setup();
    stubFetch((platform) => manifestFor(platform));
    renderList();

    const link = await screen.findByRole("link", { name: /Windows 便携包.*免安装/ });
    // jsdom cannot follow a file download; keep the click, drop the navigation.
    link.addEventListener("click", (event) => event.preventDefault());
    await user.click(link);

    const toastMessage = await screen.findByText("开始下载 Windows 便携包（免安装版）");
    expect(toastMessage.textContent).toBe("开始下载 Windows 便携包（免安装版）");
    expect(toastByClassName("info")).not.toBeNull();
  });
});
