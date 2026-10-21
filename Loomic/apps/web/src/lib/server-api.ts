import type {
  AssetSignedUrlResponse,
  CanvasDetail,
  ChatMessageCreateRequest,
  JobResponse,
  JobListResponse,
  MarketplaceDetail,
  MarketplaceSearchResponse,
  OfficialModelPriceCatalog,
  MessageCreateResponse,
  MessageListResponse,
  ModelListResponse,
  ProfileUpdateResponse,
  ProjectCreateRequest,
  ProjectCreateResponse,
  ProjectListResponse,
  ProjectUpdateRequest,
  RunCreateRequest,
  RunCreateResponse,
  SessionCreateResponse,
  SessionListResponse,
  SkillCreateRequest,
  SkillDetailResponse,
  SkillListResponse,
  SkillUpdateRequest,
  UploadResponse,
  ViewerResponse,
  WorkspaceSettingsResponse,
  WorkspaceSkillListResponse,
  CreateWebsiteCaptureRequest,
  WebsiteCaptureTask,
  WebsiteCaptureAssistantConnection,
  WebsiteCapturePairing,
  WebsiteActionRequest,
} from "@helstera/shared";

import { dedupeRequest } from "./dedupe-request";
import { getServerBaseUrl } from "./env";

function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  const callerSignal = init?.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal) {
    if (callerSignal.aborted) abortFromCaller();
    else callerSignal.addEventListener("abort", abortFromCaller, { once: true });
  }

  return fetch(input, { ...init, credentials: "include", signal: controller.signal })
    .finally(() => {
      window.clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    });
}

export async function requestMagicLink(email: string): Promise<void> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/auth/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) return handleErrorResponse(response);
}

// --- Error types ---

export class ApiAuthError extends Error {
  constructor(message = "unauthorized") {
    super(message);
    this.name = "ApiAuthError";
  }
}

export class ApiApplicationError extends Error {
  code: string;
  details?: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiApplicationError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

// --- Existing ---

export async function createRun(
  payload: RunCreateRequest,
  options?: { accessToken?: string },
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (options?.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }

  const response = await apiFetch(`${getServerBaseUrl()}/api/agent/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Run creation failed with status ${response.status}`);
  }

  return (await response.json()) as RunCreateResponse;
}

export type AgentWorkflowView = {
  id: string;
  goal: string;
  status: "planned" | "running" | "paused" | "completed" | "failed";
  plan: Record<string, unknown>;
  idempotency_key?: string | null;
};

export async function createAgentWorkflow(accessToken: string, goal: string, idempotencyKey: string) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/agent/workflows`, { method: "POST", headers: authJsonHeaders(accessToken), body: JSON.stringify({ goal, idempotencyKey }) });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json() as { data: AgentWorkflowView }).data;
}

export async function fetchAgentWorkflow(accessToken: string, workflowId: string) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/agent/workflows/${encodeURIComponent(workflowId)}`, { headers: authHeaders(accessToken) });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json() as { data: AgentWorkflowView }).data;
}

export async function approveAgentWorkflow(accessToken: string, workflowId: string) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/agent/workflows/${encodeURIComponent(workflowId)}/approve`, { method: "POST", headers: authJsonHeaders(accessToken), body: "{}" });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json() as { data: AgentWorkflowView }).data;
}

export async function retryAgentWorkflow(accessToken: string, workflowId: string) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/agent/workflows/${encodeURIComponent(workflowId)}/retry`, { method: "POST", headers: authJsonHeaders(accessToken), body: "{}" });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json() as { data: AgentWorkflowView }).data;
}

// --- Authenticated API ---

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

function authJsonHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  };
}

export async function fetchOfficialModelPrices(): Promise<OfficialModelPriceCatalog> {
  return dedupeRequest("official-model-prices", async () => {
    const response = await apiFetch(`${getServerBaseUrl()}/api/public/model-prices`);
    if (!response.ok) return handleErrorResponse(response);
    const payload = await response.json() as { ok: true; data: OfficialModelPriceCatalog };
    return payload.data;
  });
}

async function handleErrorResponse(response: Response): Promise<never> {
  if (response.status === 401) {
    throw new ApiAuthError();
  }
  if (response.status === 413) {
    throw new ApiApplicationError(
      "upload_too_large",
      "请求内容超过 50MB，请压缩参考图或视频后重试。",
    );
  }
  const body = await response.json().catch(() => null);
  const code = body?.error?.code ?? "application_error";
  const message = body?.error?.message ?? "Request failed";
  throw new ApiApplicationError(code, message, body?.data ?? body?.error);
}

export async function fetchViewer(
  accessToken: string,
): Promise<ViewerResponse> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/viewer`, {
    headers: authHeaders(accessToken),
    credentials: "include",
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as ViewerResponse;
}

export type AdminOverviewRange = 14 | 30 | 90;
export type HomeOverviewRange = 7 | 14 | 30;
export type HomeOverview = {
  periodDays: HomeOverviewRange;
  activeProjects: number;
  monthlyGenerations: number;
  teamMembers: number;
  daily: Array<{
    date: string;
    imageRequests: number;
    videoRequests: number;
    completed: number;
    failed: number;
    creditsSpent: number;
  }>;
};

export async function fetchHomeOverview(
  accessToken: string,
  days: HomeOverviewRange = 14,
): Promise<HomeOverview> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/home/overview?days=${days}`, {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
  const payload = await response.json() as { ok: true; data: HomeOverview };
  return payload.data;
}

export type AdminOverviewCharts = {
  periodDays: AdminOverviewRange;
  daily: Array<{ date: string; requested: number; succeeded: number; failed: number; creditsSpent: number }>;
  delivery: { requested: number; providerResultSaved: number; assetSaved: number; canvasRequested: number; canvasWritten: number };
  projects: { activeReady: number; activeNoPreview: number; blankCanvas: number; missingCanvas: number; archived: number };
};

export async function fetchAdminOverview(accessToken: string, days: AdminOverviewRange = 30) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/admin/overview?days=${days}`, {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as {
    ok: true;
    data: {
      users: number;
      projects: number;
      jobs: { total: number; failed: number; active: number };
      assets: number;
      creditsSpent: number;
      charts: AdminOverviewCharts;
    };
  };
}

export async function fetchAdminUsers(
  accessToken: string,
  query?: {
    q?: string;
    page?: number;
    pageSize?: number;
    workspaceId?: string;
  },
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {}))
    if (value) params.set(key, String(value));
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/admin/users${params.size ? `?${params}` : ""}`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as {
    ok: true;
    data: Array<{
      id: string;
      email: string;
      display_name: string | null;
      role: string;
      created_at: string;
      workspaces: string;
      workspace_id: string | null;
      balance: number;
    }>;
  };
}
export async function updateAdminUserRole(
  accessToken: string,
  userId: string,
  role: "admin" | "member",
) {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/admin/users/${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify({ role }),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as {
    ok: true;
    data: { user_id: string; role: string };
  };
}
export async function adjustAdminUserCredits(
  accessToken: string,
  userId: string,
  input: { workspaceId: string; amount: number; reason: string },
) {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/admin/users/${encodeURIComponent(userId)}/credits`,
    {
      method: "POST",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { ok: true; data: { balance: number } };
}

export async function deleteAdminUser(accessToken: string, userId: string) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE", headers: authHeaders(accessToken) });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { ok: true };
}

export async function fetchAdminJobs(
  accessToken: string,
  query?: {
    status?: string;
    type?: string;
    page?: number;
    pageSize?: number;
    workspaceId?: string;
  },
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {}))
    if (value) params.set(key, String(value));
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/admin/jobs${params.size ? `?${params}` : ""}`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as {
    ok: true;
    data: Array<{
      id: string;
      workspace_id: string;
      created_by: string | null;
      job_type: string;
      status: string;
      attempt_count: number;
      max_attempts: number;
      error_code: string | null;
      error_message: string | null;
      credits_cost: number | null;
      credits_transaction_id: string | null;
      refund_transaction_id: string | null;
      refund_amount: number | null;
      created_at: string;
      started_at: string | null;
      completed_at: string | null;
      failed_at: string | null;
      canceled_at: string | null;
    }>;
  };
}
export async function fetchJobTimeline(accessToken: string, jobId: string) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/jobs/${encodeURIComponent(jobId)}/timeline`, {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as {
    jobId: string;
    events: Array<{
      key: string;
      label: string;
      status: "done" | "active" | "failed" | "pending";
      at?: string;
      id?: string;
      detail?: string;
    }>;
  };
}

export async function syncJob(accessToken: string, jobId: string) {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/jobs/${encodeURIComponent(jobId)}/sync`,
    { method: "POST", headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as {
    job: JobResponse["job"];
    sync: { state?: string; status?: string; [key: string]: unknown };
  };
}

export async function exportJob(accessToken: string, jobId: string): Promise<Blob> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/jobs/${encodeURIComponent(jobId)}/export`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return response.blob();
}

export async function cancelJob(accessToken: string, jobId: string) {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: "POST", headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { ok: true; job: unknown };
}

export async function mutateAdminJob(
  accessToken: string,
  jobId: string,
  action: "retry" | "cancel",
) {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/admin/jobs/${encodeURIComponent(jobId)}/${action}`,
    { method: "POST", headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { ok: true; data: unknown };
}
export async function deleteAdminAsset(accessToken: string, assetId: string) {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/admin/assets/${encodeURIComponent(assetId)}`,
    { method: "DELETE", headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { ok: true };
}
export async function deleteAdminUpload(accessToken: string, assetId: string) {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/admin/uploads/${encodeURIComponent(assetId)}`,
    { method: "DELETE", headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { ok: true };
}
export async function updateAdminAsset(
  accessToken: string,
  assetId: string,
  input: { title: string; description: string },
) {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/admin/assets/${encodeURIComponent(assetId)}`,
    {
      method: "PATCH",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as {
    ok: true;
    data: { id: string; title: string; description: string };
  };
}
export async function updateAdminSettings(
  accessToken: string,
  defaultModel: string,
  chatModel?: string,
) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/admin/settings`, {
    method: "PUT",
    headers: authJsonHeaders(accessToken),
    body: JSON.stringify({ defaultModel, ...(chatModel ? { chatModel } : {}) }),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as {
    ok: true;
    data: { default_model: string; chat_model: string; updated_at: string };
  };
}
export async function fetchAdminChatSettings(accessToken: string) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/admin/chat-settings`, {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { ok: true; data: { chat_model: string | null; default_model: string | null; updated_at: string | null } };
}
export type AdminModelSettings = { default_model: string | null; chat_model: string | null; default_model_url: string; chat_model_url: string; default_model_key_configured: boolean; chat_model_key_configured: boolean; updated_at: string | null };
export async function fetchAdminModelSettings(accessToken: string) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/admin/model-settings`, { headers: authHeaders(accessToken) });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { ok: true; data: AdminModelSettings };
}
export async function updateAdminModelSettings(accessToken: string, input: { defaultModel?: string; chatModel?: string; defaultModelUrl?: string; chatModelUrl?: string; defaultModelKey?: string; chatModelKey?: string }) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/admin/model-settings`, { method: "PUT", headers: authJsonHeaders(accessToken), body: JSON.stringify(input) });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { ok: true; data: AdminModelSettings };
}
export async function updateAdminChatSettings(accessToken: string, chatModel: string) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/admin/chat-settings`, {
    method: "PUT",
    headers: authJsonHeaders(accessToken),
    body: JSON.stringify({ chatModel }),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { ok: true; data: { chat_model: string; default_model: string; updated_at: string } };
}
export async function fetchAdminEnv(accessToken: string) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/admin/env`, {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { ok: true; data: Record<string, string> };
}
export async function updateAdminEnv(
  accessToken: string,
  values: Record<string, string>,
) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/admin/env`, {
    method: "PUT",
    headers: authJsonHeaders(accessToken),
    body: JSON.stringify({ values }),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as {
    ok: true;
    data: { updated: string[]; restartRequired: boolean };
  };
}

export async function fetchAdminAssets(
  accessToken: string,
  query?: {
    status?: "active" | "deleted";
    page?: number;
    pageSize?: number;
    workspaceId?: string;
  },
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {}))
    if (value) params.set(key, String(value));
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/admin/assets${params.size ? `?${params}` : ""}`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as {
    ok: true;
    data: Array<{
      id: string;
      media_type: string;
      title: string | null;
      mime_type: string;
      created_by: string;
      created_at: string;
      deleted_at: string | null;
    }>;
  };
}

export async function fetchAdminSection(
  accessToken: string,
  section:
    | "settings"
    | "uploads"
    | "audit"
    | "billing"
    | "payments"
    | "health"
    | "relays",
) {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/admin/${section}`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { ok: true; data: unknown };
}

export async function fetchProjects(
  accessToken: string,
): Promise<ProjectListResponse> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/projects`, {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as ProjectListResponse;
}

export async function fetchArchivedProjects(
  accessToken: string,
): Promise<ProjectListResponse> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/projects/archived`, {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as ProjectListResponse;
}

export async function restoreProject(
  accessToken: string,
  projectId: string,
): Promise<void> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/projects/${encodeURIComponent(projectId)}/restore`,
    { method: "POST", headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
}

export type StoryAsset = {
  id: string;
  projectId: string;
  kind: "character" | "scene" | "prop";
  name: string;
  description: string;
  imageUrl: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type Storyboard = {
  id: string;
  projectId: string;
  sceneNo: number;
  title: string;
  script: string;
  shotPrompt: string;
  imageAssetId: string | null;
  videoAssetId: string | null;
  status: "draft" | "queued" | "generating" | "ready" | "failed";
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export async function fetchStoryAssets(
  accessToken: string,
  projectId: string,
): Promise<{ assets: StoryAsset[] }> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/projects/${encodeURIComponent(projectId)}/story-assets`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { assets: StoryAsset[] };
}

export async function createStoryAsset(
  accessToken: string,
  projectId: string,
  input: Pick<StoryAsset, "kind" | "name" | "description" | "imageUrl">,
): Promise<{ asset: StoryAsset }> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/projects/${encodeURIComponent(projectId)}/story-assets`,
    {
      method: "POST",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { asset: StoryAsset };
}

export async function updateStoryAsset(
  accessToken: string,
  projectId: string,
  assetId: string,
  input: Pick<
    StoryAsset,
    "kind" | "name" | "description" | "imageUrl" | "metadata"
  >,
): Promise<{ asset: StoryAsset }> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/projects/${encodeURIComponent(projectId)}/story-assets/${encodeURIComponent(assetId)}`,
    {
      method: "PATCH",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { asset: StoryAsset };
}

export async function fetchStoryboards(
  accessToken: string,
  projectId: string,
): Promise<{ storyboards: Storyboard[] }> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/projects/${encodeURIComponent(projectId)}/storyboards`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { storyboards: Storyboard[] };
}

export async function saveStoryboard(
  accessToken: string,
  projectId: string,
  input: Pick<
    Storyboard,
    | "sceneNo"
    | "title"
    | "script"
    | "shotPrompt"
    | "status"
    | "imageAssetId"
    | "videoAssetId"
    | "metadata"
  >,
): Promise<{ storyboard: Storyboard }> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/projects/${encodeURIComponent(projectId)}/storyboards`,
    {
      method: "POST",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { storyboard: Storyboard };
}

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member";
  status: "active" | "pending";
};

export type ProviderConfig = {
  id: string;
  label: string;
  baseUrl: string;
  keyLast4: string;
  enabled: boolean;
  healthStatus: string;
  models: unknown;
  failureCount: number;
  latencyMs: number | null;
  lastError: string | null;
  lastProbedAt: string | null;
  apiFormat?: "openai" | "gemini" | "anthropic" | "custom";
  requestTemplate?: unknown;
  responseTemplate?: unknown;
};

export type ProviderModelConfig = {
  modelId: string;
  displayName: string;
  mediaType: "image" | "video";
  enabled: boolean;
  billingUnit: "per_generation" | "per_second" | "per_million_tokens";
  priceCredits: number;
  inputTokenPriceCny: number | null;
  outputTokenPriceCny: number | null;
  supportsInputImage: boolean;
  supportsInputVideo: boolean;
  supportsAudio: boolean;
  maxDurationSeconds: number | null;
  maxResolution: string | null;
  priority: number;
  healthStatus?: "unknown" | "healthy" | "degraded" | "unhealthy";
  failureCount?: number;
  lastError?: string | null;
  lastSucceededAt?: string | null;
  cooldownUntil?: string | null;
};

export type AdminAuditLog = {
  id: string;
  actor_id?: string;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
};

export async function fetchAdminAudit(
  accessToken: string,
): Promise<{ data: AdminAuditLog[] }> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/admin/audit`, {
    headers: authHeaders(accessToken),
    credentials: "include",
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { data: AdminAuditLog[] };
}
export async function fetchAdminModelCallProbe(accessToken: string) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/admin/model-call-probe`, { headers: authHeaders(accessToken) });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { mode: "configuration_only"; checkedAt: string; models: Array<{ modelId: string; mediaType: string; providerLabel: string; baseUrl: string; apiFormat: string; family: string; verificationMode: "configuration_only"; callable: boolean; duplicateMappings: number; warnings: string[]; inputImageStatus: "not_applicable" | "requires_public_url" | "supported" | "unsupported"; requestPreview: { adapter: string; requiredFields: string[]; defaults: Record<string, unknown> }; responseContract: { taskId: boolean; videoUrl: boolean; imageUrl: boolean }; resolution: string | null; acceptedDurations: number[] | null; acceptedAspectRatios: string[] | null; maxInputImages: number | null }> };
}

export async function fetchAdminDouyinMcpStatus(accessToken: string) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/admin/douyin-mcp/status`, { headers: authHeaders(accessToken) });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { ok: true; data: { configured: boolean; serverUrl: string; toolGroupAid: string | null; allowedTools: string[]; mode: string; credentials: { configured: boolean; clientTokenExpiresAt: string | null; openTicketExpiresAt: string | null; lastRefreshAt: string | null; lastError: string | null; refreshSkewSeconds: number } } };
}

export async function fetchAdminDouyinMcpTools(accessToken: string) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/admin/douyin-mcp/tools`, { headers: authHeaders(accessToken) });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { ok: true; data: { tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>; total: number; checkedAt: string } };
}

export async function createDouyinJumpLink(accessToken: string, input: { kind: "live" | "profile" | "item"; value: string }) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/feed/douyin/jump-link`, { method: "POST", headers: authJsonHeaders(accessToken), body: JSON.stringify(input) });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { ok: true; data: { kind: string; url: string; expiresAt: number; manualOnly: true } };
}

export async function fetchAdminProviders(
  accessToken: string,
): Promise<{ providers: ProviderConfig[] }> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/admin/providers`, {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { providers: ProviderConfig[] };
}

export async function createAdminProvider(
  accessToken: string,
  input: {
    label: string;
    baseUrl: string;
    key: string;
    enabled: boolean;
    apiFormat?: "openai" | "gemini" | "anthropic" | "custom";
    requestTemplate?: unknown;
    responseTemplate?: unknown;
  },
): Promise<{ provider: ProviderConfig }> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/admin/providers`, {
    method: "POST",
    headers: authJsonHeaders(accessToken),
    body: JSON.stringify(input),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { provider: ProviderConfig };
}

export async function updateAdminProvider(
  accessToken: string,
  id: string,
  input: {
    label: string;
    baseUrl: string;
    key?: string;
    enabled: boolean;
    apiFormat?: "openai" | "gemini" | "anthropic" | "custom";
    requestTemplate?: unknown;
    responseTemplate?: unknown;
  },
): Promise<{ provider: ProviderConfig }> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/admin/providers/${id}`,
    {
      method: "PUT",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { provider: ProviderConfig };
}

export async function deleteAdminProvider(
  accessToken: string,
  id: string,
): Promise<void> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/admin/providers/${id}`,
    { method: "DELETE", headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
}

export async function probeAdminProvider(
  accessToken: string,
  id: string,
): Promise<{ provider: ProviderConfig }> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/admin/providers/${id}/probe`,
    { method: "POST", headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { provider: ProviderConfig };
}

export async function fetchAdminProviderModels(
  accessToken: string,
  providerId: string,
): Promise<{ models: ProviderModelConfig[] }> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/admin/providers/${providerId}/models`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { models: ProviderModelConfig[] };
}

export async function updateAdminProviderModel(
  accessToken: string,
  providerId: string,
  model: ProviderModelConfig,
): Promise<void> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/admin/providers/${providerId}/models/${encodeURIComponent(model.modelId)}`,
    {
      method: "PUT",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify(model),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
}

export async function fetchTeamMembers(
  accessToken: string,
): Promise<{ members: TeamMember[] }> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/workspaces/members`,
    {
      headers: authHeaders(accessToken),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { members: TeamMember[] };
}

export async function createProject(
  accessToken: string,
  data: ProjectCreateRequest,
  options?: { idempotencyKey?: string },
): Promise<ProjectCreateResponse> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/projects`, {
    method: "POST",
    headers: {
      ...authJsonHeaders(accessToken),
      ...(options?.idempotencyKey
        ? { "Idempotency-Key": options.idempotencyKey }
        : {}),
    },
    body: JSON.stringify(data),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as ProjectCreateResponse;
}

export async function deleteProject(
  accessToken: string,
  projectId: string,
): Promise<void> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/projects/${projectId}`,
    {
      method: "DELETE",
      headers: authHeaders(accessToken),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
}

export async function fetchProject(
  accessToken: string,
  projectId: string,
): Promise<{
  project: { id: string; name: string; brand_kit_id: string | null };
}> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/projects/${projectId}`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as {
    project: { id: string; name: string; brand_kit_id: string | null };
  };
}

export async function updateProject(
  accessToken: string,
  projectId: string,
  data: ProjectUpdateRequest,
): Promise<void> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/projects/${projectId}`,
    {
      method: "PATCH",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify(data),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
}

// --- Canvas API ---

export async function fetchCanvas(
  accessToken: string,
  canvasId: string,
): Promise<{ canvas: CanvasDetail }> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/canvases/${canvasId}`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { canvas: CanvasDetail };
}

export async function saveCanvas(
  accessToken: string,
  canvasId: string,
  content: {
    elements: Record<string, unknown>[];
    appState: Record<string, unknown>;
    files: Record<string, Record<string, unknown>>;
  },
): Promise<void> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/canvases/${canvasId}`,
    {
      method: "PUT",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify({ content }),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
}

export async function uploadThumbnail(
  accessToken: string,
  projectId: string,
  blob: Blob,
): Promise<void> {
  const formData = new FormData();
  formData.append("file", blob, "thumbnail.webp");
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/projects/${projectId}/thumbnail`,
    {
      method: "PUT",
      headers: authHeaders(accessToken),
      body: formData,
    },
  );
  if (!response.ok) return handleErrorResponse(response);
}

// --- Settings API ---

export async function updateProfile(
  accessToken: string,
  data: { displayName: string },
): Promise<ProfileUpdateResponse> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/viewer/profile`, {
    method: "PATCH",
    headers: authJsonHeaders(accessToken),
    body: JSON.stringify(data),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as ProfileUpdateResponse;
}

export async function fetchWorkspaceSettings(
  accessToken: string,
): Promise<WorkspaceSettingsResponse> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/workspace/settings`,
    {
      headers: authHeaders(accessToken),
      credentials: "include",
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as WorkspaceSettingsResponse;
}

export async function updateWorkspaceSettings(
  accessToken: string,
  data: { defaultModel: string; autoApprovePaidGeneration?: boolean; autoDeleteEmptyCanvas?: boolean },
): Promise<WorkspaceSettingsResponse> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/workspace/settings`,
    {
      method: "PUT",
      headers: authJsonHeaders(accessToken),
      credentials: "include",
      body: JSON.stringify(data),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as WorkspaceSettingsResponse;
}

export async function deleteEmptyProject(
  accessToken: string,
  projectId: string,
): Promise<{ deleted: boolean }> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/projects/${encodeURIComponent(projectId)}/if-empty`,
    {
      method: "DELETE",
      headers: authHeaders(accessToken),
      credentials: "include",
      keepalive: true,
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { deleted: boolean };
}

export async function confirmGenerationApproval(accessToken: string, approvalId: string) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/generation-approvals/${encodeURIComponent(approvalId)}/confirm`, {
    method: "POST",
    headers: authJsonHeaders(accessToken),
    credentials: "include",
    body: "{}",
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { ok: true; data: { state: "approved"; jobId?: string } };
}

export async function fetchPendingGenerationApproval(accessToken: string, canvasId: string) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/generation-approvals/pending?canvasId=${encodeURIComponent(canvasId)}`, {
    headers: authHeaders(accessToken),
    credentials: "include",
  });
  if (response.status === 404) return null;
  if (!response.ok) return handleErrorResponse(response);
  const body = await response.json() as { ok: true; data: Record<string, unknown> | null };
  return body.data ?? null;
}

export async function fetchLatestGenerationApproval(accessToken: string, canvasId: string) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/generation-approvals/latest?canvasId=${encodeURIComponent(canvasId)}`, {
    headers: authHeaders(accessToken),
    credentials: "include",
  });
  if (!response.ok) return handleErrorResponse(response);
  const body = await response.json() as { ok: true; data: Record<string, unknown> | null };
  return body.data ?? null;
}

export async function fetchGenerationApprovalStatus(accessToken: string, approvalId: string) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/generation-approvals/${encodeURIComponent(approvalId)}/status`, {
    headers: authHeaders(accessToken),
    credentials: "include",
  });
  if (!response.ok) return handleErrorResponse(response);
  const body = await response.json() as { ok: true; data: Record<string, unknown> };
  return body.data;
}

export async function confirmLatestGenerationApproval(accessToken: string, canvasId: string) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/generation-approvals/pending/confirm`, {
    method: "POST",
    headers: authJsonHeaders(accessToken),
    credentials: "include",
    body: JSON.stringify({ canvasId }),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { ok: true; data: { state: "approved"; jobId?: string } };
}

export async function cancelGenerationApproval(accessToken: string, approvalId: string) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/generation-approvals/${encodeURIComponent(approvalId)}/cancel`, {
    method: "POST",
    headers: authJsonHeaders(accessToken),
    credentials: "include",
    body: "{}",
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { ok: true; data: { state: "rejected" } };
}

export async function fetchModels(): Promise<ModelListResponse> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/models`);
  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status}`);
  }
  return (await response.json()) as ModelListResponse;
}

// --- Chat Session API ---

export function fetchSessions(
  accessToken: string,
  canvasId: string,
): Promise<SessionListResponse> {
  return dedupeRequest(`sessions:${canvasId}`, async () => {
    const response = await apiFetch(
      `${getServerBaseUrl()}/api/canvases/${canvasId}/sessions`,
      { headers: authHeaders(accessToken) },
    );
    if (!response.ok) return handleErrorResponse(response);
    return (await response.json()) as SessionListResponse;
  });
}

export async function createSession(
  accessToken: string,
  canvasId: string,
  title?: string,
): Promise<SessionCreateResponse> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/canvases/${canvasId}/sessions`,
    {
      method: "POST",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify(title ? { title } : {}),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as SessionCreateResponse;
}

export async function updateSessionTitle(
  accessToken: string,
  sessionId: string,
  title: string,
): Promise<void> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/sessions/${sessionId}`,
    {
      method: "PATCH",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify({ title }),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
}

export async function deleteSession(
  accessToken: string,
  sessionId: string,
): Promise<void> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/sessions/${sessionId}`,
    {
      method: "DELETE",
      headers: authHeaders(accessToken),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
}

export async function fetchMessages(
  accessToken: string,
  sessionId: string,
): Promise<MessageListResponse> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/sessions/${sessionId}/messages`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as MessageListResponse;
}

export async function saveMessage(
  accessToken: string,
  sessionId: string,
  data: ChatMessageCreateRequest,
): Promise<MessageCreateResponse> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/sessions/${sessionId}/messages`,
    {
      method: "POST",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify(data),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as MessageCreateResponse;
}

// --- Upload API ---

export async function uploadFile(
  accessToken: string,
  file: File,
  projectId?: string,
): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (projectId) {
    formData.append("projectId", projectId);
  }

  const response = await apiFetch(`${getServerBaseUrl()}/api/uploads`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: formData,
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as UploadResponse;
}

export async function getAssetUrl(
  accessToken: string,
  assetId: string,
): Promise<AssetSignedUrlResponse> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/uploads/${assetId}/url`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as AssetSignedUrlResponse;
}

export async function deleteAsset(
  accessToken: string,
  assetId: string,
): Promise<void> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/uploads/${assetId}`,
    {
      method: "DELETE",
      headers: authHeaders(accessToken),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
}

// --- Canvas-Native Generation API ---

export type GenerateImageResponse = {
  url: string;
  assetId: string;
  prompt: string;
  mimeType: string;
  width: number;
  height: number;
};

export type GeneratedAsset = {
  id: string;
  mediaType: "image" | "video";
  title: string | null;
  description: string | null;
  prompt: string | null;
  mimeType: string | null;
  createdAt: string;
  url: string | null;
  published: boolean;
  retentionState?: "active" | "soft_deleted" | "purged";
  retentionUntil?: string | null;
  purgeAfter?: string | null;
};

export async function fetchGeneratedAssets(
  accessToken: string,
  options: {
    page?: number;
    pageSize?: number;
    query?: string;
    mediaType?: "image" | "video";
    includeDeleted?: boolean;
  } = {},
): Promise<{
  assets: GeneratedAsset[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
}> {
  const params = new URLSearchParams({
    page: String(options.page ?? 1),
    pageSize: String(options.pageSize ?? 24),
  });
  if (options.query) params.set("q", options.query);
  if (options.mediaType) params.set("mediaType", options.mediaType);
  if (options.includeDeleted) params.set("includeDeleted", "1");
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/assets/history?${params}`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  const payload = (await response.json()) as {
    data?: Array<{
      id: string;
      media_type: "image" | "video";
      title: string | null;
      description: string | null;
      prompt: string | null;
      mime_type: string | null;
      created_at: string;
      asset_object_id: string | null;
      published?: boolean;
      retention_state?: "active" | "soft_deleted" | "purged";
      retention_until?: string | null;
      purge_after?: string | null;
    }>;
  };
  const assets: GeneratedAsset[] = (payload.data ?? []).map((asset) => ({
    id: asset.id,
    mediaType: (asset.mime_type?.startsWith("video/") ? "video" : "image") as
      | "video"
      | "image",
    title: asset.title,
    description: asset.description,
    prompt: asset.prompt,
    mimeType: asset.mime_type,
    createdAt: asset.created_at,
    url: asset.asset_object_id
      ? `${getServerBaseUrl()}/api/uploads/${asset.asset_object_id}/file`
      : null,
    published: Boolean(asset.published),
    ...(asset.retention_state ? { retentionState: asset.retention_state } : {}),
    ...(asset.retention_until !== undefined ? { retentionUntil: asset.retention_until } : {}),
    ...(asset.purge_after !== undefined ? { purgeAfter: asset.purge_after } : {}),
  }));
  return {
    assets,
    pagination: (
      payload as typeof payload & {
        pagination?: {
          page: number;
          pageSize: number;
          total: number;
          hasMore: boolean;
        };
      }
    ).pagination ?? {
      page: options.page ?? 1,
      pageSize: options.pageSize ?? 24,
      total: assets.length,
      hasMore: false,
    },
  };
}

export async function deleteGeneratedAssets(accessToken: string, assetIds: string[]): Promise<{ deletedIds: string[]; deletedCount: number; requestedCount: number }> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/assets/batch-delete`, {
    method: "POST",
    headers: authJsonHeaders(accessToken),
    body: JSON.stringify({ assetIds }),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json() as { data: { deletedIds: string[]; deletedCount: number; requestedCount: number } }).data;
}
export async function deleteGeneratedAsset(
  accessToken: string,
  assetId: string,
): Promise<void> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/assets/${encodeURIComponent(assetId)}`,
    { method: "DELETE", headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
}

export type AssetRetentionView = {
  assetId: string;
  state: "active" | "soft_deleted" | "purged";
  retentionUntil: string | null;
  purgeAfter: string | null;
  favorited: boolean;
};

export async function fetchAssetRetention(accessToken: string, assetId: string): Promise<AssetRetentionView> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/assets/${encodeURIComponent(assetId)}/retention`, { headers: authHeaders(accessToken) });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json() as { data: AssetRetentionView }).data;
}

export async function restoreGeneratedAsset(accessToken: string, assetId: string): Promise<AssetRetentionView> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/assets/${encodeURIComponent(assetId)}/restore`, { method: "POST", headers: authJsonHeaders(accessToken), body: "{}" });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json() as { data: AssetRetentionView }).data;
}

export async function publishAsset(
  accessToken: string,
  assetId: string,
  details?: { title?: string; description?: string },
) {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/gallery/${encodeURIComponent(assetId)}/publish`,
    {
      method: "POST",
      headers: {
        ...authHeaders(accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(details ?? {}),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as {
    ok: true;
    data: { id: string; asset_id: string; status: "published" };
  };
}

export async function unpublishAsset(
  accessToken: string,
  assetId: string,
): Promise<void> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/gallery/${encodeURIComponent(assetId)}/publish`,
    {
      method: "DELETE",
      headers: authHeaders(accessToken),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
}

export type ImageModelInfo = {
  id: string;
  displayName: string;
  description: string;
  provider: string;
  failureCount?: number;
  cooldownUntil?: string | null;
  iconUrl?: string;
  creditCost?: number;
  accessible?: boolean;
  minTier?: string;
  providerPriceCny?: number;
  providerInputTokenPriceCny?: number;
  providerOutputTokenPriceCny?: number;
  providerTokenPriceCny?: number;
  billingUnit?: "per_generation" | "per_second" | "per_million_tokens";
  capabilities?: {
    imageToImage?: boolean;
    textToVideo?: boolean;
    imageToVideo?: boolean;
  };
  limits?: {
    allowedDurations?: number[];
    maxResolution?: string;
  };
};

export async function fetchImageModels(): Promise<{
  models: ImageModelInfo[];
  unavailableModels: Array<
    ImageModelInfo & { availabilityReason?: string | null }
  >;
  defaultModel?: string;
}> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/image-models`);
  if (!response.ok) {
    throw new Error(`Failed to fetch image models: ${response.status}`);
  }
  const payload = (await response.json()) as {
    models: ImageModelInfo[];
    defaultModel?: string;
    unavailableModels?: Array<
      ImageModelInfo & { availabilityReason?: string | null }
    >;
  };
  return { ...payload, unavailableModels: payload.unavailableModels ?? [] };
}

export type VideoModelInfo = {
  id: string;
  displayName: string;
  description: string;
  provider: string;
  availability?: "available" | "unavailable" | "unverified" | "probing";
  availabilityReason?: string | null;
  healthStatus?: string;
  failureCount?: number;
  cooldownUntil?: string | null;
  iconUrl?: string;
  creditCost?: number;
  accessible?: boolean;
  minTier?: string;
  capabilities?: {
    textToVideo: boolean;
    imageToVideo: boolean;
    videoToVideo: boolean;
    audio: boolean;
  };
  limits?: {
    maxDuration: number;
    allowedDurations?: number[];
    maxResolution: "480p" | "720p" | "1080p" | "2160p";
    maxInputImages: number;
  };
  pricing?: {
    currency: "CNY";
    billingUnit: "generated_second";
    providerPointsName: string;
    evidenceDate: string;
    rates: Array<{
      resolution: "720p" | "1080p";
      displayResolution: string;
      providerPointsPerSecond: number;
      cnyPerSecond: { min: number; max: number };
    }>;
  };
  providerPriceCny?: number;
  providerInputTokenPriceCny?: number;
  providerOutputTokenPriceCny?: number;
  providerTokenPriceCny?: number;
  billingUnit?: "per_generation" | "per_second" | "per_million_tokens";
};

export async function fetchVideoModels(): Promise<{
  models: VideoModelInfo[];
  unavailableModels: VideoModelInfo[];
}> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/video-models`);
  if (!response.ok) {
    throw new Error(`Failed to fetch video models: ${response.status}`);
  }
  const payload = (await response.json()) as {
    models: VideoModelInfo[];
    unavailableModels?: VideoModelInfo[];
  };
  return {
    models: payload.models,
    unavailableModels: payload.unavailableModels ?? [],
  };
}

export type FeedPackageRecord = {
  id: string;
  title: string;
  brief: string;
  trend_item_id?: string | null;
  status: string;
  platforms: string[];
  duration_seconds: number;
  workflow_mode: "review" | "automatic";
  estimated_cost_cny: number | null;
  structure: {
    title: string;
    hook: string;
    audience: string;
    painPoint: string;
    angle: string;
    hypothesis: string;
    evidence: string[];
    cta: string;
    riskNotes: string[];
    imagePrompt: string;
    videoPrompt: string;
    shots: Array<{ id: string; startSecond: number; endSecond: number; visual: string; voiceover: string; subtitle: string }>;
  };
  variants?: FeedContentVariant[];
  renderJobs?: FeedRenderJob[];
};

export type FeedRenderJob = {
  id: string;
  job_type: string;
  status: string;
  error_code?: string | null;
  error_message?: string | null;
  progress?: number;
  stage?: string | null;
  attempt_count?: number;
  max_attempts?: number;
};

export type FeedContentVariant = {
  id: string;
  package_id: string;
  platform: string;
  title: string;
  body: string;
  hashtags: string[];
  cover_text: string;
  locked?: boolean;
};

async function feedRequest<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const headers = init?.body
    ? authJsonHeaders(accessToken)
    : authHeaders(accessToken);
  const response = await apiFetch(`${getServerBaseUrl()}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers ?? {}) },
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json() as { data: T }).data;
}

export type FeedTrendItem = { id: string; platform: string; title: string; summary: string; heat: number | null; source_url: string | null; published_at?: string | null; fetched_at?: string | null };
export type FeedTrendPage = { items: FeedTrendItem[]; total: number; page: number; pageSize: number; totalPages: number; sort: "heat" | "latest"; query: string };
export function fetchFeedTrends(accessToken: string, query = "", page = 1, sort: "heat" | "latest" = "heat", pageSize = 10) {
  const params = new URLSearchParams({ q: query, page: String(page), pageSize: String(pageSize), sort });
  return feedRequest<FeedTrendPage>(accessToken, `/api/feed/trends?${params.toString()}`);
}

export type FeedTrendSyncResult = {
  sources: Array<{ id: string; count: number; error: string | null }>;
  failed: number;
  partial: boolean;
  message?: string;
};

export async function syncFeedTrends(accessToken: string): Promise<FeedTrendSyncResult> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/feed/trends/sync`, {
    method: "POST",
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
  const payload = (await response.json()) as {
    data: { sources: Array<{ id: string; count: number; error: string | null }>; failed: number };
    error?: { message?: string };
  };
  return {
    ...payload.data,
    partial: Boolean(payload.error),
    ...(payload.error?.message ? { message: payload.error.message } : {}),
  };
}
export type FeedTrendSource = { id: string; name: string; platform: string; source_type: "rss" | "api"; url: string; enabled: boolean; refresh_minutes: number; last_synced_at: string | null; last_error: string | null };
export function fetchFeedSources(accessToken: string) { return feedRequest<FeedTrendSource[]>(accessToken, "/api/feed/sources"); }
export function createFeedSource(accessToken: string, input: { name: string; platform: string; sourceType: "rss" | "api"; url: string; refreshMinutes: number }) { return feedRequest<FeedTrendSource>(accessToken, "/api/feed/sources", { method: "POST", body: JSON.stringify(input) }); }
export function syncFeedSource(accessToken: string, id: string) { return feedRequest<{ count: number }>(accessToken, `/api/feed/sources/${encodeURIComponent(id)}/sync`, { method: "POST" }); }

export function fetchFeedPackages(accessToken: string) {
  return feedRequest<FeedPackageRecord[]>(accessToken, "/api/feed/packages");
}

export function fetchFeedPackage(accessToken: string, packageId: string) {
  return feedRequest<FeedPackageRecord>(
    accessToken,
    `/api/feed/packages/${encodeURIComponent(packageId)}`,
  );
}

export type FeedInsightView = {
  summary: Record<string, number> | null;
  recommendations: string[];
  insight: { summary?: string; metrics?: Record<string, number>; recommendations?: string[] } | null;
};

export function fetchFeedInsights(accessToken: string, packageId: string) {
  return feedRequest<FeedInsightView>(accessToken, `/api/feed/packages/${encodeURIComponent(packageId)}/insights`);
}
export function fetchFeedVariants(accessToken: string, packageId: string) {
  return feedRequest<FeedContentVariant[]>(
    accessToken,
    `/api/feed/packages/${encodeURIComponent(packageId)}/variants`,
  );
}

export function updateFeedVariant(accessToken: string, packageId: string, variantId: string, input: Record<string, unknown>) {
  return feedRequest<FeedContentVariant>(accessToken, `/api/feed/packages/${encodeURIComponent(packageId)}/variants/${encodeURIComponent(variantId)}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function readaptFeedVariant(accessToken: string, packageId: string, variantId: string) {
  return feedRequest<FeedContentVariant>(accessToken, `/api/feed/packages/${encodeURIComponent(packageId)}/variants/${encodeURIComponent(variantId)}/readapt`, { method: "POST", body: JSON.stringify({}) });
}
export function createFeedPackage(accessToken: string, input: Record<string, unknown>) {
  return feedRequest<FeedPackageRecord>(accessToken, "/api/feed/packages", { method: "POST", body: JSON.stringify(input) });
}

export type FeedAutomationRun = {
  id: string;
  packageId: string;
  status: "queued" | "running" | "draft_ready" | "failed";
  current_stage?: string;
  jobId?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export function createFeedAutomation(accessToken: string, input: Record<string, unknown>) {
  return feedRequest<FeedAutomationRun>(accessToken, "/api/feed/automation", { method: "POST", body: JSON.stringify(input) });
}

export function fetchFeedAutomation(accessToken: string, runId: string) {
  return feedRequest<FeedAutomationRun>(accessToken, `/api/feed/automation/${encodeURIComponent(runId)}`);
}

export function retryFeedAutomation(accessToken: string, runId: string) {
  return feedRequest<FeedAutomationRun>(accessToken, `/api/feed/automation/${encodeURIComponent(runId)}/retry`, { method: "POST", body: JSON.stringify({}) });
}

export function generateFeedStructure(accessToken: string, packageId: string) {
  return feedRequest<{ id: string; status: string; message: string }>(accessToken, `/api/feed/packages/${encodeURIComponent(packageId)}/structure/generate`, { method: "POST", body: JSON.stringify({}) });
}
export function approveFeedStructure(accessToken: string, packageId: string, structure: FeedPackageRecord["structure"]) {
  return feedRequest<FeedPackageRecord>(accessToken, `/api/feed/packages/${packageId}/structure`, { method: "PATCH", body: JSON.stringify(structure) });
}

export function saveFeedStructureDraft(accessToken: string, packageId: string, structure: FeedPackageRecord["structure"]) {
  return feedRequest<FeedPackageRecord>(accessToken, `/api/feed/packages/${encodeURIComponent(packageId)}/draft`, { method: "PATCH", body: JSON.stringify(structure) });
}

export function fetchFeedRenderStatus(accessToken: string, packageId: string) {
  return feedRequest<{ packageId: string; status: string; jobs: FeedRenderJob[] }>(accessToken, `/api/feed/packages/${encodeURIComponent(packageId)}/render-status`);
}

export function renderFeedPackage(accessToken: string, packageId: string) {
  return feedRequest<FeedRenderResponse>(
    accessToken,
    `/api/feed/packages/${encodeURIComponent(packageId)}/render`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export type FeedRenderResponse = {
  id: string;
  status: string;
  jobs?: Array<{ id: string; job_type: string }>;
  steps?: Array<{ type: string; quantity?: number; durationSeconds?: number; jobId?: string }>;
};

export function createFeedSchedule(accessToken: string, input: Record<string, unknown>) {
  return feedRequest<Record<string, unknown>>(accessToken, "/api/feed/schedules", { method: "POST", body: JSON.stringify(input) });
}

export type PublishingAccount = {
  id: string;
  platform: string;
  alias: string;
  notes: string;
  status: string;
  connection_mode: "oauth_api" | "extension" | "scan_confirm" | "deep_link";
};

export function fetchPublishingAccounts(accessToken: string) {
  return feedRequest<PublishingAccount[]>(accessToken, "/api/feed/accounts");
}

export function createPublishingAccount(accessToken: string, input: Record<string, unknown>) {
  return feedRequest<PublishingAccount>(accessToken, "/api/feed/accounts", { method: "POST", body: JSON.stringify(input) });
}

export async function revokePublishingAccount(accessToken: string, accountId: string): Promise<void> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/feed/accounts/${encodeURIComponent(accountId)}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
}

export function actOnFeedSchedule(accessToken: string, scheduleId: string, input: Record<string, unknown>) {
  return feedRequest<Record<string, unknown>>(accessToken, `/api/feed/schedules/${encodeURIComponent(scheduleId)}/action`, { method: "POST", body: JSON.stringify(input) });
}

export async function downloadFeedMetricsTemplate(accessToken: string): Promise<Blob> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/feed/metrics/template`, { headers: authHeaders(accessToken) });
  if (!response.ok) return handleErrorResponse(response);
  return response.blob();
}
export async function previewFeedMetricsCsv(accessToken: string, file: File): Promise<{ records: Record<string, unknown>[]; errors: Array<{ row: number; message: string }>; headers: string[] }> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await apiFetch(`${getServerBaseUrl()}/api/feed/metrics/import-csv/preview`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: formData,
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json() as { data: { records: Record<string, unknown>[]; errors: Array<{ row: number; message: string }>; headers: string[] } }).data;
}

export function importFeedMetrics(accessToken: string, records: Record<string, unknown>[]) {
  return feedRequest<Record<string, unknown>>(accessToken, "/api/feed/metrics/import", { method: "POST", body: JSON.stringify({ records }) });
}
export function saveFeedMetric(accessToken: string, input: Record<string, unknown>) {
  return feedRequest<Record<string, unknown>>(accessToken, "/api/feed/metrics", { method: "POST", body: JSON.stringify(input) });
}

export function getFeedTimelineUrl(packageId: string) {
  return `${getServerBaseUrl()}/api/feed/packages/${encodeURIComponent(packageId)}/timeline`;
}

export async function downloadFeedTimeline(accessToken: string, packageId: string): Promise<Blob> {
  const response = await apiFetch(getFeedTimelineUrl(packageId), { headers: authHeaders(accessToken) });
  if (!response.ok) return handleErrorResponse(response);
  return response.blob();
}

export async function downloadFeedManifest(accessToken: string, packageId: string): Promise<Blob> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/feed/packages/${encodeURIComponent(packageId)}/export`, { headers: authHeaders(accessToken) });
  if (!response.ok) return handleErrorResponse(response);
  return response.blob();
}

export async function generateImageDirect(
  accessToken: string,
  prompt: string,
  options?: {
    model?: string;
    aspectRatio?: string;
    quality?: string;
    inputImages?: string[];
    approvalId?: string;
  },
): Promise<GenerateImageResponse> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/agent/generate-image`,
    {
      method: "POST",
       headers: {
         ...authJsonHeaders(accessToken),
         ...(options?.approvalId ? { "x-generation-approval": options.approvalId } : {}),
       },
      body: JSON.stringify({
        prompt,
        ...(options?.model ? { model: options.model } : {}),
        ...(options?.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
        ...(options?.quality ? { quality: options.quality } : {}),
        ...(options?.inputImages?.length
          ? { inputImages: options.inputImages }
          : {}),
      }),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as GenerateImageResponse;
}

export type GenerateVideoResponse = {
  url: string;
  assetId: string;
  prompt: string;
  mimeType: string;
  width: number;
  height: number;
  durationSeconds: number;
};

export function videoPollDelayMs(attempt: number): number {
  const schedule = [2_000, 3_000, 5_000, 8_000, 15_000];
  return schedule[Math.min(Math.max(attempt, 0), schedule.length - 1)]!;
}

export async function generateVideoDirect(
  accessToken: string,
  prompt: string,
  options?: {
    model?: string;
    duration?: number;
    resolution?: string;
    aspectRatio?: string;
    inputImages?: string[];
    inputAssetIds?: string[];
    enableAudio?: boolean;
    canvasId?: string;
    sessionId?: string;
    projectId?: string;
    threadId?: string;
    idempotencyKey?: string;
    approvalId?: string;
    signal?: AbortSignal;
  },
): Promise<GenerateVideoResponse> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/jobs/video-generation`,
    {
      method: "POST",
      headers: {
        ...authJsonHeaders(accessToken),
        ...(options?.idempotencyKey
          ? { "Idempotency-Key": options.idempotencyKey }
          : {}),
        ...(options?.approvalId
          ? { "x-generation-approval": options.approvalId }
          : {}),
      },
      ...(options?.signal ? { signal: options.signal } : {}),
      body: JSON.stringify({
        prompt,
        ...(options?.canvasId ? { canvas_id: options.canvasId } : {}),
        ...(options?.sessionId ? { session_id: options.sessionId } : {}),
        ...(options?.projectId ? { project_id: options.projectId } : {}),
        ...(options?.threadId ? { thread_id: options.threadId } : {}),
        ...(options?.model ? { model: options.model } : {}),
        ...(options?.duration != null ? { duration: options.duration } : {}),
        ...(options?.resolution ? { resolution: options.resolution } : {}),
        ...(options?.aspectRatio ? { aspect_ratio: options.aspectRatio } : {}),
        ...(options?.inputImages?.length
          ? { input_images: options.inputImages }
          : {}),
        ...(options?.inputAssetIds?.length
          ? { input_asset_ids: options.inputAssetIds }
          : {}),
        enable_audio: options?.enableAudio ?? false,
      }),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  const { job: submitted } = (await response.json()) as JobResponse;
  let cancelRequested = false;
  const cancelSubmittedJob = () => {
    if (cancelRequested) return;
    cancelRequested = true;
    void cancelJob(accessToken, submitted.id).catch((error) =>
      console.warn("[video] failed to cancel submitted job", error),
    );
  };
  if (options?.signal) {
    if (options.signal.aborted) cancelSubmittedJob();
    else options.signal.addEventListener("abort", cancelSubmittedJob, { once: true });
  }
  const deadline = Date.now() + 20 * 60 * 1_000;
  let pollAttempt = 0;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, videoPollDelayMs(pollAttempt++)));
    const { job } = await fetchJob(accessToken, submitted.id, options?.signal);
    if (job.status === "succeeded" && job.result) {
      return {
        url: String(job.result.signed_url ?? ""),
        assetId: String(job.result.asset_id ?? ""),
        prompt,
        mimeType: String(job.result.mime_type ?? "video/mp4"),
        width: Number(job.result.width ?? 1280),
        height: Number(job.result.height ?? 720),
        durationSeconds: Number(
          job.result.duration_seconds ?? options?.duration ?? 5,
        ),
      };
    }
    if (["failed", "dead_letter", "canceled"].includes(job.status)) {
      throw new Error(job.error_message || `视频任务${job.status}`);
    }
  }

  throw new Error(
    "视频仍在后台生成，请稍后在画布或历史记录中查看。任务不会被取消。",
  );
}

// --- Jobs API ---

export async function fetchJob(
  accessToken: string,
  jobId: string,
  signal?: AbortSignal,
): Promise<JobResponse> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/jobs/${jobId}`, {
    headers: authHeaders(accessToken),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as JobResponse;
}

export async function fetchJobs(accessToken: string): Promise<JobListResponse> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/jobs`, {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as JobListResponse;
}

export async function createWebsiteCapture(
  accessToken: string,
  input: CreateWebsiteCaptureRequest,
): Promise<{ task: WebsiteCaptureTask; jobId: string | null; reused: boolean }> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/website-capture`, {
    method: "POST",
    headers: authJsonHeaders(accessToken),
    body: JSON.stringify(input),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json() as { ok: true; data: { task: WebsiteCaptureTask; jobId: string | null; reused: boolean } }).data;
}

export async function fetchWebsiteCapture(
  accessToken: string,
  taskId: string,
): Promise<{ task: WebsiteCaptureTask; events: Array<{ id: number; stage: string; detail: string; created_at: string }>; promoApproval?: { approvalId: string; jobType: "video_generation"; model: string; estimatedCredits: number; duration?: number; resolution?: string; hasReferenceImage: boolean; expiresAt: string } }> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/website-capture/${encodeURIComponent(taskId)}`, {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json() as { ok: true; data: { task: WebsiteCaptureTask; events: Array<{ id: number; stage: string; detail: string; created_at: string }>; promoApproval?: { approvalId: string; jobType: "video_generation"; model: string; estimatedCredits: number; duration?: number; resolution?: string; hasReferenceImage: boolean; expiresAt: string } } }).data;
}

export async function cancelWebsiteCapture(accessToken: string, taskId: string): Promise<{ task: WebsiteCaptureTask }> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/website-capture/${encodeURIComponent(taskId)}/cancel`, {
    method: "POST",
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json() as { ok: true; data: { task: WebsiteCaptureTask } }).data;
}

export async function retryWebsiteCapture(accessToken: string, taskId: string): Promise<{ task: WebsiteCaptureTask }> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/website-capture/${encodeURIComponent(taskId)}/retry`, {
    method: "POST",
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json() as { ok: true; data: { task: WebsiteCaptureTask } }).data;
}

export type PendingWebsiteAction = {
  actionId: string;
  action: WebsiteActionRequest;
  reason: string;
  expiresAt: string;
};

export async function fetchWebsiteCaptureActions(accessToken: string, taskId: string): Promise<PendingWebsiteAction[]> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/website-capture/${encodeURIComponent(taskId)}/actions`, {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json() as { ok: true; data: PendingWebsiteAction[] }).data;
}

export async function approveWebsiteCaptureAction(accessToken: string, actionId: string): Promise<{ actionId: string; status: "approved" }> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/website-capture/actions/${encodeURIComponent(actionId)}/approve`, {
    method: "POST",
    headers: authJsonHeaders(accessToken),
    body: "{}",
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json() as { ok: true; data: { actionId: string; status: "approved" } }).data;
}

export async function rejectWebsiteCaptureAction(accessToken: string, actionId: string): Promise<{ actionId: string; status: "rejected" }> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/website-capture/actions/${encodeURIComponent(actionId)}/reject`, {
    method: "POST",
    headers: authJsonHeaders(accessToken),
    body: "{}",
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json() as { ok: true; data: { actionId: string; status: "rejected" } }).data;
}

export async function prepareWebsitePromo(accessToken: string, taskId: string): Promise<{ state: string; request?: { approvalId: string; model: string; estimatedCredits: number; duration?: number; resolution?: string; hasReferenceImage: boolean; expiresAt: string }; jobId?: string }> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/website-capture/${encodeURIComponent(taskId)}/promo/prepare`, { method: "POST", headers: authJsonHeaders(accessToken), body: "{}" });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json() as { ok: true; data: { state: string; request?: { approvalId: string; model: string; estimatedCredits: number; duration?: number; resolution?: string; hasReferenceImage: boolean; expiresAt: string }; jobId?: string } }).data;
}

export async function createWebsiteCapturePairing(accessToken: string): Promise<WebsiteCapturePairing> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/website-capture/pairings`, { method: "POST", headers: authJsonHeaders(accessToken), body: "{}" });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json() as { ok: true; data: WebsiteCapturePairing }).data;
}

export async function fetchWebsiteAssistantConnection(accessToken: string): Promise<WebsiteCaptureAssistantConnection | null> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/website-capture/assistant`, { headers: authHeaders(accessToken) });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json() as { ok: true; data: WebsiteCaptureAssistantConnection | null }).data;
}

export async function setWebsiteAssistantPaused(accessToken: string, paused: boolean): Promise<WebsiteCaptureAssistantConnection | null> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/website-capture/assistant/${paused ? "pause" : "resume"}`, { method: "POST", headers: authJsonHeaders(accessToken), body: "{}" });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json() as { ok: true; data: WebsiteCaptureAssistantConnection | null }).data;
}

export async function revokeWebsiteAssistant(accessToken: string): Promise<void> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/website-capture/assistant/revoke`, { method: "POST", headers: authJsonHeaders(accessToken), body: "{}" });
  if (!response.ok) return handleErrorResponse(response);
}

// --- Skills API ---

export async function fetchSkills(
  accessToken: string,
): Promise<SkillListResponse> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/skills`, {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as SkillListResponse;
}

export async function fetchSkillDetail(
  accessToken: string,
  id: string,
): Promise<SkillDetailResponse> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/skills/${id}`, {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as SkillDetailResponse;
}

export async function createSkill(
  accessToken: string,
  data: SkillCreateRequest,
): Promise<SkillDetailResponse> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/skills`, {
    method: "POST",
    headers: authJsonHeaders(accessToken),
    body: JSON.stringify(data),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as SkillDetailResponse;
}

export async function updateSkill(
  accessToken: string,
  id: string,
  data: SkillUpdateRequest,
): Promise<SkillDetailResponse> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/skills/${id}`, {
    method: "PUT",
    headers: authJsonHeaders(accessToken),
    body: JSON.stringify(data),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as SkillDetailResponse;
}

export async function deleteSkill(
  accessToken: string,
  id: string,
): Promise<void> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/skills/${id}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
  });
  if (!response.ok) return handleErrorResponse(response);
}

export async function fetchSkillFiles(
  accessToken: string,
  skillId: string,
): Promise<{
  files: Array<{
    id: string;
    filePath: string;
    content: string;
    mimeType: string;
    createdAt: string;
    updatedAt: string;
  }>;
}> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/skills/${skillId}/files`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as any;
}

// --- Workspace Skills API ---

export async function fetchWorkspaceSkills(
  accessToken: string,
): Promise<WorkspaceSkillListResponse> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/workspaces/skills`,
    {
      headers: authHeaders(accessToken),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as WorkspaceSkillListResponse;
}

export async function installSkill(
  accessToken: string,
  skillId: string,
): Promise<void> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/workspaces/skills`,
    {
      method: "POST",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify({ skillId }),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
}

export async function uninstallSkill(
  accessToken: string,
  skillId: string,
): Promise<void> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/workspaces/skills/${skillId}`,
    {
      method: "DELETE",
      headers: authHeaders(accessToken),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
}

export async function toggleSkill(
  accessToken: string,
  skillId: string,
  enabled: boolean,
): Promise<void> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/workspaces/skills/${skillId}`,
    {
      method: "PATCH",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify({ enabled }),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
}

// --- Marketplace API ---

export async function searchMarketplace(
  accessToken: string,
  query: string,
  page = 1,
  limit = 20,
): Promise<MarketplaceSearchResponse> {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    limit: String(limit),
  });
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/skills/marketplace/search?${params}`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as MarketplaceSearchResponse;
}

export async function getMarketplaceDetail(
  accessToken: string,
  packageName: string,
): Promise<MarketplaceDetail> {
  const params = new URLSearchParams({ name: packageName });
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/skills/marketplace/detail?${params}`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as MarketplaceDetail;
}

export async function installMarketplaceSkill(
  accessToken: string,
  packageName: string,
): Promise<SkillDetailResponse> {
  const response = await apiFetch(
    `${getServerBaseUrl()}/api/skills/marketplace/install`,
    {
      method: "POST",
      headers: authJsonHeaders(accessToken),
      body: JSON.stringify({ packageName }),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as SkillDetailResponse;
}

export async function fetchSkillVersions(accessToken: string, skillId: string) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/skills/${encodeURIComponent(skillId)}/versions`, { headers: authHeaders(accessToken) });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { currentVersion: string; versions: Array<{ id: string; version: string; sourceUrl: string | null; createdAt: string; fileCount: number; securityAudit: { risk: "low" | "medium" | "high"; scripts: number; capabilities: string[]; findings: string[] } }> };
}

export async function lockSkillVersion(accessToken: string, skillId: string, version: string | null) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/workspaces/skills/${encodeURIComponent(skillId)}/lock`, { method: "POST", headers: authJsonHeaders(accessToken), body: JSON.stringify({ version }) });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { lockedVersion: string | null; lockedAt: string | null };
}

export async function rollbackSkillVersion(accessToken: string, skillId: string, versionId: string) {
  const response = await apiFetch(`${getServerBaseUrl()}/api/workspaces/skills/${encodeURIComponent(skillId)}/rollback`, { method: "POST", headers: authJsonHeaders(accessToken), body: JSON.stringify({ versionId }) });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { restored: true; version: string };
}

export async function importSkillFromUrl(
  accessToken: string,
  url: string,
): Promise<SkillDetailResponse> {
  const response = await apiFetch(`${getServerBaseUrl()}/api/skills/import`, {
    method: "POST",
    headers: authJsonHeaders(accessToken),
    body: JSON.stringify({ url }),
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as SkillDetailResponse;
}
