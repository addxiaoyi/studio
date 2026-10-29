import { describe, expect, it } from "vitest";

import { formatModelDisplayName, formatPublicTransactionDescription } from "../src/components/chat/utils";

describe("public display formatting", () => {
  it("hides internal model ids", () => {
    expect(formatModelDisplayName("openai:codex-auto-review")).toBe("HelsterAgent");
    expect(formatModelDisplayName("provider/internal-secret-model")).toBe("Helstera AI");
  });

  it("replaces corrupted transaction descriptions with safe labels", () => {
    expect(formatPublicTransactionDescription("\uFFFD\uFFFD codex-auto-review", "generation_deduct")).toBe("AI generation");
    expect(formatPublicTransactionDescription("video_generation: minimax-h3", "generation_deduct")).toBe("Video generation");
    expect(formatPublicTransactionDescription("Direct video generation: minimax-h3", "generation_deduct")).toBe("Video generation");
    expect(formatPublicTransactionDescription("Ã¤Â¸­æ–‡", "generation_deduct")).toBe("AI generation");
  });
});
