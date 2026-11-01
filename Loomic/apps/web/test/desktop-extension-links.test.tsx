// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DesktopExtensionLinks } from "@/components/desktop-extension-links";

afterEach(cleanup);

it("provides direct desktop marketplace and MCP links", () => {
  render(<DesktopExtensionLinks />);
  const links = screen.getAllByRole("link");
  expect(links).toHaveLength(2);
  expect(links[0]?.getAttribute("href")).toMatch(/^\/desktop-app\/marketplace\/?$/);
  expect(links[0]?.textContent).toContain("Skill");
  expect(links[0]?.textContent).toContain("MCP");
  expect(links[1]?.getAttribute("href")).toMatch(/^\/desktop-app\/mcp\/?$/);
});
