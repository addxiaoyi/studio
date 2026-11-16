import { expect, test } from "@playwright/test";

test("real HttpOnly cookie ordering agrees with AuthProvider after old lookup and logout replies", async ({
  page,
  context,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const control = async (path: string) => {
    const response = await context.request.post(`/__control__/${path}`);
    expect(response.status()).toBe(200);
  };
  const waitHeld = async (kind: string) => {
    let id: number | undefined;
    await expect
      .poll(async () => {
        const response = await context.request.get("/__control__/state");
        const state = (await response.json()) as {
          pending: { id: number; kind: string }[];
        };
        id = state.pending.find((entry) => entry.kind === kind)?.id;
        return id;
      })
      .toBeDefined();
    if (!id) throw new Error("Held authentication request is missing");
    return id;
  };
  const identity = page.getByTestId("identity");
  const browserSession = () =>
    page.evaluate(
      async () =>
        (await (await fetch("/api/local-auth/session")).json()).session?.user
          .id ?? null,
    );
  await context.addCookies([
    {
      name: "helstera_session",
      value: "fixture-old",
      url: "http://localhost:3001",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await control("hold-session");
  await page.goto("/");
  const oldLookup = await waitHeld("session");
  await page.getByRole("button", { name: "Login fresh" }).click();
  await expect(identity).toHaveText("fresh");
  await control(`release/${oldLookup}`);
  expect(await browserSession()).toBe("fresh");
  await expect(identity).toHaveText("fresh");

  await page.getByRole("button", { name: "Login old" }).click();
  await expect(identity).toHaveText("old");
  await control("hold-logout");
  await page.getByRole("button", { name: "Sign out" }).click();
  const staleLogout = await waitHeld("logout");
  await page.getByRole("button", { name: "Login fresh" }).click();
  await expect(identity).toHaveText("fresh");
  expect(await browserSession()).toBe("fresh");
  await control(`release/${staleLogout}`);
  await expect(identity).toHaveText("none");
  expect(await browserSession()).toBeNull();
  expect(
    (await context.cookies()).find(
      (cookie) => cookie.name === "helstera_session",
    ),
  ).toBeUndefined();

  await page.getByRole("button", { name: "Login old" }).click();
  await expect(identity).toHaveText("old");
  await control("hold-logout");
  await page.getByRole("button", { name: "Sign out" }).click();
  const secondLogout = await waitHeld("logout");
  await page.getByRole("button", { name: "Login fresh" }).click();
  await expect(identity).toHaveText("fresh");
  await control("hold-session");
  await control(`release/${secondLogout}`);
  const reconciliation = await waitHeld("session");
  await page.getByRole("button", { name: "Login latest" }).click();
  await expect(identity).toHaveText("latest");
  await control(`release/${reconciliation}`);
  expect(await browserSession()).toBe("latest");
  await expect(identity).toHaveText("latest");
  await expect(page.getByTestId("loading")).toHaveText("false");
  await expect(page.getByTestId("failure")).toHaveText("none");
  expect(errors).toEqual([]);
  const trace = await (await context.request.get("/__control__/state")).json();
  await info.attach("cookie-order-evidence", {
    body: JSON.stringify(
      {
        trace,
        httpOnlyCookie: true,
        actualAuthProvider: true,
        actualLocalAuthClient: true,
        productionService: false,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  await page.screenshot({ path: info.outputPath("auth-cookie-verified.png") });
});
