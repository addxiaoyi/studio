import { afterEach, expect, it, vi } from "vitest";
import { pollBrowserSessions } from "@/lib/agent-browser-poll";
import { AgentBrowserAccessError } from "@/lib/agent-browser-api";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it("backs off failures, pauses offline and resumes once without overlapping requests", async () => {
  vi.useFakeTimers(); vi.spyOn(Math,"random").mockReturnValue(0);
  const read = vi.fn().mockRejectedValue(new Error("HTTP 502"));
  const report = vi.fn();
  const stop = pollBrowserSessions({read, report, interval:()=>1000});
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1999); expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(read).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(3999); expect(read).toHaveBeenCalledTimes(2);
  Object.defineProperty(navigator,"onLine",{configurable:true,value:false}); window.dispatchEvent(new Event("offline"));
  await vi.advanceTimersByTimeAsync(120000); expect(read).toHaveBeenCalledTimes(2);
  read.mockResolvedValue(undefined);
  Object.defineProperty(navigator,"onLine",{configurable:true,value:true}); window.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(0); expect(read).toHaveBeenCalledTimes(3);
  stop(); await vi.advanceTimersByTimeAsync(120000); expect(read).toHaveBeenCalledTimes(3);
});
it("stops after revoked access and aborts stalled reads at the deadline", async () => {
  vi.useFakeTimers();
  const denied = vi.fn().mockRejectedValue(new AgentBrowserAccessError(403,"权限已撤销"));
  const stop = pollBrowserSessions({read:denied,report:vi.fn(),interval:()=>1000});
  await vi.advanceTimersByTimeAsync(120000); expect(denied).toHaveBeenCalledTimes(1); stop();
  let aborted = false;
  const slow = vi.fn((signal:AbortSignal)=>new Promise<void>((_resolve,reject)=>signal.addEventListener("abort",()=>{aborted=true;reject(new Error("aborted"));})));
  const report=vi.fn(), cancel=pollBrowserSessions({read:slow,report,interval:()=>1000});
  await vi.advanceTimersByTimeAsync(15000); expect(aborted).toBe(true); expect(report).toHaveBeenLastCalledWith(expect.any(Error),expect.any(Number)); cancel();
});
