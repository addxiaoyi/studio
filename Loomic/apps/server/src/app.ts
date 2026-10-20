import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import type { HelsteraAgentFactory } from "./agent/deep-agent.js";
import {
  createAgentPersistenceService,
  type AgentPersistenceService,
} from "./agent/persistence/index.js";
import { createAgentRunService } from "./agent/runtime.js";
import { registerAllProviders } from "./generation/providers/register-all.js";
import {
  createViewerService,
  type ViewerService,
} from "./features/bootstrap/ensure-user-foundation.js";
import {
  createCanvasService,
  type CanvasService,
} from "./features/canvas/canvas-service.js";
import {
  createBrandKitService,
  type BrandKitService,
} from "./features/brand-kit/brand-kit-service.js";
import {
  createProjectService,
  type ProjectService,
} from "./features/projects/project-service.js";
import {
  createChatService,
  type ChatService,
} from "./features/chat/chat-service.js";
import {
  createThreadService,
  type ThreadService,
} from "./features/chat/thread-service.js";
import {
  createAgentRunMetadataService,
  type AgentRunMetadataService,
} from "./features/agent-runs/agent-run-service.js";
import {
  createSettingsService,
  type SettingsService,
} from "./features/settings/settings-service.js";
import {
  createUploadService,
  type UploadService,
} from "./features/uploads/upload-service.js";
import {
  type ServerEnv,
  loadServerEnv,
  resolveDefaultAgentModel,
} from "./config/env.js";
import { createPgmqClient } from "./queue/pgmq-client.js";
import { createLocalJobQueue } from "./queue/local-job-queue.js";
import {
  createCreditService,
  type CreditService,
} from "./features/credits/credit-service.js";
import {
  createLocalCostGuard,
  createTierGuard,
  type TierGuard,
} from "./features/credits/tier-guard.js";
import {
  createJobService,
  type JobService,
} from "./features/jobs/job-service.js";
import { createLemonSqueezyClient } from "./features/payments/lemon-squeezy-client.js";
import {
  createPaymentService,
  buildVariantMap,
  type PaymentService,
} from "./features/payments/payment-service.js";
import { registerPaymentRoutes } from "./http/payments.js";
import { registerPaymentWebhookRoute } from "./http/payments-webhook.js";
import { registerContactSalesRoutes } from "./http/contact-sales.js";
import { registerLocalContactSalesRoutes } from "./http/local-contact-sales.js";
import { registerLocalEcomRoutes } from "./http/local-ecom-image.js";
import { registerLocalTeamRoutes } from "./http/local-team.js";
import { registerLocalGrowthRoutes, registerPublicGrowthRoutes } from "./http/local-growth.js";
import { registerOfficialModelPriceRoutes } from "./http/official-model-prices.js";
import { registerFeedOperationRoutes } from "./http/feed-operations.js";
import { configureFeedRenderQueue } from "./features/jobs/executors/feed-render.js";
import { registerEpayRoutes } from "./http/epay.js";
import { registerAlipayRoutes, registerUnavailableAlipayRoutes } from "./http/alipay.js";
import { registerLightPayRoutes } from "./http/lightpay.js";
import { createLightPayClient } from "./features/payments/lightpay-client.js";
import { registerCreditRoutes } from "./http/credits.js";
import { registerFontsRoutes } from "./http/fonts.js";
import { registerJobRoutes } from "./http/jobs.js";
import { registerGenerationApprovalRoutes } from "./http/generation-approvals.js";
import { createGenerationApprovalService } from "./features/generation/generation-approval-service.js";
import { registerBrandKitRoutes } from "./http/brand-kits.js";
import { registerCanvasRoutes } from "./http/canvases.js";
import { registerCanvasDecomposeRoutes } from "./http/canvas-decompose.js";
import { registerChatRoutes } from "./http/chat.js";
import { registerGenerateRoutes } from "./http/generate.js";
import { registerHealthRoutes } from "./http/health.js";
import { registerMetricsRoutes } from "./http/metrics.js";
import { registerErrorRoutes } from "./http/errors.js";
import { registerLocalAuthRoutes } from "./http/local-auth.js";
import { createLocalDbPool } from "./local-db/client.js";
import { createLocalRequestAuthenticator } from "./local-db/auth.js";
import { createLocalProjectService } from "./local-db/project-service.js";
import { createLocalStoryboardService } from "./local-db/storyboard-service.js";
import { createLocalViewerService } from "./local-db/viewer-service.js";
import { createLocalCanvasService } from "./local-db/canvas-service.js";
import { createLocalChatService } from "./local-db/chat-service.js";
import { createLocalUploadService } from "./local-db/upload-service.js";
import { createLocalCreditService } from "./local-db/credit-service.js";
import { createLocalThreadService } from "./local-db/thread-service.js";
import { createLocalSettingsService } from "./local-db/settings-service.js";
import { createLocalBrandKitService } from "./local-db/brand-kit-service.js";
import { createLocalAgentRunMetadataService } from "./local-db/agent-run-service.js";
import { createLocalJobService } from "./local-db/job-service.js";
import { registerLocalAssetRoutes } from "./http/local-assets.js";
import { registerAuthRoutes } from "./http/auth.js";
import { registerImageProxyRoute } from "./http/image-proxy.js";
import { registerModelRoutes } from "./http/models.js";
import { registerImageModelRoutes } from "./http/image-models.js";
import { registerVideoModelRoutes } from "./http/video-models.js";
import { registerProjectRoutes } from "./http/projects.js";
import { registerStoryboardRoutes } from "./http/storyboard.js";
import { registerRunRoutes } from "./http/runs.js";
import { registerAgentWorkflowRoutes } from "./http/agent-workflows.js";
import { registerSettingsRoutes } from "./http/settings.js";
import { registerAdminProviderRoutes } from "./http/admin-providers.js";
import { createProviderConfigService } from "./local-db/provider-config-service.js";
import { registerUploadRoutes } from "./http/uploads.js";
import { registerSkillRoutes } from "./http/skills.js";
import { registerLocalSkillRoutes } from "./http/local-skills.js";
import { registerMarketplaceRoutes } from "./http/skills-marketplace.js";
import { registerViewerRoutes } from "./http/viewer.js";
import { registerDouyinMcpRoutes } from "./http/douyin-mcp.js";
import { registerDouyinWebhookRoutes } from "./http/douyin-webhook.js";
import { registerDouyinOAuthRoutes } from "./http/douyin-oauth.js";
import { DouyinCredentialManager } from "./features/douyin/douyin-credentials.js";
import { registerStorageRoutes } from "./http/storage.js";
import { registerWebsiteCaptureRoutes } from "./http/website-capture.js";
import { CanvasEventBuffer } from "./ws/event-buffer.js";
import { ConnectionManager } from "./ws/connection-manager.js";
import { registerWsRoute } from "./ws/handler.js";
import {
  createStorageProvider,
  type StorageProvider,
} from "./storage/index.js";
import { cleanExpiredGeneratedAssets } from "./features/assets/asset-retention.js";
import type { RequestAuthenticator } from "./auth/types.js";

export type BuildAppOptions = {
  agentFactory?: HelsteraAgentFactory;
  agentModel?: BaseLanguageModel | string;
  agentPersistenceService?: AgentPersistenceService;
  agentRunMetadataService?: AgentRunMetadataService;
  auth?: RequestAuthenticator;
  brandKitService?: BrandKitService;
  canvasService?: CanvasService;
  chatService?: ChatService;
  connectionManager?: ConnectionManager;
  creditService?: CreditService;
  env?: Partial<ServerEnv>;
  jobService?: JobService;
  paymentService?: PaymentService;
  storageProvider?: StorageProvider;
  tierGuard?: TierGuard;
  uploadService?: UploadService;
  mockEventDelayMs?: number;
  projectService?: ProjectService;
  settingsService?: SettingsService;
  threadService?: ThreadService;
  viewerService?: ViewerService;
  autoSyncOfficialPrices?: boolean;
};

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const env = loadServerEnv({ ...options.env, authProvider: "local", storageProvider: "local" });
  if (!env.databaseUrl) throw new Error("DATABASE_URL is required; Supabase runtime support has been removed.");

  // Register generation providers (shared with worker.ts)
  registerAllProviders(env);

  const app = Fastify({
    logger: { level: "info" },
    bodyLimit: 50 * 1024 * 1024,
  });
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as any).rawBody = rawBody;
    try {
      done(null, JSON.parse(rawBody));
    } catch (error) {
      done(error as Error, undefined);
    }
  });
  void app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024 },
  });
  void app.register(async (instance) => {
    await instance.register(websocket);
    await registerWsRoute(instance, {
      agentRuns,
      agentRunMetadataService,
      auth,
      chatService,
      creditService,
      connectionManager,
      eventBuffer,
      settingsService,
      threadService,
      viewerService,
    });
  });
  const localDb = createLocalDbPool(env.databaseUrl);
  {
    void localDb.query(
      `update agent_runs
       set status = 'failed', completed_at = now(), error_code = 'stale_run',
           error_message = '生成任务因服务重启中断，请重新提交'
       where status in ('accepted', 'running')
         and created_at < now() - interval '15 minutes'`,
    ).catch((error) => {
      console.error('[agent-runs] stale-run recovery failed:', error);
    });
  }
  const auth = options.auth ?? createLocalRequestAuthenticator(localDb);
  const viewerService = options.viewerService ?? createLocalViewerService(localDb, env.systemAdminEmails);
  console.log(
    "[auth] provider=local database=postgres",
  );

  // Storage provider setup
  const storageProvider = options.storageProvider ?? createStorageProvider({
    provider: "local",
    root: env.storageRoot ?? "/www/helstera/uploads",
    baseUrl: env.webOrigin,
  });
  console.log(
    `[storage] provider=local root=${env.storageRoot ?? "/www/helstera/uploads"}`,
  );

  const projectService =
    options.projectService ??
    createLocalProjectService(localDb, env.storageRoot ?? "/www/helstera/uploads");
  const brandKitService = options.brandKitService ?? createLocalBrandKitService(localDb, storageProvider);
  const canvasService = options.canvasService ?? createLocalCanvasService(localDb);
  const threadService = options.threadService ?? createLocalThreadService(localDb);
  const chatService = options.chatService ?? createLocalChatService(localDb);
  const agentRunMetadataService = options.agentRunMetadataService ?? createLocalAgentRunMetadataService(localDb);
  const agentPersistenceService =
    options.agentPersistenceService ?? createAgentPersistenceService(env);
  const settingsService = options.settingsService ?? createLocalSettingsService(localDb);
  const uploadService = options.uploadService ?? createLocalUploadService(localDb);
  const feedDb = localDb;
  configureFeedRenderQueue("local");
  const jobService = options.jobService ?? createLocalJobService(localDb, createLocalJobQueue(localDb));
  const creditService = options.creditService ?? createLocalCreditService(localDb);
  const tierGuard = options.tierGuard ?? createLocalCostGuard(localDb);

  // Payment service — only created when Lemon Squeezy is configured
  const paymentService = options.paymentService;

  const connectionManager =
    options.connectionManager ?? new ConnectionManager();
  const eventBuffer = new CanvasEventBuffer();
  setInterval(() => eventBuffer.cleanup(), 5 * 60 * 1000);
  if (localDb) {
    let isAssetRetentionRunning = false;
    const runAssetRetention = async () => {
      if (isAssetRetentionRunning) return;
      isAssetRetentionRunning = true;
      try {
        await cleanExpiredGeneratedAssets({ db: localDb, storage: storageProvider });
      } catch (error) {
        console.error("[asset-retention] cleanup failed:", error);
      } finally {
        isAssetRetentionRunning = false;
      }
    };
    void runAssetRetention();
    setInterval(() => void runAssetRetention(), 24 * 60 * 60 * 1000);
  }
  const agentRuns = createAgentRunService({
    agentPersistenceService,
    ...(options.agentFactory ? { agentFactory: options.agentFactory } : {}),
    agentRunMetadataService,
    connectionManager,
    ...(options.agentModel ? { model: options.agentModel } : {}),
    ...(options.mockEventDelayMs === undefined
      ? {}
      : { eventDelayMs: options.mockEventDelayMs }),
    env,
    ...(localDb ? { localDb } : {}),
    ...(localDb ? { generationApprovalService: createGenerationApprovalService(localDb) } : {}),
    ...(jobService ? { jobService } : {}),
    creditService,
    tierGuard,
    viewerService,
    storage: storageProvider,
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "strict-origin-when-cross-origin");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    if (env.webOrigin.startsWith("https://")) {
      reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    }

    const corsResult = evaluateCors(request, env.webOrigin);

    if (!corsResult.allowed) {
      return reply.code(403).send({
        message: "Origin not allowed",
      });
    }

    if (corsResult.allowOrigin) {
      reply.header("access-control-allow-origin", corsResult.allowOrigin);
      reply.header("vary", "Origin");
    }

    if (corsResult.allowCredentials) {
      reply.header("access-control-allow-credentials", "true");
    }

    if (corsResult.isBrowserRequest) {
      reply.header(
        "access-control-allow-methods",
        "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      );
      reply.header(
        "access-control-allow-headers",
        resolveAllowedHeaders(
          request.headers["access-control-request-headers"],
        ),
      );
    }

    if (corsResult.isPreflight) {
      return reply.code(204).send();
    }
  });

  void registerHealthRoutes(app, env);
  void registerMetricsRoutes(app);
  void registerErrorRoutes(app);
  void registerLocalAuthRoutes(app, { db: localDb, env });
  void registerLocalAssetRoutes(app, { db: localDb, auth, root: env.storageRoot ?? "/www/helstera/uploads" });
  void registerLocalEcomRoutes(app, { db: localDb, auth, creditService });
  void registerLocalTeamRoutes(app, { db: localDb, auth, viewerService });
  void registerLocalGrowthRoutes(app, { db: localDb, auth, viewerService });
  registerOfficialModelPriceRoutes(app, {
    db: localDb,
    autoSync: options.autoSyncOfficialPrices ?? false,
    auth,
    viewerService,
  });
  if (feedDb) {
    registerFeedOperationRoutes(app, { db: feedDb, auth, viewerService, storage: storageProvider });
    if (feedDb !== localDb) {
      app.addHook("onClose", async () => {
        await feedDb.end();
      });
    }
  } else {
    console.warn("[feed] disabled: DATABASE_URL is not configured");
  }
  if (localDb && env.epayBaseUrl && env.epayMerchantId && env.epayMd5Key) {
    void registerEpayRoutes(app, {
      auth,
      creditService,
      viewerService,
      baseUrl: env.epayBaseUrl,
      merchantId: env.epayMerchantId,
      md5Key: env.epayMd5Key,
      notifyUrl: `${env.webOrigin}/api/epay/notify`,
    });
  }
  if (localDb && env.lightpayBaseUrl && env.lightpayApiId && env.lightpayApiSecret) {
    void app.register(async (lightpayScope) => {
      lightpayScope.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => done(null, body));
      registerLightPayRoutes(lightpayScope, {
        auth,
        creditService,
        viewerService,
        client: createLightPayClient({ baseUrl: env.lightpayBaseUrl!, apiId: env.lightpayApiId!, apiSecret: env.lightpayApiSecret! }),
      });
    });
  }
  if (env.alipayAppId && env.alipayAppPrivateKeyPath && env.alipayPlatformPublicKeyPath) {
    try {
      registerAlipayRoutes(app, {
        appId: env.alipayAppId,
        appPrivateKeyPath: env.alipayAppPrivateKeyPath,
        auth,
        creditService,
        notifyUrl: `${env.webOrigin}/api/payment/alipay/notify`,
        platformPublicKeyPath: env.alipayPlatformPublicKeyPath,
        viewerService,
        webOrigin: env.webOrigin,
      });
    } catch (error) {
      console.error("[alipay] disabled: could not load certificate files", error);
      registerUnavailableAlipayRoutes(app);
    }
  } else {
    registerUnavailableAlipayRoutes(app);
  }
  void registerFontsRoutes(app, { env });
  void registerImageProxyRoute(app);
  void registerRunRoutes(app, agentRuns, {
    agentRunMetadataService,
    auth,
    creditService,
    settingsService,
    threadService,
    viewerService,
  });
  registerAgentWorkflowRoutes(app, {
    db: localDb,
    auth,
    viewerService,
    jobService,
    creditService,
    tierGuard,
  });
  void registerViewerRoutes(app, { auth, creditService, viewerService, localDb });
  const douyinCredentials = DouyinCredentialManager.fromEnv(env);
  douyinCredentials.start();
  app.addHook("onClose", async () => douyinCredentials.stop());
  registerDouyinMcpRoutes(app, { auth, db: localDb, env, viewerService, credentials: douyinCredentials });
  registerDouyinWebhookRoutes(app, { db: localDb, env });
  registerDouyinOAuthRoutes(app, { auth, db: localDb, env, viewerService });
  void registerBrandKitRoutes(app, {
    auth,
    brandKitService,
  });
  void registerProjectRoutes(app, {
    auth,
    projectService,
  });
  if (localDb) {
    void registerStoryboardRoutes(app, {
      auth,
      service: createLocalStoryboardService(localDb),
    });
  }
  void registerCanvasRoutes(app, {
    auth,
    canvasService,
  });
  void registerCanvasDecomposeRoutes(app, { auth });
  void registerSettingsRoutes(app, {
    auth,
    settingsService,
    viewerService,
  });
  void registerModelRoutes(app, env);
  void registerImageModelRoutes(app, {
    auth,
    creditService,
    viewerService,
    ...(localDb ? { localDb } : {}),
  });
  void registerVideoModelRoutes(app, {
    auth,
    creditService,
    viewerService,
    ...(localDb ? { localDb } : {}),
  });
  void registerChatRoutes(app, {
    auth,
    chatService,
  });
  void registerUploadRoutes(app, {
    auth,
    uploadService,
    viewerService,
  });
  void registerGenerateRoutes(app, {
    auth,
    creditService,
    uploadService,
    viewerService,
    ...(jobService ? { jobService } : {}),
    ...(tierGuard ? { tierGuard } : {}),
    ...(localDb ? { localDb } : {}),
  });
  void registerCreditRoutes(app, {
    auth,
    creditService,
    ...(paymentService ? { paymentService } : {}),
    viewerService,
  });
  if (jobService) {
    void registerJobRoutes(app, {
      auth,
      creditService,
      jobService,
      tierGuard,
      viewerService,
      ...(localDb ? { localDb } : {}),
      storage: storageProvider,
    });
  }
  registerWebsiteCaptureRoutes(app, {
    auth,
    db: localDb,
    jobService,
    viewerService,
  });
  if (localDb) {
    registerGenerationApprovalRoutes(app, {
      auth,
      db: localDb,
      viewerService,
      ...(jobService ? { jobService } : {}),
      creditService,
    });
  }

  // Storage routes - serve local files when using local storage provider
  void registerStorageRoutes(app, { storageProvider, ...(env.storageRoot ? { storageRoot: env.storageRoot } : {}) });

  void registerLocalSkillRoutes(app, { auth, db: localDb, viewerService });
  const encryptionKey = process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
  if (encryptionKey) {
    void registerAdminProviderRoutes(app, {
      auth,
      db: localDb,
      viewerService,
      service: createProviderConfigService(localDb, encryptionKey),
    });
  } else {
    console.warn("[admin-providers] disabled: PROVIDER_CONFIG_ENCRYPTION_KEY is not configured");
  }
  void registerMarketplaceRoutes(app, {
    auth,
    viewerService,
    localDb,
  });

  // Contact sales — public endpoint, no auth required
  void registerLocalContactSalesRoutes(app, { db: localDb });

  // Supabase-backed ecommerce routes are disabled in local-only mode.

  // Payment routes — only registered when Lemon Squeezy is configured
  // Supabase-backed payment routes are disabled in local-only mode.


  return app;
}

type CorsResult = {
  allowed: boolean;
  allowOrigin: string | null;
  allowCredentials: boolean;
  isBrowserRequest: boolean;
  isPreflight: boolean;
};

export function evaluateCors(request: FastifyRequest, webOrigin: string): CorsResult {
  const origin = request.headers.origin;
  const isPreflight =
    request.method === "OPTIONS" &&
    typeof request.headers["access-control-request-method"] === "string";

  if (!origin) {
    return {
      allowed: true,
      allowOrigin: null,
      allowCredentials: false,
      isBrowserRequest: false,
      isPreflight,
    };
  }

  const forwardedProto = firstHeaderValue(request.headers["x-forwarded-proto"]);
  const forwardedHost = firstHeaderValue(request.headers["x-forwarded-host"]);
  const requestHost = forwardedHost ?? request.headers.host;
  const requestOrigin =
    forwardedProto && requestHost ? `${forwardedProto}://${requestHost}` : null;

  if (origin === webOrigin || origin === requestOrigin) {
    return {
      allowed: true,
      allowOrigin: origin,
      allowCredentials: true,
      isBrowserRequest: true,
      isPreflight,
    };
  }

  if (origin === "null" && isLoopbackHost(request.headers.host)) {
    return {
      allowed: true,
      allowOrigin: origin,
      allowCredentials: true,
      isBrowserRequest: true,
      isPreflight,
    };
  }

  return {
    allowed: false,
    allowOrigin: null,
    allowCredentials: false,
    isBrowserRequest: true,
    isPreflight,
  };
}

function firstHeaderValue(value: string | string[] | undefined) {
  const first = Array.isArray(value) ? value[0] : value?.split(",", 1)[0];
  return first?.trim().toLowerCase() || null;
}

function resolveAllowedHeaders(requestHeaders: string | undefined) {
  return requestHeaders?.trim() || "Content-Type";
}

function isLoopbackHost(host: string | undefined) {
  if (!host) {
    return false;
  }

  if (host.startsWith("[")) {
    return host.startsWith("[::1]");
  }

  const [hostname] = host.split(":");
  return (
    hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1"
  );
}
