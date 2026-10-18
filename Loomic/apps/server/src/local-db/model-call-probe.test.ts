import { describe, expect, it, vi } from "vitest";
import { probeConfiguredModelCalls } from "./model-call-probe.js";

describe("model call probe", () => {
  it("checks configured contracts without making network calls", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ model_id: "minimax-h3", media_type: "video", label: "MiniMax", api_format: "lingke_media", request_template: { required: ["images"], defaults: { resolution: "480p" } }, response_template: {}, supports_input_image: true, supports_input_video: false, supports_audio: false, max_duration_seconds: 15, enabled: true, provider_enabled: true, provider_health: "healthy", health_status: "healthy", failure_count: 0, cooldown_until: null, max_resolution: "1080p" }] }) } as any;
    const [row] = await probeConfiguredModelCalls(db);
    expect(row).toMatchObject({ family: "minimax-lingke", verificationMode: "configuration_only", hasInputField: true, supportsInputImage: true, supportsInputVideo: false, supportsAudio: false, maxDurationSeconds: 15, maxResolution: "1080p", resolution: "768P", callable: true });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("flags custom video models without explicit response paths", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ model_id: "workspace-video", media_type: "video", label: "Custom", api_format: "custom", request_template: {}, response_template: {}, enabled: true, provider_enabled: true, provider_health: "healthy", health_status: "healthy", failure_count: 0, cooldown_until: null, max_resolution: "720p", duplicate_mappings: 1 }] }) } as any;
    const [row] = await probeConfiguredModelCalls(db);
    expect(row?.callable).toBe(false);
    expect(row?.hasTaskIdMapping).toBe(false);
    expect(row?.hasVideoUrlMapping).toBe(false);
    expect(row?.warnings).toContain("custom_task_id_path_missing");
    expect(row?.warnings).toContain("custom_video_url_path_missing");
  });

  it("flags custom image response contracts without making a standard shape claim", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ model_id: "workspace-image", media_type: "image", label: "Custom", api_format: "custom", request_template: {}, response_template: {}, enabled: true, provider_enabled: true, provider_health: "healthy", health_status: "healthy", failure_count: 0, cooldown_until: null, max_resolution: "2K", duplicate_mappings: 1 }] }) } as any;
    const [row] = await probeConfiguredModelCalls(db);
    expect(row?.callable).toBe(true);
    expect(row?.warnings).toContain("image_response_contract_unverified");
  });

  it("uses persisted model capabilities when request templates omit image fields", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ model_id: "image-model", media_type: "image", label: "Provider", api_format: "custom", request_template: {}, response_template: { imageUrlPath: "data.url" }, supports_input_image: true, enabled: true, provider_enabled: true, provider_health: "healthy", health_status: "healthy", failure_count: 0, cooldown_until: null, max_resolution: "2K", duplicate_mappings: 1 }] }) } as any;
    const [row] = await probeConfiguredModelCalls(db);
    expect(row?.hasInputField).toBe(true);
    expect(row?.verificationMode).toBe("configuration_only");
  });

  it("warns when a built-in profile exceeds persisted video capabilities", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ model_id: "google-official/veo-3.1-generate-preview", media_type: "video", label: "Google", api_format: "google", request_template: {}, response_template: {}, supports_input_image: true, supports_input_video: false, supports_audio: false, max_duration_seconds: 5, enabled: true, provider_enabled: true, provider_health: "healthy", health_status: "healthy", failure_count: 0, cooldown_until: null, max_resolution: "720p", duplicate_mappings: 1 }] }) } as any;
    const [row] = await probeConfiguredModelCalls(db);
    expect(row?.warnings).toContain("profile_duration_exceeds_database_limit");
    expect(row?.warnings).toContain("profile_audio_exceeds_database_capability");
  });
});
