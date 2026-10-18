import pg from "pg";

import { buildConfiguredVideoRequest } from "./provider-generation.js";
import { getModelCallProfile, validateProfileInput } from "./model-call-profiles.js";
import { openModelSecret } from "./model-settings-crypto.js";

const MODEL_ID = "minimax-h3";
const PROBE_TIMEOUT_MS = 10_000;
const PROBE_IMAGE = "https://studio.0st.top/probe/minimax-first-frame.png";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const { rows } = await db.query<{
    provider_id: string;
    label: string;
    base_url: string;
    key_ciphertext: string;
    api_format: string;
    request_template: Record<string, unknown> | null;
    response_template: Record<string, unknown> | null;
    provider_health: string;
    model_health: string;
    model_enabled: boolean;
  }>(
    `select pc.id as provider_id, pc.label, pc.base_url, pc.key_ciphertext, pc.api_format,
            pc.request_template, pc.response_template, pc.health_status as provider_health,
            pm.health_status as model_health, pm.enabled as model_enabled
       from provider_configs pc
       join provider_models pm on pm.provider_id = pc.id
      where pm.model_id = $1 and pc.enabled = true and pc.health_status = 'healthy' and pm.enabled = true
      order by pc.enabled desc, pm.priority, pc.label`,
    [MODEL_ID],
  );

  const results = [];
  for (const row of rows) {
    const profile = getModelCallProfile(MODEL_ID, row.api_format);
    const inputError = validateProfileInput(profile, {
      duration: 5,
      aspectRatio: "16:9",
      inputImageCount: 1,
      enableAudio: false,
    });
    const request = buildConfiguredVideoRequest(MODEL_ID, row.api_format, row.request_template, {
      prompt: "contract probe only; do not generate",
      duration: 5,
      resolution: "720p",
      aspectRatio: "16:9",
      inputImages: [PROBE_IMAGE],
      enableAudio: false,
    });

    const started = Date.now();
    let status: number | null = null;
    let advertisedModel = false;
    let error: string | null = null;
    try {
      const response = await fetch(`${row.base_url.replace(/\/$/, "")}/models`, {
        headers: { Authorization: `Bearer ${openModelSecret(row.key_ciphertext)}` },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      status = response.status;
      const body = await response.json().catch(() => null) as { data?: Array<{ id?: unknown }> } | null;
      advertisedModel = Array.isArray(body?.data) && body.data.some((item) => item?.id === MODEL_ID || item?.id === "MiniMax-H3");
      if (!response.ok) error = `provider returned HTTP ${response.status}`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }

    results.push({
      providerId: row.provider_id,
      label: row.label,
      host: new URL(row.base_url).host,
      apiFormat: row.api_format,
      providerHealth: row.provider_health,
      modelHealth: row.model_health,
      modelEnabled: row.model_enabled,
      requestAdapter: profile.requestAdapter,
      requestFields: Object.keys(request as Record<string, unknown>),
      inputError,
      modelsStatus: status,
      modelsAdvertiseMinimax: advertisedModel,
      modelsElapsedMs: Date.now() - started,
      error,
    });
  }

  console.log(JSON.stringify({
    model: MODEL_ID,
    networkCalls: results.length,
    generationCalls: 0,
    results,
  }, null, 2));
} finally {
  await db.end();
}
