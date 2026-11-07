// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen,waitFor } from "@testing-library/react";
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
    expect(await screen.findByRole("listbox", { name: "热点排序" })).toBeVisible();
    await waitFor(()=>expect(screen.getByRole("option",{name:"热度排行"})).toHaveAttribute("data-highlighted"));

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option",{name:"最新发布"})).toHaveAttribute("data-highlighted");
    await user.keyboard("{End}");
    expect(screen.getByRole("option",{name:"已收藏"})).toHaveAttribute("data-highlighted");
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
    await screen.findByRole("listbox", { name: "热点排序" });
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });
});
