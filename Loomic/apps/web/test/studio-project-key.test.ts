import { expect, it } from "vitest";
import {
  studioProjectKey,
  rememberStudioProject,
} from "@/lib/studio-project-key";

it("keeps the legacy project while isolating canvas projects and users", () => {
  const canvas = "11111111-1111-4111-8111-111111111111";
  expect(
    studioProjectKey("owner", "https://studio.0st.top/video?/MyComp"),
  ).toBe("owner");
  const key = studioProjectKey(
    "owner",
    `https://studio.0st.top/video/?timelineCanvas=${canvas}`,
  );
  expect(key).toBe(`owner:canvas:${canvas}`);
  expect(
    studioProjectKey(
      "owner",
      `https://studio.0st.top/video/?returnCanvas=${canvas}`,
    ),
  ).toBe(key);
  expect(
    studioProjectKey(
      "peer",
      `https://studio.0st.top/video/?timelineCanvas=${canvas}`,
    ),
  ).not.toBe(key);
  expect(
    studioProjectKey("owner", "https://studio.0st.top/video/?project=bad"),
  ).toBe("owner");
});
it("restores a canvas project on composition reload but clears it when opening the default workspace", () => {
  sessionStorage.clear();
  const address = "https://studio.0st.top/video";
  const canvas = "11111111-1111-4111-8111-111111111111";
  const key = rememberStudioProject(
    "owner",
    `${address}?timelineCanvas=${canvas}`,
  );
  expect(rememberStudioProject("owner", `${address}?/Canvas-test`)).toBe(key);
  expect(rememberStudioProject("peer", `${address}?/Canvas-test`)).toBe("peer");
  expect(rememberStudioProject("owner", address)).toBe("owner");
  expect(rememberStudioProject("owner", `${address}?/MyComp`)).toBe("owner");
});
