import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import type { HelsteraAgentFactory } from "./agent/deep-agent.js";
import {
  type AgentPersistenceService,
  createAgentPersistenceService,
} from "./agent/persistence/index.js";
import { createAgentRunService } from "./agent/runtime.js";
import type { RequestAuthenticator } from "./auth/types.js";
import {
  type ServerEnv,
  loadServerEnv,
  resolveDefaultAgentModel,
} from "./config/env.js";
import { createBackgroundGoalExecutor } from "./features/agent-goals/agent-goal-background.js";
import { AgentGoalEventPublisher } from "./features/agent-goals/agent-goal-events.js";
import { AgentGoalWorker } from "./features/agent-goals/agent-goal-worker.js";
import { createGoalStepExecutor } from "./features/agent-goals/goal-step-executors.js";
import { GoalStepWorker } from "./features/agent-goals/goal-step-worker.js";
import {
  type AgentRunMetadataService,
  createAgentRunMetadataService,
} from "./features/agent-runs/agent-run-service.js";
import { cleanExpiredGeneratedAssets } from "./features/assets/asset-retention.js";
import {
  type ViewerService,
  createViewerService,
} from "./features/bootstrap/ensure-user-foundation.js";
import {
  type BrandKitService,
  createBrandKitService,
} from "./features/brand-kit/brand-kit-service.js";
import { createWorkflowAuthor } from "./features/canvas-workflows/author.js";
import { guardWorkflowExecution } from "./features/canvas-workflows/execution-access.js";
import {
  type CanvasService,
  createCanvasService,
} from "./features/canvas/canvas-service.js";
import {
  type ChatService,
  createChatService,
} from "./features/chat/chat-service.js";
import {
  type ThreadService,
  createThreadService,
} from "./features/chat/thread-service.js";
import {
  type CreditService,
  createCreditService,
} from "./features/credits/credit-service.js";
import {
  type TierGuard,
  createLocalCostGuard,
  createTierGuard,
} from "./features/credits/tier-guard.js";
import { DouyinCredentialManager } from "./features/douyin/douyin-credentials.js";
import { createGenerationApprovalService } from "./features/generation/generation-approval-service.js";
import { configureFeedRenderQueue } from "./features/jobs/executors/feed-render.js";
import { purgeExpiredJobPayloads } from "./features/jobs/job-retention.js";
import {
  type JobService,
  createJobService,
} from "./features/jobs/job-service.js";
import { createLemonSqueezyClient } from "./features/payments/lemon-squeezy-client.js";
import { createLightPayClient } from "./features/payments/lightpay-client.js";
import {
  type PaymentService,
  buildVariantMap,
  createPaymentService,
} from "./features/payments/payment-service.js";
import {
  type ProjectService,
  createProjectService,
} from "./features/projects/project-service.js";
import {
  type SettingsService,
  createSettingsService,
} from "./features/settings/settings-service.js";
import {
  type UploadService,
  createUploadService,
} from "./features/uploads/upload-service.js";
import { createEditorPlanStore } from "./features/video-editor/plan-store.js";
import {
  WebsiteAssistantHub,
  registerWebsiteAssistantWsRoute,
} from "./features/website-capture/assistant-hub.js";
import { registerAllProviders } from "./generation/providers/register-all.js";
import { registerAdminProviderRoutes } from "./http/admin-providers.js";
import { registerAgentBrowserRoutes } from "./http/agent-browser.js";
import { registerAgentConnectorRoutes } from "./http/agent-connectors.js";
import { registerAgentGoalRoutes } from "./http/agent-goals.js";
import { registerAgentMarketplaceRoutes } from "./http/agent-marketplace.js";
import { registerAgentMemoryRoutes } from "./http/agent-memory.js";
import { registerAgentWorkflowRoutes } from "./http/agent-workflows.js";
import {
  registerAlipayRoutes,
  registerUnavailableAlipayRoutes,
} from "./http/alipay.js";
import { registerAuthRoutes } from "./http/auth.js";
import { registerBrandKitRoutes } from "./http/brand-kits.js";
import { registerCanvasDecomposeRoutes } from "./http/canvas-decompose.js";
import { registerCanvasWorkflowRoutes } from "./http/canvas-workflows.js";
import { registerCanvasRoutes } from "./http/canvases.js";
import { registerChatRoutes } from "./http/chat.js";
import { registerContactSalesRoutes } from "./http/contact-sales.js";
import { registerCreditRoutes } from "./http/credits.js";
import { registerDouyinMcpRoutes } from "./http/douyin-mcp.js";
import { registerDouyinOAuthRoutes } from "./http/douyin-oauth.js";
import { registerDouyinWebhookRoutes } from "./http/douyin-webhook.js";
import { registerEpayRoutes } from "./http/epay.js";
import { registerErrorRoutes } from "./http/errors.js";
import { registerFeedOperationRoutes } from "./http/feed-operations.js";
import { registerFontsRoutes } from "./http/fonts.js";
import { registerGalleryMediaRoutes } from "./http/gallery-media.js";
import { registerGenerateRoutes } from "./http/generate.js";
import { registerGenerationApprovalRoutes } from "./http/generation-approvals.js";
import { registerHealthRoutes } from "./http/health.js";
import { registerImageModelRoutes } from "./http/image-models.js";
import { registerImageProxyRoute } from "./http/image-proxy.js";
import { registerJobRoutes } from "./http/jobs.js";
import { registerLightPayRoutes } from "./http/lightpay.js";
import { registerLocalAssetRoutes } from "./http/local-assets.js";
import { registerLocalAuthRoutes } from "./http/local-auth.js";
import { registerLocalContactSalesRoutes } from "./http/local-contact-sales.js";
import { registerLocalEcomRoutes } from "./http/local-ecom-image.js";
import {
  registerLocalGrowthRoutes,
  registerPublicGrowthRoutes,
} from "./http/local-growth.js";
import { registerLocalSkillRoutes } from "./http/local-skills.js";
import { registerLocalTeamRoutes } from "./http/local-team.js";
import { registerMetricsRoutes } from "./http/metrics.js";
import { registerModelRoutes } from "./http/models.js";
import { registerOfficialModelPriceRoutes } from "./http/official-model-prices.js";
import { registerOneTakeRoutes } from "./http/onetake.js";
import { registerPaymentWebhookRoute } from "./http/payments-webhook.js";
import { registerPaymentRoutes } from "./http/payments.js";
import { registerPrivateVideoRoutes } from "./http/private-video.js";
import { registerProjectBackupRoutes } from "./http/project-backups.js";
import { registerProjectContextRoutes } from "./http/project-context.js";
import { registerProjectVideoRoutes } from "./http/project-video-document.js";
import { registerProjectRoutes } from "./http/projects.js";
import { registerPublicMediaRoutes } from "./http/public-media.js";
import { registerRunRoutes } from "./http/runs.js";
import { registerSettingsRoutes } from "./http/settings.js";
import { registerMarketplaceRoutes } from "./http/skills-marketplace.js";
import { registerSkillRoutes } from "./http/skills.js";
import { registerStorageRoutes } from "./http/storage.js";
import { registerStoryboardRoutes } from "./http/storyboard.js";
import { registerUploadRoutes } from "./http/uploads.js";
import { registerVideoEditorRoutes } from "./http/video-editor.js";
import { registerVideoModelRoutes } from "./http/video-models.js";
import { registerVideoUploadRoutes } from "./http/video-upload.js";
import { registerViewerRoutes } from "./http/viewer.js";
import { registerWebsiteCaptureRoutes } from "./http/website-capture.js";
import {
  createLocalAgentRunMetadataService,
  recoverExpiredAgentRuns,
} from "./local-db/agent-run-service.js";
import { createLocalRequestAuthenticator } from "./local-db/auth.js";
import { createLocalBrandKitService } from "./local-db/brand-kit-service.js";
import { createLocalCanvasService } from "./local-db/canvas-service.js";
import { createLocalChatService } from "./local-db/chat-service.js";
import { createLocalDbPool } from "./local-db/client.js";
import { createLocalCreditService } from "./local-db/credit-service.js";
import { createLocalJobService } from "./local-db/job-service.js";
import { createLocalProjectService } from "./local-db/project-service.js";
import { createProviderConfigService } from "./local-db/provider-config-service.js";
import { createLocalSettingsService } from "./local-db/settings-service.js";
import { createLocalStoryboardService } from "./local-db/storyboard-service.js";
import { createLocalThreadService } from "./local-db/thread-service.js";
import { createLocalUploadService } from "./local-db/upload-service.js";
import { createLocalViewerService } from "./local-db/viewer-service.js";
import { createLocalJobQueue } from "./queue/local-job-queue.js";
import { createPgmqClient } from "./queue/pgmq-client.js";
import { DrainGate } from "./runtime/drain-gate.js";
import { ServiceLifecycle, drainInOrder } from "./runtime/lifecycle.js";
import { PeriodicTasks } from "./runtime/periodic-tasks.js";
import { probeWritableStorage } from "./runtime/storage-probe.js";
import {
  type StorageProvider,
  createStorageProvider,
} from "./storage/index.js";
import { loadPublicMedia } from "./storage/public-media.js";
import { ConnectionManager } from "./ws/connection-manager.js";
import { CanvasEventBuffer } from "./ws/event-buffer.js";
import { registerWsRoute } from "./ws/handler.js";

export type BuildAppOptions = {
  lifecycle?: ServiceLifecycle;
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
  const env = loadServerEnv({
    ...options.env,
    authProvider: "local",
    storageProvider: "local",
  });
  const lifecycle = options.lifecycle ?? new ServiceLifecycle();
  const wsCommands = new DrainGate();
  const storageRoot = env.storageRoot ?? "/www/helstera/uploads";
  if (!env.databaseUrl)
    throw new Error(
      "DATABASE_URL is required; Supabase runtime support has been removed.",
    );

  // Register generation providers (shared with worker.ts)
  registerAllProviders(env);

  const app = Fastify({
    logger: { level: "info" },
    bodyLimit: 50 * 1024 * 1024,
  });
  app.addHook("onRequest", async (request, reply) => {
    if (lifecycle.draining && !request.url.startsWith("/api/health"))
      return reply
        .header("Retry-After", "2")
        .code(503)
        .send({
          ok: false,
          error: {
            code: "service_draining",
            message: "服务正在切换，请稍后重试。",
            retryable: true,
          },
        });
  });
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (request, body, done) => {
      const rawBody = typeof body === "string" ? body : body.toString("utf8");
      request.rawBody = rawBody;
      try {
        done(null, JSON.parse(rawBody));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );
  void app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024 },
  });
  const localDb = createLocalDbPool(env.databaseUrl);
  const auth = options.auth ?? createLocalRequestAuthenticator(localDb);
  const viewerService =
    options.viewerService ??
    createLocalViewerService(localDb, env.systemAdminEmails);
  console.log("[auth] provider=local database=postgres");

  // Storage provider setup
  const storageProvider =
    options.storageProvider ??
    createStorageProvider({
      provider: "local",
      root: env.storageRoot ?? "/www/helstera/uploads",
      baseUrl: env.webOrigin,
    });
  console.log(
    `[storage] provider=local root=${env.storageRoot ?? "/www/helstera/uploads"}`,
  );

  const projectService =
    options.projectService ??
    createLocalProjectService(
      localDb,
      env.storageRoot ?? "/www/helstera/uploads",
    );
  const brandKitService =
    options.brandKitService ??
    createLocalBrandKitService(localDb, storageProvider);
  const canvasService =
    options.canvasService ?? createLocalCanvasService(localDb);
  const threadService =
    options.threadService ?? createLocalThreadService(localDb);
  const chatService = options.chatService ?? createLocalChatService(localDb);
  const agentRunMetadataService =
    options.agentRunMetadataService ??
    createLocalAgentRunMetadataService(localDb, {
      onLeaseLost: (runId) => {
        agentRuns.cancelRun(runId);
      },
    });
  const agentPersistenceService =
    options.agentPersistenceService ?? createAgentPersistenceService(env);
  const settingsService =
    options.settingsService ?? createLocalSettingsService(localDb);
  const uploadService =
    options.uploadService ??
    createLocalUploadService(
      localDb,
      env.storageRoot ?? "/www/helstera/uploads",
    );
  const feedDb = localDb;
  configureFeedRenderQueue("local");
  const jobService =
    options.jobService ??
    createLocalJobService(localDb, createLocalJobQueue(localDb));
  const creditService =
    options.creditService ?? createLocalCreditService(localDb);
  const tierGuard = options.tierGuard ?? createLocalCostGuard(localDb);

  // Payment service — only created when Lemon Squeezy is configured
  const paymentService = options.paymentService;

  const connectionManager =
    options.connectionManager ?? new ConnectionManager();
  const websiteAssistantHub = new WebsiteAssistantHub({
    db: localDb,
    storage: storageProvider,
    storageRoot: env.storageRoot ?? "/www/helstera/uploads",
    webOrigin: env.webOrigin,
  });
  const eventBuffer = new CanvasEventBuffer();
  const maintenance = new PeriodicTasks((name, error) =>
    app.log.error({ err: error, task: name }, "Maintenance task failed"),
  );
  maintenance.every(
    "event-buffer",
    5 * 60 * 1000,
    async () => eventBuffer.cleanup(),
    false,
  );
  maintenance.every("agent-run-recovery", 10_000, () =>
    recoverExpiredAgentRuns(localDb),
  );
  const agentGoalWorker = new AgentGoalWorker(
    localDb,
    websiteAssistantHub,
    1_000,
    createBackgroundGoalExecutor({
      db: localDb,
      storage: storageProvider,
      storageRoot: env.storageRoot ?? "/www/helstera/uploads",
      webOrigin: env.webOrigin,
    }),
  );
  const agentGoalEvents = new AgentGoalEventPublisher(
    localDb,
    connectionManager,
    eventBuffer,
  );
  const goalSteps = new GoalStepWorker(
    localDb,
    guardWorkflowExecution(
      localDb,
      createGoalStepExecutor({
        db: localDb,
        storage: storageProvider,
        storageRoot: env.storageRoot ?? "/www/helstera/uploads",
        webOrigin: env.webOrigin,
        desktop: websiteAssistantHub,
        author: createWorkflowAuthor(env, settingsService),
      }),
    ),
  );
  if (process.env.NODE_ENV !== "test") {
    agentGoalWorker.start();
    agentGoalEvents.start();
    if (process.env.HELSTERA_GOAL_STEPS === "1") goalSteps.start();
  }
  if (localDb) {
    let isAssetRetentionRunning = false;
    const runAssetRetention = async () => {
      if (isAssetRetentionRunning) return;
      isAssetRetentionRunning = true;
      try {
        await cleanExpiredGeneratedAssets({
          db: localDb,
          storage: storageProvider,
        });
      } catch (error) {
        console.error("[asset-retention] cleanup failed:", error);
      } finally {
        isAssetRetentionRunning = false;
      }
    };
    let isJobRetentionRunning = false;
    const runJobRetention = async () => {
      if (isJobRetentionRunning) return;
      isJobRetentionRunning = true;
      try {
        await purgeExpiredJobPayloads({ db: localDb });
      } catch (error) {
        console.error("[job-retention] cleanup failed:", error);
      } finally {
        isJobRetentionRunning = false;
      }
    };
    maintenance.every("job-retention", 6 * 60 * 60 * 1000, runJobRetention);
    maintenance.every("asset-retention", 60 * 60 * 1000, runAssetRetention);
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
    ...(localDb
      ? { generationApprovalService: createGenerationApprovalService(localDb) }
      : {}),
    ...(jobService ? { jobService } : {}),
    creditService,
    tierGuard,
    viewerService,
    storage: storageProvider,
    desktopAgentHub: websiteAssistantHub,
  });

  lifecycle.onDrain(async () => {
    const commandsDrained = wsCommands.drain();
    await drainInOrder([
      [
        () => agentGoalWorker.stop(),
        () => goalSteps.stop(),
        () => agentRuns.drain(),
        () => commandsDrained,
        () => maintenance.stop(),
      ],
      [() => websiteAssistantHub.drain()],
      [() => agentGoalEvents.stop()],
      [() => connectionManager.drain()],
      [() => eventBuffer.dispose()],
    ]);
  });
  app.addHook("preClose", async () => lifecycle.drain());

  void app.register(async (instance) => {
    await instance.register(websocket);
    await registerWsRoute(instance, {
      commandGate: wsCommands,
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
    await registerWebsiteAssistantWsRoute(instance, websiteAssistantHub);
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    reply.header(
      "access-control-expose-headers",
      "x-request-id,retry-after,content-range",
    );
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "strict-origin-when-cross-origin");
    reply.header(
      "permissions-policy",
      "camera=(), microphone=(), geolocation=()",
    );
    if (env.webOrigin.startsWith("https://")) {
      reply.header(
        "strict-transport-security",
        "max-age=31536000; includeSubDomains",
      );
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

  const publicMedia = loadPublicMedia();
  void registerHealthRoutes(app, env, {
    database: () =>
      localDb.query("select 1 from media_resource_leases limit 0"),
    storage: () => probeWritableStorage(storageRoot),
    ...(publicMedia?.probe ? { publicMedia: publicMedia.probe } : {}),
    draining: () => lifecycle.draining,
  });
  void registerMetricsRoutes(app);
  void registerErrorRoutes(app);
  void registerLocalAuthRoutes(app, { db: localDb, env });
  void registerLocalAssetRoutes(app, {
    db: localDb,
    auth,
    root: env.storageRoot ?? "/www/helstera/uploads",
  });
  void registerLocalEcomRoutes(app, { db: localDb, auth, creditService });
  void registerLocalTeamRoutes(app, { db: localDb, auth, viewerService });
  void registerLocalGrowthRoutes(app, { db: localDb, auth, viewerService });
  registerGalleryMediaRoutes(app, { db: localDb, root: env.storageRoot ?? "" });
  registerOfficialModelPriceRoutes(app, {
    db: localDb,
    autoSync: options.autoSyncOfficialPrices ?? false,
    auth,
    viewerService,
  });
  if (feedDb) {
    registerFeedOperationRoutes(app, {
      db: feedDb,
      auth,
      viewerService,
      storage: storageProvider,
    });
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
  const lightpayConfig =
    env.lightpayBaseUrl && env.lightpayApiId && env.lightpayApiSecret
      ? {
          baseUrl: env.lightpayBaseUrl,
          apiId: env.lightpayApiId,
          apiSecret: env.lightpayApiSecret,
        }
      : undefined;
  if (localDb && lightpayConfig) {
    void app.register(async (lightpayScope) => {
      lightpayScope.addContentTypeParser(
        "application/json",
        { parseAs: "string" },
        (_request, body, done) => done(null, body),
      );
      registerLightPayRoutes(lightpayScope, {
        auth,
        creditService,
        viewerService,
        client: createLightPayClient({
          ...lightpayConfig,
        }),
      });
    });
  }
  if (
    env.alipayAppId &&
    env.alipayAppPrivateKeyPath &&
    env.alipayPlatformPublicKeyPath
  ) {
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
      console.error(
        "[alipay] disabled: could not load certificate files",
        error,
      );
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
  registerVideoEditorRoutes(app, {
    auth,
    env,
    settingsService,
    viewerService,
    browserDb: localDb,
    planStore: createEditorPlanStore(localDb),
  });
  registerOneTakeRoutes(app, {
    auth,
    viewerService,
    db: localDb,
    storage: storageProvider,
    storageRoot: env.storageRoot ?? "/www/helstera/uploads",
  });
  registerAgentWorkflowRoutes(app, {
    db: localDb,
    auth,
    viewerService,
    jobService,
    creditService,
    tierGuard,
  });
  void registerViewerRoutes(app, {
    auth,
    creditService,
    viewerService,
    localDb,
  });
  const douyinCredentials = DouyinCredentialManager.fromEnv(env);
  douyinCredentials.start();
  app.addHook("onClose", async () => douyinCredentials.stop());
  registerDouyinMcpRoutes(app, {
    auth,
    db: localDb,
    env,
    viewerService,
    credentials: douyinCredentials,
  });
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
    registerProjectBackupRoutes(app, { db: localDb, auth, viewerService });
    registerProjectContextRoutes(app, { db: localDb, auth });
    registerProjectVideoRoutes(app, { db: localDb, auth });
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
  registerPrivateVideoRoutes(app, {
    auth,
    viewerService,
    db: localDb,
    storage: storageProvider,
  });
  void registerVideoUploadRoutes(app, {
    auth,
    viewerService,
    db: localDb,
    storage: storageProvider,
    root: env.storageRoot ?? "/www/helstera/uploads",
  });
  registerPublicMediaRoutes(app, publicMedia);
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
  registerAgentBrowserRoutes(app, {
    db: localDb,
    auth,
    viewerService,
    storageRoot: env.storageRoot ?? "/www/helstera/uploads",
    enabled: process.env.HELSTERA_BROWSER_VIEW_ENABLED === "1",
  });
  registerWebsiteCaptureRoutes(app, {
    auth,
    db: localDb,
    storage: storageProvider,
    jobService,
    viewerService,
    assistantHub: websiteAssistantHub,
    generationApprovalService: createGenerationApprovalService(localDb),
    creditService,
    tierGuard,
  });
  registerAgentGoalRoutes(app, {
    env,
    settingsService,
    auth,
    db: localDb,
    viewerService,
    assistantHub: websiteAssistantHub,
  });
  registerCanvasWorkflowRoutes(app, {
    db: localDb,
    auth,
    env,
    settingsService,
    storage: storageProvider,
  });
  registerAgentMemoryRoutes(app, {
    auth,
    db: localDb,
    viewerService,
  });
  registerAgentConnectorRoutes(app, {
    auth,
    db: localDb,
    viewerService,
    assistantHub: websiteAssistantHub,
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
  void registerStorageRoutes(app, {
    storageProvider,
    ...(env.storageRoot ? { storageRoot: env.storageRoot } : {}),
  });

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
    console.warn(
      "[admin-providers] disabled: PROVIDER_CONFIG_ENCRYPTION_KEY is not configured",
    );
  }
  void registerMarketplaceRoutes(app, {
    auth,
    viewerService,
    localDb,
  });
  void registerAgentMarketplaceRoutes(app, {
    auth,
    db: localDb,
    viewerService,
  });

  // Contact sales — public endpoint, no auth required
  void registerLocalContactSalesRoutes(app, { db: localDb });

  // Supabase-backed ecommerce routes are disabled in local-only mode.

  // Payment routes — only registered when Lemon Squeezy is configured
  // Supabase-backed payment routes are disabled in local-only mode.

  app.addHook("onClose", async () => {
    await agentPersistenceService.close?.();
    await agentRunMetadataService.close?.();
    await localDb.end();
  });
  return app;
}

type CorsResult = {
  allowed: boolean;
  allowOrigin: string | null;
  allowCredentials: boolean;
  isBrowserRequest: boolean;
  isPreflight: boolean;
};

export function evaluateCors(
  request: FastifyRequest,
  webOrigin: string,
): CorsResult {
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
