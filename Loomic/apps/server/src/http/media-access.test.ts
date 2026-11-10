import { expect, it } from "vitest";
import { mediaCookie, mediaCookieOwner } from "./media-access.js";

it("limits media cookies to one file, expires them and rejects tampering", () => {
  const cookie = mediaCookie("asset", "owner", true, 1000);
  expect(cookie).toContain("Path=/api/uploads/asset/file;");
  expect(cookie).toContain("HttpOnly; Secure; SameSite=None");
  expect(mediaCookieOwner(cookie, "asset", 2000)).toBe("owner");
  expect(mediaCookieOwner(cookie, "other", 2000)).toBeNull();
  expect(mediaCookieOwner(cookie, "asset", 301000)).toBeNull();
  expect(mediaCookieOwner(cookie.replace("helstera_media=", "helstera_media=x"), "asset", 2000)).toBeNull();
});
