"use client";
import { useEffect, useRef, useState } from "react";
import type { AgentBrowserSession } from "@helstera/shared";
import {
  AgentBrowserAccessError,
  controlAgentBrowser,
  listAgentBrowsers,
  readAgentBrowserFrame,
} from "@/lib/agent-browser-api";

export function useAgentBrowsers(
  token: string | undefined,
  open: boolean,
  wantedTaskId?: string,
) {
  const [sessions, setSessions] = useState<AgentBrowserSession[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [frame, setFrame] = useState("");
  const [frameInfo,setFrameInfo]=useState({revision:0,url:''});
  const [frameError, setFrameError] = useState("");
  const ownedUrl = useRef("");
  const selected =
    sessions.find((item) => item.id === selectedId) ??
    sessions.find((item) =>
      wantedTaskId
        ? item.taskId === wantedTaskId
        : ["running", "starting", "paused"].includes(item.state),
    ) ??
    (!wantedTaskId ? sessions[0] : undefined);
  const latestSelected = useRef(selected);
  latestSelected.current = selected;

  useEffect(() => {
    setSelectedId("");
  }, [wantedTaskId, token]);
  useEffect(() => {
    if (!token) {
      setSessions([]);
      return;
    }
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const response = await listAgentBrowsers(token!, abort.signal);
        if (abort.signal.aborted) return;
        setSessions(response.sessions);
        setEnabled(response.enabled);
        setError("");
      } catch (cause) {
        if (!abort.signal.aborted) {
          setError(
            cause instanceof Error ? cause.message : "无法读取浏览器会话。",
          );
          setSessions((current) =>
            cause instanceof AgentBrowserAccessError
              ? []
              : current.map((item) =>
                  ["starting", "running", "paused"].includes(item.state)
                    ? { ...item, state: "interrupted" }
                    : item,
                ),
          );
        }
      } finally {
        if (!abort.signal.aborted) {
          setLoading(false);
          timer = setTimeout(poll, open && !document.hidden ? 1000 : 5000);
        }
      }
    }
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [token, open, refresh]);

  useEffect(() => {
    if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
    ownedUrl.current = "";
    setFrame("");
    setFrameInfo({revision:0,url:''});
    setFrameError("");
    return () => {
      if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
      ownedUrl.current = "";
    };
  }, [selected?.id, token]);
  useEffect(() => {
    if (!token || !open || !selected?.id) return;
    const abort = new AbortController();
    const sessionId=selected.id;
    let timer:ReturnType<typeof setTimeout>|undefined;
    let deliveredRevision=-1;
    async function nextFrame(){
      const current=latestSelected.current;
      try{
        if(!current||current.id!==sessionId||!current.frameRevision||current.frameRevision===deliveredRevision||document.hidden)return;
        // Metadata may advance faster than the network; never starve an in-flight frame.
        const blob=await readAgentBrowserFrame(token!,current,abort.signal);
        if(abort.signal.aborted)return;
        const url=URL.createObjectURL(blob),previous=ownedUrl.current;
        ownedUrl.current=url;deliveredRevision=current.frameRevision;
        setFrame(url);setFrameInfo({revision:current.frameRevision,url:current.url});setFrameError("");if(previous)URL.revokeObjectURL(previous);
      }catch(cause){
        if(!abort.signal.aborted){
          setFrameError(cause instanceof Error?cause.message:"画面读取失败。");
          if(cause instanceof AgentBrowserAccessError)setSessions([]);
        }
      }finally{if(!abort.signal.aborted)timer=setTimeout(nextFrame,500);}
    }
    void nextFrame();
    return()=>{abort.abort();clearTimeout(timer);};
  }, [token, open, selected?.id, refresh]);
  async function setControl() {
    if (!token || !selected || busy) return;
    setBusy(true);
    setError("");
    try {
      await controlAgentBrowser(
        token,
        selected.id,
        selected.control === "paused" ? "agent" : "paused",
      );
      setRefresh((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作未完成，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return {
    sessions,
    selected,
    select: setSelectedId,
    enabled,
    loading,
    error,
    frameError,
    frame,
    frameInfo,
    busy,
    setControl,
    retry: () => setRefresh((value) => value + 1),
  };
}
