"use client";
import { useCallback, useEffect, useRef } from "react";

export function useNoticeTimer(duration: number, dismiss: () => void) {
  const remaining = useRef(duration);
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointer = useRef(false);
  const focused = useRef(false);
  const latest = useRef(dismiss);
  latest.current = dismiss;
  const stop = useCallback(() => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
      timer.current = undefined;
      remaining.current = Math.max(
        0,
        remaining.current - (Date.now() - started.current),
      );
    }
  }, []);
  const resume = useCallback(() => {
    if (
      !duration ||
      pointer.current ||
      focused.current ||
      document.hidden ||
      timer.current !== undefined
    )
      return;
    started.current = Date.now();
    timer.current = setTimeout(() => {
      timer.current = undefined;
      latest.current();
    }, remaining.current);
  }, [duration]);
  useEffect(() => {
    remaining.current = duration;
    resume();
    const visibility = () => {
      if (document.hidden) stop();
      else resume();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [duration, resume, stop]);
  return {
    onMouseEnter: () => {
      pointer.current = true;
      stop();
    },
    onMouseLeave: () => {
      pointer.current = false;
      resume();
    },
    onFocusCapture: () => {
      focused.current = true;
      stop();
    },
    onBlurCapture: (event: React.FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        focused.current = false;
        resume();
      }
    },
  };
}
