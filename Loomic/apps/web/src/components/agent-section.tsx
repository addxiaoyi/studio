"use client";

import type { ModelInfo } from "@helstera/shared";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Label } from "./ui/label";

interface AgentSectionProps {
  defaultModel: string;
  onSave: (defaultModel: string) => Promise<void>;
  fetchModels: () => Promise<{ models: ModelInfo[] }>;
}

export function AgentSection({
  defaultModel: initialModel,
  onSave,
  fetchModels,
}: AgentSectionProps) {
  const [selectedModel, setSelectedModel] = useState(initialModel);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const hasChanges = selectedModel !== initialModel;

  useEffect(() => {
    fetchModels()
      .then((data) => {
        setModels(data.models);
        const ids = data.models.map((m: ModelInfo) => m.id);
        if (ids.length > 0 && !ids.includes(selectedModel) && ids[0]) {
          setSelectedModel(ids[0]);
        }
      })
      .catch(() => setModels([]))
      .finally(() => setModelsLoading(false));
  }, [fetchModels]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedModel) return;

    setSaving(true);
    setFeedback(null);

    try {
      await onSave(selectedModel);
      setFeedback({ type: "success", message: "已更新默认模型。" });
    } catch {
      setFeedback({
        type: "error",
        message: "更新失败，请稍后重试。",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-medium text-foreground">AI 模型</h2>
        <p className="mt-2 text-sm text-muted-foreground font-light">
          为你的工作区选择默认 AI 模型。
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 max-w-md">
        <div className="space-y-2.5">
          <Label htmlFor="defaultModel">默认模型</Label>
          {modelsLoading ? (
            <p className="text-sm text-muted-foreground">加载模型中…</p>
          ) : (
            <select
              id="defaultModel"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-all duration-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} ({model.provider})
                </option>
              ))}
            </select>
          )}
          <p className="text-xs text-muted-foreground">
            所有新会话将默认使用此模型。
          </p>
        </div>

        {feedback && (
          <p
            className={`text-sm ${feedback.type === "success" ? "text-success" : "text-destructive"}`}
          >
            {feedback.message}
          </p>
        )}

        <Button
          type="submit"
          disabled={saving || !hasChanges}
          className="rounded-full bg-foreground text-background hover:bg-foreground/90"
        >
          {saving ? "保存中..." : "保存"}
        </Button>
      </form>
    </div>
  );
}
