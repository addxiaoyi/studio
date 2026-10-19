// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StyledSelect } from "../src/components/ui/styled-select";

afterEach(cleanup);

describe("StyledSelect", () => {
  const options = [
    { value: "heat", label: "热度排行" },
    { value: "latest", label: "最新发布" },
    { value: "saved", label: "已收藏" },
  ];

  it("supports listbox keyboard navigation and commits the highlighted option", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <StyledSelect
        value="heat"
        onChange={onChange}
        aria-label="热点排序"
        options={options}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "热点排序" });
    await user.click(trigger);
    expect(screen.getByRole("listbox", { name: "热点排序" })).toBeVisible();
    expect(trigger.getAttribute("aria-activedescendant")).toMatch(/option-0$/);

    await user.keyboard("{ArrowDown}");
    expect(trigger.getAttribute("aria-activedescendant")).toMatch(/option-1$/);
    await user.keyboard("{End}");
    expect(trigger.getAttribute("aria-activedescendant")).toMatch(/option-2$/);
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith("saved");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes with Escape without changing the selected value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <StyledSelect
        value="heat"
        onChange={onChange}
        aria-label="热点排序"
        options={options}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "热点排序" });
    await user.click(trigger);
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });
});
