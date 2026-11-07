import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

export async function selectOption(trigger: HTMLElement, name: string | RegExp) {
  const user = userEvent.setup();
  await user.click(trigger);
  await user.click(await screen.findByRole("option", { name }));
}
