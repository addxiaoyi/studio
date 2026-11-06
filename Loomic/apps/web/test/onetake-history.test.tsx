import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useOneTake } from "@/hooks/use-onetake";

const api = vi.hoisted(() => ({ tasks: vi.fn(), capabilities: vi.fn(), task: vi.fn() }));
vi.mock("@/lib/onetake-api", () => ({ oneTakeApi: api }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("restores the selected transcript even when it is outside the recent history page", async () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  api.tasks.mockResolvedValue([]);
  api.capabilities.mockResolvedValue({ available: true, models: ["base"] });
  api.task.mockResolvedValue({ id, state: "completed", revision: 3, progress: 100 });
  const view = renderHook(() => useOneTake("test", id));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  expect(view.result.current.task?.id).toBe(id);
  expect(view.result.current.tasks.map(task => task.id)).toContain(id);
});
