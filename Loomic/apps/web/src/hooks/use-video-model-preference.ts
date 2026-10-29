"use client";

import { videoGenerationPreferenceSchema, type VideoGenerationPreference } from "@helstera/shared";
import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "helstera:video-model-preference";
const DEFAULT_MODEL = "minimax-h3";
const REMOVED_MODEL_PREFIXES = ["gk-video-", "grok-"];

function isRemovedModel(model: string) {
  const id = model.trim().toLowerCase().replace(/^openai:/, "").split(/[/:]/).pop() ?? "";
  return REMOVED_MODEL_PREFIXES.some((prefix) => id.startsWith(prefix));
}

function normalizeModelId(model: string) {
  return model.trim().toLowerCase();
}

export type VideoModelPreference = VideoGenerationPreference;

const defaultPreference: VideoModelPreference = {
  mode: "auto",
  models: [DEFAULT_MODEL],
  duration: 5,
};

const listeners = new Set<() => void>();
function emitChange() {
  for (const listener of listeners) listener();
}

let cachedRaw: string | null = null;
let cachedPreference: VideoModelPreference = defaultPreference;

function getSnapshot(): VideoModelPreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedPreference = raw
        ? normalizePreference(JSON.parse(raw) as Partial<VideoModelPreference> & { model?: string })
        : defaultPreference;
    }
    return cachedPreference;
  } catch {
    return defaultPreference;
  }
}

function getServerSnapshot(): VideoModelPreference {
  return defaultPreference;
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function normalizePreference(
  preference?: Partial<VideoModelPreference> & { model?: string },
): VideoModelPreference {
  if (!preference) return defaultPreference;

  const models = Array.isArray(preference.models)
    ? preference.models.filter(
        (model): model is string => typeof model === "string" && model.length > 0 && !isRemovedModel(model),
      )
    : typeof preference.model === "string" && preference.model.length > 0 && !isRemovedModel(preference.model)
      ? [preference.model]
      : defaultPreference.models;

  const hasValidModels = models.length > 0;

  return {
    mode: preference.mode === "manual" && hasValidModels ? "manual" : "auto",
    models: hasValidModels ? models : defaultPreference.models,
    duration: typeof preference.duration === "number" ? preference.duration : defaultPreference.duration,
    ...(videoGenerationPreferenceSchema.shape.resolution.safeParse(preference.resolution).success
      && preference.resolution ? { resolution: preference.resolution } : {}),
  };
}

export function useVideoModelPreference() {
  const preference = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setPreference = useCallback((next: VideoModelPreference) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    emitChange();
  }, []);

  const setMode = useCallback(
    (mode: "auto" | "manual") => {
      setPreference({ ...preference, mode });
    },
    [preference, setPreference],
  );

  const toggleModel = useCallback(
    (model: string) => {
      const isSelected = preference.models.some((item) => normalizeModelId(item) === normalizeModelId(model));

      if (isSelected && preference.models.length === 1) {
        return;
      }

      const models = isSelected
        ? preference.models.filter((item) => normalizeModelId(item) !== normalizeModelId(model))
        : [...preference.models, model];

      setPreference({
        ...preference,
        duration: preference.duration,
        mode: "manual",
        models,
      });
    },
    [preference, setPreference],
  );

  const setDuration = useCallback((duration: number) => {
    setPreference({ ...preference, duration });
  }, [preference, setPreference]);

  const selectResolution = useCallback((model: string, resolution: NonNullable<VideoModelPreference["resolution"]>) => {
    setPreference({ ...preference, mode: "manual", models: [model], resolution });
  }, [preference, setPreference]);

  // Duration is a user choice even in automatic routing mode. Dropping the
  // preference here makes the server fall back to the tool's 5-second default.
  const activeVideoGenerationPreference = preference;

  return {
    preference,
    setPreference,
    setMode,
    toggleModel,
    setDuration,
    selectResolution,
    activeVideoGenerationPreference,
  };
}
