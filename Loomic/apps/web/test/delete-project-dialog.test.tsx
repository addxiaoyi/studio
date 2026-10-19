// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeleteProjectDialog } from "../src/components/delete-project-dialog";

describe("DeleteProjectDialog", () => {
  afterEach(cleanup);

  it("exposes a named dialog and destructive confirmation description", () => {
    render(
      <DeleteProjectDialog
        open
        deleting={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: /删除项目|Delete project/ });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/项目会移入回收站，7 天后自动清理|The project will move to the recovery area/);
    expect(screen.getByRole("button", { name: /移到回收站|Move to recovery/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /取消|Cancel/ })).toBeInTheDocument();
  });
});
