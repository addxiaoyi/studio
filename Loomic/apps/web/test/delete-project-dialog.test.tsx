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
    expect(dialog).toHaveTextContent(/确定删除此项目？此操作无法撤销。|Delete this project\? This cannot be undone\./);
    expect(screen.getByRole("button", { name: /永久删除|Delete permanently/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /取消|Cancel/ })).toBeInTheDocument();
  });
});
