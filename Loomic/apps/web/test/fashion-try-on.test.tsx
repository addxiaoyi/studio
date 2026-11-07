// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { FashionTryOn } from "@/components/fashion-try-on";

const mocks = vi.hoisted(() => ({ upload: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ session: { access_token: "test-token", user: { id: "test-user" } } }) }));
vi.mock("@/hooks/use-create-project", () => ({ useCreateProject: () => ({ create: mocks.create, creating: false }) }));
vi.mock("@/lib/server-api", () => ({ uploadFile: mocks.upload }));

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
  mocks.upload.mockReset();
  mocks.create.mockReset();
  mocks.create.mockResolvedValue(true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["outfit"], { type: "image/webp" }) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("fashion try-on", () => {
  it("requires a valid photo before uploading", async () => {
    render(<FashionTryOn outfit={{ id: "test", image: "img/test.webp" }} />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not upload or create a project if the retry key cannot be stored", async () => {
    vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => { throw new Error("storage blocked"); } });
    render(<FashionTryOn outfit={{ id: "test", image: "img/test.webp" }} />);
    fireEvent.change(screen.getByLabelText("选择人物照片"), { target: { files: [new File(["photo"], "photo.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent("无法保存试穿重试信息");
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("passes the uploaded photo and outfit to the existing canvas flow", async () => {
    mocks.upload.mockResolvedValueOnce({ asset: { id: "person" }, url: "/person" })
      .mockResolvedValueOnce({ asset: { id: "outfit" }, url: "/outfit" });
    render(<FashionTryOn outfit={{ id: "test", image: "img/test.webp" }} />);
    fireEvent.change(screen.getByLabelText("选择人物照片"), { target: { files: [new File(["photo"], "photo.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(mocks.upload.mock.calls[0]?.[3]).toBe("try-on");
    const request = mocks.create.mock.calls[0]![0];
    expect(request.attachments.map((item: { assetId: string }) => item.assetId)).toEqual(["person", "outfit"]);
    expect(request.prompt).toContain("虚拟试穿");
    expect(request.imageGenerationPreference).toEqual({ mode: "auto", models: [], requirePaidConfirmation: true });
  });

  it("does not create a canvas when an upload fails", async () => {
    mocks.upload.mockRejectedValueOnce(new Error("upload failed"));
    render(<FashionTryOn outfit={{ id: "test", image: "img/test.webp" }} />);
    fireEvent.change(screen.getByLabelText("选择人物照片"), { target: { files: [new File(["photo"], "photo.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent("upload failed");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("ignores repeated submissions while the first photo upload is running", async () => {
    let finishUpload!: (value: unknown) => void;
    mocks.upload.mockImplementationOnce(() => new Promise((resolve) => { finishUpload = resolve; }))
      .mockResolvedValueOnce({ asset: { id: "outfit" }, url: "/outfit" });
    render(<FashionTryOn outfit={{ id: "test", image: "img/test.webp" }} />);
    const photoInput = screen.getByLabelText("选择人物照片");
    fireEvent.change(photoInput, { target: { files: [new File(["photo"], "photo.png", { type: "image/png" })] } });
    const button = screen.getByRole("button");
    act(() => { button.click(); button.click(); });
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    await act(async () => { finishUpload({ asset: { id: "person" }, url: "/person" }); });
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(mocks.upload).toHaveBeenCalledTimes(2);
  });

  it("reuses the request key after a failed create and remount", async () => {
    mocks.create.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mocks.upload.mockResolvedValue({ asset: { id: "asset" }, url: "/asset" });
    const outfit = { id: "test", image: "img/test.webp" };
    const photo = new File(["photo"], "photo.png", { type: "image/png" });
    const first = render(<FashionTryOn outfit={outfit} />);
    fireEvent.change(screen.getByLabelText("选择人物照片"), { target: { files: [photo] } });
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent("无法创建试穿画布");
    const firstKey = mocks.create.mock.calls[0]![0].idempotencyKey;
    first.unmount();
    render(<FashionTryOn outfit={outfit} />);
    fireEvent.change(screen.getByLabelText("选择人物照片"), { target: { files: [photo] } });
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[1]![0].idempotencyKey).toBe(firstKey);
    await waitFor(() => expect(sessionStorage.length).toBe(0));
  });

  it("uses a different request key for different photo contents", async () => {
    mocks.create.mockResolvedValue(false);
    mocks.upload.mockResolvedValue({ asset: { id: "asset" }, url: "/asset" });
    render(<FashionTryOn outfit={{ id: "test", image: "img/test.webp" }} />);
    const input = screen.getByLabelText("选择人物照片");
    fireEvent.change(input, { target: { files: [new File(["first"], "photo.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button"));
    await screen.findByRole("alert");
    fireEvent.change(input, { target: { files: [new File(["second"], "photo.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[1]![0].idempotencyKey).not.toBe(mocks.create.mock.calls[0]![0].idempotencyKey);
  });
});
