"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchDesktopAgentTasks,
  type DesktopAgentTaskResponse,
} from "@/lib/server-api";
export function useTaskHistory(token: string | undefined) {
  const [tasks, setTasks] = useState<DesktopAgentTaskResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef(0);
  const pending = useRef(false);
  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    if (pending.current) return;
    const id = ++request.current;
    pending.current = true;
    setLoading(true);
    try {
      const next = await fetchDesktopAgentTasks(token);
      if (id === request.current) {
        setTasks(next);
        setError("");
      }
    } catch (cause) {
      if (id === request.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "无法读取任务历史，已有记录已保留。",
        );
    } finally {
      if (id === request.current) {
        pending.current = false;
        setLoading(false);
      }
    }
  }, [token]);
  useEffect(() => {
    setTasks([]);
    setError("");
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    return () => {
      request.current++;
      pending.current = false;
      clearInterval(timer);
    };
  }, [load]);
  return { tasks, loading, error, load };
}
