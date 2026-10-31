// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentDocumentResult } from "../src/components/agent-document-result";

const report = { id: "report", title: "网页研究", fileName: "report.md", mimeType: "text/markdown" as const, content: "# Evidence\n<script>untrusted</script>", sourceUrls: [] };
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("goal document download", () => {
  it("downloads a UTF-8 Markdown file without claiming local folder delivery", async () => {
    const create = vi.fn().mockReturnValue("blob:report");
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("report.md");
      expect(this.href).toBe("blob:report");
    });
    render(<AgentDocumentResult report={report} english />);
    expect(screen.getByText(/Not automatically saved/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Download Markdown" }));
    expect(click).toHaveBeenCalledOnce();
    const blob = create.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe("text/markdown;charset=utf-8");
    expect(blob.size).toBe(new TextEncoder().encode(report.content).length);
    expect(document.querySelector("script")).toBeNull();
  });
  it("shows a recoverable localized error when download setup fails", async () => {
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => { throw new Error("Unavailable"); }) });
    render(<AgentDocumentResult report={report} english={false} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "下载 Markdown" }));
    expect(screen.getByRole("alert")).toHaveTextContent("报告仍已保留");
  });
});
