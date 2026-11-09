"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAgentModel } from "@/hooks/use-agent-model";
import { useAuth } from "@/lib/auth-context";
import { fetchModels, fetchWorkspaceSettings } from "@/lib/server-api";
import { HELSTERA_AGENT_TOKEN_PRICES_CNY, CNY_TO_CREDIT } from "@helstera/shared";
import { useLocale } from "@/lib/i18n";

type ModelOption = { id: string; name: string; provider: string };
const ALLOWED_MODEL_IDS = new Set(["hy4-preview-f", "hy3-x", "deepseek-v4-pro", "auto", "openai:hy4-preview-f", "openai:hy3-x", "openai:deepseek-v4-pro", "openai:auto"]);
const DEFAULT_AGENT_MODEL = "openai:auto";
const PUBLIC_AGENT_NAME = "Helstera Agent";

function agentTokenPriceLabel(english = false) {
  const { input, output } = HELSTERA_AGENT_TOKEN_PRICES_CNY;
  return english ? `Per million tokens: ${(input * CNY_TO_CREDIT).toFixed(2)} input / ${(output * CNY_TO_CREDIT).toFixed(2)} output credits` : `每百万 tokens：输入 ${(input * CNY_TO_CREDIT).toFixed(2)} 积分 · 输出 ${(output * CNY_TO_CREDIT).toFixed(2)} 积分`;
}

// Sparkle icon SVG path from design spec
const SPARKLE_ICON_PATH =
  "M7.314 1.451a5.527 5.527 0 0 0 5.519 5.242v.614a5.527 5.527 0 0 0-5.519 5.242l-.007.284h-.614l-.007-.284a5.527 5.527 0 0 0-5.519-5.242v-.614a5.527 5.527 0 0 0 5.519-5.242l.007-.284h.614zm4.31 8.125c.042.835.733 1.5 1.58 1.5v.176c-.847 0-1.538.664-1.58 1.5l-.002.081h-.176l-.002-.081a1.58 1.58 0 0 0-1.579-1.5v-.176c.846 0 1.537-.665 1.58-1.5l.001-.08h.176zM7 4.204A6.6 6.6 0 0 1 4.205 7 6.6 6.6 0 0 1 7 9.795 6.6 6.6 0 0 1 9.794 7 6.6 6.6 0 0 1 7 4.204";

const CHECK_PATH =
  "M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 1 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0";

export function AgentModelSelector({ compact }: { compact?: boolean } = {}) {
  const english = useLocale() === "en-US";
  const { model, setModel } = useAgentModel();
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [workspaceModel, setWorkspaceModel] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Fetch available models
  useEffect(() => {
    const token = session?.access_token;
    Promise.all([fetchModels(), token ? fetchWorkspaceSettings(token) : Promise.resolve(null)])
      .then(([data, settingsResponse]) => {
        const visible = data.models.filter((item) => ALLOWED_MODEL_IDS.has(item.id));
        const configured = settingsResponse?.settings.chatModel ?? settingsResponse?.settings.defaultModel ?? null;
        setWorkspaceModel(configured);
        if (configured && !visible.some((item) => item.id.replace(/^openai:/, "") === configured.replace(/^openai:/, ""))) {
          visible.unshift({ id: configured.includes(":") ? configured : `openai:${configured}`, name: PUBLIC_AGENT_NAME, provider: "workspace" });
        }
        setModels(visible);
      })
      .catch(() => setLoadError(english ? "Could not load models. Reopen after refreshing." : "模型目录加载失败，请刷新后重试。"));
  }, [session?.access_token]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const isActive = model !== null;
  const selectedModel = models.find((m) => m.id === model);
  const displayLabel = selectedModel
    ? `${PUBLIC_AGENT_NAME} · ${agentTokenPriceLabel(english)}`
    : workspaceModel
      ? `${PUBLIC_AGENT_NAME} · ${agentTokenPriceLabel(english)}`
      : `${PUBLIC_AGENT_NAME} · ${agentTokenPriceLabel(english)}`;

  // Auto-positioning popover (above or below based on available space)
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const popoverHeight = 360;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openAbove = spaceBelow < popoverHeight && rect.top > spaceBelow;

    if (openAbove) {
      setPopoverStyle({
        position: "fixed",
        bottom: window.innerHeight - rect.top + 8,
        left: rect.left,
        zIndex: 9999,
      });
    } else {
      setPopoverStyle({
        position: "fixed",
        top: rect.bottom + 8,
        left: rect.left,
        zIndex: 9999,
      });
    }
  }, [open]);

  // Deduplicate provider list from actual models
  const providers = [...new Set(models.map((m) => m.provider))];

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-expanded={open}
        title={displayLabel}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center justify-center gap-1 box-border rounded-full border cursor-pointer font-inter transition-all duration-300 ${
          compact ? "h-8 px-2.5" : "h-8 px-3"
        } ${
          isActive
            ? "border-primary bg-primary/15 text-foreground hover:bg-primary/20"
            : "border-border/60 glass-soft text-foreground hover:glass"
        }`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          fill="none"
          viewBox="0 0 14 14"
          className="[&_path]:fill-current"
        >
          <path fill="currentColor" d={SPARKLE_ICON_PATH} />
        </svg>
        <span className={compact ? "text-[11px]" : "text-xs"}>{PUBLIC_AGENT_NAME}</span>
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            style={popoverStyle}
            className="w-56 rounded-2xl border border-border/60 bg-background/95 p-2 shadow-2xl backdrop-blur-xl"
          >
            <div className="mb-2 px-2 text-xs font-medium text-muted-foreground">
              {english ? "Assistant model and usage" : "助手模型与计费"}
            </div>
            <p className="mb-2 px-2 text-xs leading-5 text-muted-foreground">{agentTokenPriceLabel(english)}。{english ? "Final usage is recorded in credit transactions." : "按实际用量结算，可在积分明细核对。"}</p>
            {loadError && <p role="alert" className="px-2 text-xs text-destructive">{loadError}</p>}
            {/* Auto keeps the workspace default within the allowed model set. */}
            <button
              type="button"
              onClick={() => {
                setModel(null);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-300 ${
                !isActive
                  ? "bg-accent/10 text-accent-foreground"
                  : "hover:bg-foreground/[0.04]"
              }`}
            >
              <span className="flex-1 text-left">{PUBLIC_AGENT_NAME}</span>
              {!isActive && (
                <svg
                  className="h-3 w-3 text-accent-foreground"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d={CHECK_PATH} />
                </svg>
              )}
            </button>
            {/* Group by provider */}
            {providers.map((provider) => {
              const providerModels = models.filter(
                (m) => m.provider === provider,
              );
              if (providerModels.length === 0) return null;
              return (
                <div key={provider} className="mt-2">
                  <div className="flex items-center gap-1.5 px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
                    Helstera
                  </div>
                  {providerModels.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setModel(m.id);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-300 ${
                        model === m.id
                          ? "bg-accent/10 text-accent-foreground"
                          : "hover:bg-foreground/[0.04]"
                      }`}
                    >
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block truncate">{PUBLIC_AGENT_NAME}</span>
                      </span>
                      {model === m.id && (
                        <svg
                          className="h-3 w-3 text-accent-foreground"
                          viewBox="0 0 16 16"
                          fill="currentColor"
                        >
                          <path d={CHECK_PATH} />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
