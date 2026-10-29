import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { SkillDetail, SkillUpdateRequest } from "@helstera/shared";
import { SkillDetailDialog } from "@/components/skills/skill-detail-dialog";

const skill: SkillDetail = {
  id: "skill-1",
  name: "Brand voice",
  slug: "brand-voice",
  description: "Write in our brand voice.",
  author: "Me",
  version: "1.0.0",
  category: "writing",
  iconName: null,
  source: "user",
  isFeatured: false,
  metadata: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  license: null,
  skillContent: "# Brand voice",
  createdBy: "user-1",
  installed: false,
};

function renderDialog(
  onUpdate: (id: string, input: SkillUpdateRequest) => Promise<void>,
) {
  render(
    <SkillDetailDialog
      skill={skill}
      open
      onOpenChange={vi.fn()}
      onInstall={vi.fn()}
      onUninstall={vi.fn()}
      onUpdate={onUpdate}
    />,
  );
}

describe("SkillDetailDialog custom skill editing", () => {
  it("saves edited fields", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    renderDialog(onUpdate);

    await user.click(screen.getByRole("button", { name: "编辑" }));
    await user.clear(screen.getByLabelText("名称"));
    await user.type(screen.getByLabelText("名称"), "Product copy");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    expect(onUpdate).toHaveBeenCalledWith(
      "skill-1",
      expect.objectContaining({ name: "Product copy", category: "writing" }),
    );
  });

  it("keeps the editor open and shows the server error", async () => {
    const user = userEvent.setup();
    renderDialog(
      vi
        .fn()
        .mockRejectedValue(
          new Error("A skill with a similar name already exists."),
        ),
    );

    await user.click(screen.getByRole("button", { name: "编辑" }));
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "A skill with a similar name already exists.",
    );
    expect((screen.getByLabelText("名称") as HTMLInputElement).value).toBe(
      "Brand voice",
    );
  });
});
