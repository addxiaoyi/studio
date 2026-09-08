// @ecom-image — E-commerce image generation service
// Orchestrates the 25 scene templates, prompt builder, and image provider.
// Persists jobs to ecom_jobs table; client polls for status.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildHeroPack,
  buildPrompt,
  buildDetailPack,
  diagnoseConversionDriver,
  defaultStyleLock,
  getSceneTemplate as sharedGetSceneTemplate,
  matchSceneTemplate as sharedMatchSceneTemplate,
  validateIronRules,
  type EcomJob,
  type EcomJobStatus,
  type EcomPrompt,
  type EcomRatio,
  type EcomSceneTemplate,
  type SceneId,
  SCENE_TEMPLATES,
} from "@helstera/shared";
import { generateImage } from "../../generation/image-generation.js";

// ── Configuration ─────────────────────────────────────────

const DEFAULT_CREDITS_PER_IMAGE = 10;

export interface EcomServiceConfig {
  supabaseUrl: string;
  supabaseServiceKey: string;
  defaultCreditsPerImage?: number;
}

export interface CreateEcomJobInput {
  workspaceId: string;
  userId: string;
  productName: string;
  productDescription?: string;
  /** 1+ scene ids to generate. The first one becomes the "primary" scene. */
  sceneIds: SceneId[];
  ratio?: EcomRatio;
  referenceImageUrl?: string;
  /** Optional campaign style lock (multi-image consistency). */
  styleLock?: ReturnType<typeof defaultStyleLock>;
  /** Auto-detect from product description if not provided. */
  conversionDriver?: "visual" | "pain-point" | "emotional";
}

export interface CreateEcomJobResult {
  job: EcomJob;
  /** Pre-built prompts, one per scene — useful for the UI preview. */
  prompts: EcomPrompt[];
}

// ── Errors ─────────────────────────────────────────────────

export class EcomServiceError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "EcomServiceError";
  }
}

// ── Helpers ────────────────────────────────────────────────

/** Validate that a scene id exists in the registry. */
function resolveScenes(ids: SceneId[]): EcomSceneTemplate[] {
  if (ids.length === 0) {
    throw new EcomServiceError("At least one scene id is required", "no_scenes");
  }
  return ids.map((id) => {
    const t = sharedGetSceneTemplate(id);
    if (!t) throw new EcomServiceError(`Unknown scene: ${id}`, "unknown_scene");
    return t;
  });
}

/** Choose a default style lock from the product name + description. */
function pickStyleLock(
  productName: string,
  description: string | undefined,
  driver: "visual" | "pain-point" | "emotional",
): ReturnType<typeof defaultStyleLock> {
  const text = `${productName} ${description ?? ""}`.toLowerCase();
  if (/(watch|jewel|luxury|leather|gold|premium)/i.test(text)) {
    return defaultStyleLock(driver, "luxury");
  }
  if (/(skincare|cosmetic|organic|natural|fresh|eco)/i.test(text)) {
    return defaultStyleLock(driver, "fresh");
  }
  if (/(tech|smart|device|gadget|electronic|app)/i.test(text)) {
    return defaultStyleLock(driver, "tech");
  }
  return defaultStyleLock(driver, "minimal");
}

// ── Service ────────────────────────────────────────────────

export class EcomService {
  private readonly supabase: SupabaseClient;
  private readonly creditsPerImage: number;

  constructor(config: EcomServiceConfig) {
    this.supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false },
    });
    this.creditsPerImage = config.defaultCreditsPerImage ?? DEFAULT_CREDITS_PER_IMAGE;
  }

  /**
   * List all scene templates (id, name, nameZh, category, defaultRatio).
   */
  listScenes(): Pick<
    EcomSceneTemplate,
    "id" | "name" | "nameZh" | "triggers" | "defaultRatio" | "description"
  >[] {
    return SCENE_TEMPLATES.map((t: EcomSceneTemplate) => ({
      id: t.id,
      name: t.name,
      nameZh: t.nameZh,
      triggers: t.triggers,
      defaultRatio: t.defaultRatio,
      description: t.description,
    }));
  }

  /**
   * Match a single scene by free-text query.
   */
  matchScene(query: string): EcomSceneTemplate {
    return sharedMatchSceneTemplate(query);
  }

  /**
   * Build the prompts for a job WITHOUT running generation. Used by the UI
   * preview before the user clicks generate.
   */
  buildPrompts(input: CreateEcomJobInput): {
    prompts: EcomPrompt[];
    styleLock: ReturnType<typeof defaultStyleLock>;
    driver: "visual" | "pain-point" | "emotional";
  } {
    const scenes = resolveScenes(input.sceneIds);
    const driver =
      input.conversionDriver ??
      diagnoseConversionDriver(`${input.productName} ${input.productDescription ?? ""}`).driver;
    const styleLock =
      input.styleLock ?? pickStyleLock(input.productName, input.productDescription, driver);

    const ratio = input.ratio ?? scenes[0]!.defaultRatio;

    const prompts = scenes.map((scene) =>
      buildPrompt({
        template: scene,
        productName: input.productName,
        productDescription: input.productDescription,
        styleLock,
        ratio,
      }),
    );

    return { prompts, styleLock, driver };
  }

  /**
   * Create a single pending job per scene. The client polls for status.
   */
  async createJob(input: CreateEcomJobInput): Promise<CreateEcomJobResult> {
    const { prompts, styleLock, driver } = this.buildPrompts(input);
    const ratio = input.ratio ?? prompts[0]!.ratio;
    const creditsCharged = this.creditsPerImage * prompts.length;

    // Insert a single ecom_jobs row that wraps the whole batch.
    // Per-scene generation results live in ecom_job_outputs.
    const { data: job, error } = await this.supabase
      .from("ecom_jobs")
      .insert({
        workspace_id: input.workspaceId,
        user_id: input.userId,
        product_name: input.productName,
        product_description: input.productDescription ?? null,
        scene_ids: input.sceneIds,
        ratio,
        reference_image_url: input.referenceImageUrl ?? null,
        style_lock: styleLock,
        conversion_driver: driver,
        prompts: prompts.map((p) => ({
          sceneId: p.sceneId,
          text: p.text,
          negatives: p.negatives,
        })),
        status: "pending",
        credits_charged: creditsCharged,
      })
      .select()
      .single();

    if (error || !job) {
      throw new EcomServiceError(
        error?.message ?? "Failed to create ecom job",
        "db_insert_failed",
      );
    }

    // Kick off generation in the background. We do not await — the client
    // polls /api/ecom/jobs/:id for status updates.
    void this.runJob(job.id as string, prompts, input.referenceImageUrl ?? null);

    return {
      job: this.toPublicJob(job as Record<string, unknown>),
      prompts,
    };
  }

  /**
   * Run the actual image generation for a job. Updates the row with the
   * resulting image URL on each scene completion.
   */
  private async runJob(
    jobId: string,
    prompts: EcomPrompt[],
    referenceImageUrl: string | null,
  ): Promise<void> {
    await this.updateStatus(jobId, "running");

    const results: { sceneId: SceneId; url: string | null; error: string | null }[] = [];

    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i]!;
      try {
        // Validate iron rules — surface violations to the user as warnings
        // but proceed (the user may have intentionally deviated).
        const violations = validateIronRules(prompt.text);
        if (violations.length > 0) {
          console.warn(
            `[EcomService] job ${jobId} scene ${prompt.sceneId} iron-rule violations:`,
            violations,
          );
        }

        // Call the shared image generation. The provider is auto-resolved
        // from env (OpenAI / Google / Replicate). The function returns a
        // { url, mimeType, width, height } object.
        const providerName =
          process.env.ECOM_DEFAULT_PROVIDER ?? "openai";
        const result = await generateImage(providerName, {
          prompt: prompt.text,
          model: process.env.ECOM_DEFAULT_MODEL ?? "gpt-image-1",
          aspectRatio: prompt.ratio as never,
          ...(referenceImageUrl ? { inputImages: [referenceImageUrl] } : {}),
        });

        results.push({
          sceneId: prompt.sceneId,
          url: result.url,
          error: null,
        });

        // Persist progress so the UI can show partial results as they land.
        await this.supabase
          .from("ecom_jobs")
          .update({
            progress: Math.round(((i + 1) / prompts.length) * 100),
            outputs: results,
          })
          .eq("id", jobId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Generation failed";
        console.error(`[EcomService] job ${jobId} scene ${prompt.sceneId} failed:`, message);
        results.push({ sceneId: prompt.sceneId, url: null, error: message });
        await this.supabase
          .from("ecom_jobs")
          .update({ outputs: results })
          .eq("id", jobId);
        // Continue with remaining scenes; don't fail the whole job on one error.
      }
    }

    const allFailed = results.every((r) => r.url === null);
    const anySucceeded = results.some((r) => r.url !== null);
    const finalStatus: EcomJobStatus = allFailed
      ? "failed"
      : anySucceeded
        ? "succeeded"
        : "failed";

    await this.updateStatus(jobId, finalStatus, results);
  }

  /**
   * Get the current state of a job (poll target).
   */
  async getJob(jobId: string): Promise<EcomJob | null> {
    const { data, error } = await this.supabase
      .from("ecom_jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();

    if (error || !data) return null;
    return this.toPublicJob(data as Record<string, unknown>);
  }

  /**
   * List recent jobs for a workspace (for the gallery view).
   */
  async listJobs(workspaceId: string, limit = 20): Promise<EcomJob[]> {
    const { data, error } = await this.supabase
      .from("ecom_jobs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map((d) => this.toPublicJob(d));
  }

  // ── Private helpers ────────────────────────────────────

  private async updateStatus(
    jobId: string,
    status: EcomJobStatus,
    outputs?: { sceneId: SceneId; url: string | null; error: string | null }[],
  ): Promise<void> {
    const update: Record<string, unknown> = { status };
    if (status === "succeeded" || status === "failed") {
      update.completed_at = Date.now();
    }
    if (outputs) update.outputs = outputs;
    await this.supabase.from("ecom_jobs").update(update).eq("id", jobId);
  }

  /** Convert snake_case DB row to camelCase public shape. */
  private toPublicJob(row: Record<string, unknown>): EcomJob {
    return {
      id: String(row.id ?? ""),
      workspaceId: String(row.workspace_id ?? ""),
      userId: String(row.user_id ?? ""),
      sceneId: ((row.scene_ids as string[] | undefined)?.[0] ?? "01-hero-image") as SceneId,
      productName: String(row.product_name ?? ""),
      productDescription: (row.product_description as string | null) ?? undefined,
      prompt: String(
        (row.prompts as Array<{ text: string }> | undefined)?.[0]?.text ?? "",
      ),
      ratio: (row.ratio as EcomRatio) ?? "1:1",
      referenceImageUrl: (row.reference_image_url as string | null) ?? undefined,
      status: (row.status as EcomJobStatus) ?? "pending",
      imageUrl: undefined, // populated per-scene via outputs[]
      errorMessage: undefined,
      creditsCharged: Number(row.credits_charged ?? 0),
      createdAt: Number(row.created_at ?? Date.now()),
      completedAt: row.completed_at ? Number(row.completed_at) : undefined,
    };
  }
}

/** Factory — creates a service from the standard env. */
export function createEcomService(env: {
  SUPABASE_URL?: string | undefined;
  SUPABASE_SERVICE_ROLE_KEY?: string | undefined;
}): EcomService | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return new EcomService({
    supabaseUrl: env.SUPABASE_URL,
    supabaseServiceKey: env.SUPABASE_SERVICE_ROLE_KEY,
  });
}
