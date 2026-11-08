"use client";
import { useEffect, useState } from "react";
import type { WorkflowNode } from "@helstera/shared";
import { StyledSelect } from "@/components/ui/styled-select";
import {
  fetchImageModels,
  fetchVideoModels,
  type ImageModelInfo,
  type VideoModelInfo,
} from "@/lib/server-api";

export function CreativeInspector({
  node,
  disabled,
  onChange,
  referenceCount = 0,
}: {
  node: WorkflowNode;
  disabled: boolean;
  onChange(node: WorkflowNode): void;
  referenceCount?: number;
}) {
  const config = node.config;
  const [models, setModels] = useState<Array<ImageModelInfo | VideoModelInfo>>(
      [],
    ),
    [error, setError] = useState("");
  const [loading, setLoading] = useState(false),
    [retry, setRetry] = useState(0);
  const mediaType = config.kind === "generate" ? config.mediaType : null;
  useEffect(() => {
    if (!mediaType) return;
    let active = true;
    setLoading(true);
    setError("");
    void (mediaType === "image" ? fetchImageModels() : fetchVideoModels())
      .then((reply) => {
        if (active) setModels(reply.models);
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "模型目录读取失败。",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mediaType, retry]);
  if (config.kind === "text")
    return (
      <>
        <label>
          资料用途
          <StyledSelect
            aria-label="资料用途"
            disabled={disabled}
            value={config.role}
            options={[
              { value: "story", label: "故事与创意" },
              { value: "script", label: "剧本原文" },
              { value: "character", label: "角色 / 场景设定" },
              { value: "prompt", label: "提示词" },
            ]}
            onChange={(role) =>
              onChange({
                ...node,
                config: { ...config, role: role as typeof config.role },
              })
            }
          />
        </label>
        <label>
          创作资料
          <textarea
            className="workflow-field"
            rows={8}
            value={config.text}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...node,
                config: { ...config, text: event.target.value },
              })
            }
          />
        </label>
        <p className="text-xs text-muted-foreground">
          这段内容会沿连线提供给编剧与生成节点，角色设定可连接到多个镜头。
        </p>
      </>
    );
  if (config.kind === "write")
    return (
      <>
        <label>
          编剧任务
          <StyledSelect
            aria-label="编剧任务"
            disabled={disabled}
            value={config.mode}
            options={[
              { value: "rewrite", label: "改写创作资料" },
              { value: "script", label: "故事转剧本" },
              { value: "storyboard", label: "剧本拆成分镜" },
            ]}
            onChange={(mode) =>
              onChange({
                ...node,
                config: { ...config, mode: mode as typeof config.mode },
              })
            }
          />
        </label>
        <label>
          创作要求
          <textarea
            className="workflow-field"
            rows={5}
            disabled={disabled}
            value={config.instruction}
            onChange={(event) =>
              onChange({
                ...node,
                config: { ...config, instruction: event.target.value },
              })
            }
          />
        </label>
        {config.mode === "storyboard" && (
          <label>
            镜头数量
            <input
              className="workflow-field"
              type="number"
              min={1}
              max={6}
              value={config.shotCount}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...node,
                  config: {
                    ...config,
                    shotCount: Math.max(
                      1,
                      Math.min(6, Number(event.target.value)),
                    ),
                  },
                })
              }
            />
          </label>
        )}
        <p className="text-xs text-muted-foreground">
          使用本站当前 Agent 模型，结果保留结构化镜头和可编辑正文。
        </p>
      </>
    );
  if (config.kind === "shot")
    return (
      <label>
        使用第几个镜头
        <input
          className="workflow-field"
          type="number"
          min={1}
          max={6}
          value={config.index}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...node,
              config: {
                ...config,
                index: Math.max(1, Math.min(6, Number(event.target.value))),
              },
            })
          }
        />
      </label>
    );
  if (config.kind === "frame")
    return (
      <label>
        抽帧时间（秒）
        <input
          className="workflow-field"
          type="number"
          min={0}
          max={7200}
          step={0.1}
          value={config.at}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...node,
              config: {
                ...config,
                at: Math.max(0, Number(event.target.value)),
              },
            })
          }
        />
      </label>
    );
  if (config.kind === "compose")
    return (
      <>
        <label>
          成片画幅
          <StyledSelect
            aria-label="成片画幅"
            value={config.aspect}
            disabled={disabled}
            options={[
              { value: "original", label: "跟随第一个镜头" },
              { value: "landscape", label: "横屏 16:9" },
              { value: "portrait", label: "竖屏 9:16" },
            ]}
            onChange={(aspect) =>
              onChange({
                ...node,
                config: { ...config, aspect: aspect as typeof config.aspect },
              })
            }
          />
        </label>
        <p className="text-xs text-muted-foreground">
          按下方输入顺序拼接，保留音轨；移动节点不会改变镜头顺序。
        </p>
      </>
    );
  if (config.kind !== "generate") return null;
  const chosen = models.find((model) => model.id === config.model);
  const supportsReferences = (model: ImageModelInfo | VideoModelInfo) => config.mediaType === "image" ? (model.capabilities as ImageModelInfo["capabilities"])?.imageToImage !== false : model.capabilities?.imageToVideo !== false;
  const compatibleModels = referenceCount ? models.filter(supportsReferences) : models;
  return (
    <>
      <label>
        生成类型
        <StyledSelect
          aria-label="生成类型"
          value={config.mediaType}
          disabled={disabled}
          options={[
            { value: "image", label: "图片 / 参考帧" },
            { value: "video", label: "视频镜头" },
          ]}
          onChange={(value) =>
            onChange({
              ...node,
              config: {
                ...config,
                mediaType: value as "image" | "video",
                model: "",
              },
            })
          }
        />
      </label>
      <label>
        生成模型
        <StyledSelect
          aria-label="生成模型"
          value={config.model}
          disabled={disabled || loading}
          options={[
            { value: "", label: loading ? "正在加载模型…" : "选择本站模型" },
            ...compatibleModels.map((model) => ({
              value: model.id,
              label: model.displayName || model.id,
            })),
          ]}
          onChange={(model) =>
            onChange({ ...node, config: { ...config, model } })
          }
        />
      </label>
      {chosen && referenceCount > 0 && !supportsReferences(chosen) && <p role="alert" className="text-xs text-destructive">当前模型不支持参考图片，请更换模型后运行；不会忽略已嵌入的素材。</p>}
      {!loading && !error && referenceCount > 0 && !compatibleModels.length && <p role="alert" className="text-xs text-destructive">暂无支持参考图的模型，请配置支持图生图或图生视频的模型。</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          模型目录读取失败。
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            重试
          </button>
        </p>
      )}
      {!loading && !error && !models.length && (
        <p className="text-xs text-muted-foreground">
          暂无可用模型，请先配置本站模型服务。
        </p>
      )}
      <label>
        补充提示词
        <textarea
          className="workflow-field"
          rows={4}
          disabled={disabled}
          value={config.prompt}
          onChange={(event) =>
            onChange({
              ...node,
              config: { ...config, prompt: event.target.value },
            })
          }
        />
      </label>
      <label>
        画幅
        <StyledSelect
          aria-label="生成画幅"
          value={config.aspectRatio}
          disabled={disabled}
          options={["16:9", "9:16", "1:1", "4:3", "3:4"].map((value) => ({
            value,
            label: value,
          }))}
          onChange={(aspectRatio) =>
            onChange({
              ...node,
              config: {
                ...config,
                aspectRatio: aspectRatio as typeof config.aspectRatio,
              },
            })
          }
        />
      </label>
      {config.mediaType === "video" && (
        <>
          <label>
            镜头时长（秒）
            <input
              className="workflow-field"
              type="number"
              min={1}
              max={30}
              value={config.duration}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...node,
                  config: {
                    ...config,
                    duration: Math.max(
                      1,
                      Math.min(30, Number(event.target.value)),
                    ),
                  },
                })
              }
            />
          </label>
          <label>
            分辨率
            <StyledSelect
              aria-label="生成分辨率"
              value={config.resolution}
              disabled={disabled}
              options={["480p", "720p", "768p", "1080p"].map((value) => ({
                value,
                label: value,
              }))}
              onChange={(resolution) =>
                onChange({
                  ...node,
                  config: {
                    ...config,
                    resolution: resolution as typeof config.resolution,
                  },
                })
              }
            />
          </label>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        {chosen ? `已选 ${chosen.displayName}。` : "请选择模型。"}
        {chosen?.creditCost != null ? `目录参考价 ${chosen.creditCost} 积分；` : ""}运行到此节点时按实际素材、模型与参数报价，逐次确认后才生成。
      </p>
    </>
  );
}
