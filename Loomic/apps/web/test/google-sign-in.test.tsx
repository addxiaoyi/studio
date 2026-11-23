// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../src/lib/env", () => ({ getServerBaseUrl: () => "" }));
vi.mock("../src/lib/i18n", () => ({ useLocale: () => "zh-CN" }));
import { GoogleSignIn } from "../src/components/auth/google-sign-in";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("starts configured Google sign-in with the intended return path", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ google: { enabled: true, linkedEmail: null } }),
        ),
      ),
  );
  render(<GoogleSignIn returnTo="/projects/?view=list" />);
  expect(
    await screen.findByRole("link", { name: "使用 Google 登录" }),
  ).toHaveAttribute(
    "href",
    "/api/local-auth/google/start?returnTo=%2Fprojects%2F%3Fview%3Dlist",
  );
});
it("lets users retry a provider lookup failure", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ google: { enabled: true, linkedEmail: null } }),
        ),
      ),
  );
  render(<GoogleSignIn />);
  fireEvent.click(await screen.findByRole("button", { name: "重试" }));
  expect(
    await screen.findByRole("link", { name: "使用 Google 登录" }),
  ).toBeInTheDocument();
});
it("shows an existing connection without offering another bind", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          google: { enabled: true, linkedEmail: "linked@gmail.com" },
        }),
      ),
    ),
  );
  render(<GoogleSignIn linkAccount />);
  expect(
    await screen.findByText("已绑定 Google：linked@gmail.com"),
  ).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
it("shows the callback error beside the account linking action", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ google: { enabled: true, linkedEmail: null } }),
        ),
      ),
  );
  render(<GoogleSignIn linkAccount callbackError="google_canceled" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("取消 Google");
  expect(
    screen.getByRole("link", { name: "绑定 Google 账号" }),
  ).toHaveAttribute(
    "href",
    "/api/local-auth/google/start?returnTo=%2Fhome%2F&intent=link",
  );
});
