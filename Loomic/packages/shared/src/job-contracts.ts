import { z } from "zod";
import { feedStructureSchema } from "./growth-contracts.js";

// --- Enums ---

export const backgroundJobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "sync_pending",
  "sync_failed",
  "canceled",
  "dead_letter",
]);
export type BackgroundJobStatus = z.infer<typeof backgroundJobStatusSchema>;

export const backgroundJobTypeSchema = z.enum([
  "image_generation",
  "video_generation",
  "feed_structure",
]);
/** Existing JobService APIs currently create generation jobs only. */
export type BackgroundJobType = "image_generation" | "video_generation";
export type AnyBackgroundJobType = z.infer<typeof backgroundJobTypeSchema>;
export type FeedStructureJobType = "feed_structure";

// --- Payloads ---

export const imageGenerationPayloadSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
  aspect_ratio: z.string().optional(),
});
export type ImageGenerationPayload = z.infer<typeof imageGenerationPayloadSchema>;

export const videoGenerationPayloadSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
  duration: z.number().int().min(1).max(300).optional(),
  resolution: z.string().optional(),
  aspect_ratio: z.string().optional(),
  input_images: z.array(z.string()).optional(),
  input_asset_ids: z.array(z.string().uuid()).optional(),
  input_video: z.string().optional(),
  enable_audio: z.boolean().optional(),
});
export type VideoGenerationPayload = z.infer<typeof videoGenerationPayloadSchema>;

export const feedStructurePayloadSchema = z.object({
  feed_package_id: z.string().uuid(),
  feed_workspace_id: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  brief: z.string().trim().min(1).max(4000),
  topic: z.string().trim().max(500).optional(),
  goal: z.string().trim().max(120).optional(),
  content_type: z.string().trim().max(120).optional(),
  platforms: z.array(z.string().trim().min(1).max(64)).max(16).optional(),
  duration_seconds: z.number().int().min(5).max(300).optional(),
  model: z.string().trim().max(160).optional(),
  existing_structure: z.record(z.string(), z.unknown()).optional(),
});
export type FeedStructurePayload = z.infer<typeof feedStructurePayloadSchema>;

export const createVideoJobRequestSchema = z.object({
  project_id: z.string().uuid().optional(),
  canvas_id: z.string().uuid().optional(),
  session_id: z.string().uuid().optional(),
  thread_id: z.string().optional(),
  prompt: z.string().min(1),
  model: z.string().optional(),
  duration: z.number().int().min(1).max(300).optional(),
  resolution: z.string().optional(),
  aspect_ratio: z.string().optional(),
  input_images: z.array(z.string()).optional(),
  input_asset_ids: z.array(z.string().uuid()).optional(),
  input_video: z.string().optional(),
  enable_audio: z.boolean().optional(),
});
export type CreateVideoJobRequest = z.infer<typeof createVideoJobRequestSchema>;

// --- Job entity ---

export const backgroundJobSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  project_id: z.string().uuid().nullable(),
  canvas_id: z.string().uuid().nullable(),
  session_id: z.string().uuid().nullable(),
  thread_id: z.string().nullable(),
  queue_name: z.string(),
  job_type: backgroundJobTypeSchema,
  status: backgroundJobStatusSchema,
  payload: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()).nullable(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  progress: z.number().int().min(0).max(100),
  stage: z.string().nullable(),
  attempt_count: z.number().int(),
  max_attempts: z.number().int(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  failed_at: z.string().nullable(),
  canceled_at: z.string().nullable(),
  sync_attempt_count: z.number().int().optional(),
  next_sync_at: z.string().nullable().optional(),
  sync_error_code: z.string().nullable().optional(),
  sync_error_message: z.string().nullable().optional(),
  reused: z.boolean().optional(),
});
export type BackgroundJob = z.infer<typeof backgroundJobSchema>;

// --- API Request schemas ---

export const createImageJobRequestSchema = z.object({
  project_id: z.string().uuid().optional(),
  canvas_id: z.string().uuid().optional(),
  session_id: z.string().uuid().optional(),
  thread_id: z.string().optional(),
  prompt: z.string().min(1),
  model: z.string().optional(),
  aspect_ratio: z.string().optional(),
  input_images: z.array(z.string().trim().min(1).max(12_000_000)).max(14).optional(),
  input_asset_ids: z.array(z.string().uuid()).max(14).optional(),
});
export type CreateImageJobRequest = z.infer<typeof createImageJobRequestSchema>;

// --- API Response schemas ---

export const jobResponseSchema = z.object({
  job: backgroundJobSchema,
});
export type JobResponse = z.infer<typeof jobResponseSchema>;

export const jobListResponseSchema = z.object({
  jobs: z.array(backgroundJobSchema),
});
export type JobListResponse = z.infer<typeof jobListResponseSchema>;
