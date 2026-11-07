import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { AppSelect } from "@/components/ui/app-select";
import { StyledSelect } from "@/components/ui/styled-select";
import { useState } from "react";
afterEach(cleanup);
it("can select and reopen repeatedly inside a label", async () => {
  function Form() {
    const [value, setValue] = useState("a");
    return <label>筛选<AppSelect value={value} onChange={event=>setValue(event.target.value)}><option value="a">全部</option><option value="b">只读</option><option value="c">写入</option></AppSelect></label>;
  }
  render(<Form/>);
  const user=userEvent.setup();
  const trigger=screen.getByRole("combobox",{name:"筛选"});
  for (const name of ["只读","写入","全部"]) {
    await user.click(trigger);
    await user.click(await screen.findByRole("option",{name}));
    await waitFor(()=>expect(trigger).toHaveAttribute("aria-expanded","false"));
    expect(trigger).toHaveTextContent(name);
  }
});
it("preserves option values and form submission with disabled options", async () => {
  const onChange = vi.fn(),
    user = userEvent.setup();
  const view = render(
    <form>
      <label>
        生成模型
        <AppSelect name="model" defaultValue="a" onChange={onChange}>
          <option value="a">模型甲</option>
          <option value="b" disabled>
            不可用
          </option>
          <option value="c">模型乙</option>
        </AppSelect>
      </label>
    </form>,
  );
  await user.click(screen.getByRole("combobox", { name: "生成模型" }));
  expect(await screen.findByRole("option", { name: "不可用" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await waitFor(()=>expect(screen.getByRole("option",{name:"模型甲"})).toHaveAttribute("data-highlighted"));
  await user.keyboard("{End}");
  await waitFor(()=>expect(screen.getByRole("option",{name:"模型乙"})).toHaveAttribute("data-highlighted"));
  await user.keyboard("{Enter}");
  expect(onChange).toHaveBeenCalledOnce();
  expect(onChange.mock.calls[0]?.[0].target.value).toBe("c");
  expect(new FormData(view.container.querySelector("form")!).get("model")).toBe(
    "c",
  );
});
it("does not silently display a different model when the selected value disappears", () => {
  render(
    <StyledSelect
      value="removed"
      options={[{ value: "a", label: "其他模型" }]}
      placeholder="请选择模型"
      onChange={vi.fn()}
      aria-label="模型"
    />,
  );
  expect(screen.getByRole("combobox")).toHaveTextContent("请选择模型");
  expect(screen.getByRole("combobox")).not.toHaveTextContent("其他模型");
});
it("mounts a list inside its native dialog and restores focus on Escape", async () => {
  const user = userEvent.setup();
  render(
    <dialog open>
      <StyledSelect
        value="a"
        options={[{ value: "a", label: "模型甲" }]}
        onChange={vi.fn()}
        aria-label="模型"
      />
    </dialog>,
  );
  const trigger = screen.getByRole("combobox", { name: "模型" });
  await user.click(trigger);
  await waitFor(() =>
    expect(screen.getByRole("listbox").closest("dialog")).not.toBeNull(),
  );
  await user.keyboard("{Escape}");
  expect(trigger).toHaveFocus();
});
it("keeps menus inside an elevated browser panel",async()=>{
  render(<aside data-select-portal><StyledSelect value="a" options={[{value:"a",label:"浏览任务"}]} onChange={vi.fn()} aria-label="会话"/></aside>);
  await userEvent.setup().click(screen.getByRole("combobox",{name:"会话"}));
  await waitFor(()=>expect(screen.getByRole("listbox").closest("[data-select-portal]")).not.toBeNull());
});
