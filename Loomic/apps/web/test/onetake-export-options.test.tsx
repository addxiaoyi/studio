import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { transcriptExportSchema } from "@helstera/shared";
import { OneTakeExportOptions } from "@/components/onetake/export-options";
import { oneTakeCopy } from "@/lib/onetake-copy";

afterEach(cleanup);
it("prevents AVI soft subtitles before preparing an invalid approval", () => {
  const change = vi.fn();
  render(<OneTakeExportOptions options={transcriptExportSchema.parse({ subtitle: { mode: "soft" } })} onChange={change} copy={oneTakeCopy("zh-CN")} burnAvailable={true} disabled={false} />);
  fireEvent.change(screen.getByRole("combobox", { name: "格式" }), { target: { value: "avi" } });
  expect(transcriptExportSchema.safeParse(change.mock.calls[0]![0]).success).toBe(true);
  expect(change.mock.calls[0]![0].subtitle.mode).toBe("burn");
});
it("does not offer AVI when only soft subtitles are available", () => {
  render(<OneTakeExportOptions options={transcriptExportSchema.parse({ subtitle: { mode: "soft" } })} onChange={vi.fn()} copy={oneTakeCopy("zh-CN")} burnAvailable={false} disabled={false} />);
  expect(screen.getByRole("option", { name: "AVI" })).toBeDisabled();
});
