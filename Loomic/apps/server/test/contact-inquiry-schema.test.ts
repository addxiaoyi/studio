// @contact-sales — Unit tests for Zod input validation
import { describe, expect, it } from "vitest";
import { z } from "zod";

// Mirror the production schema (loosely) — keeping test independent of
// Fastify import paths.
const contactInquirySchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(255),
  message: z.string().min(1).max(5000),
  company: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  teamSize: z.string().max(40).optional(),
  plan: z.string().max(80).optional(),
  source: z.string().max(80).optional(),
});

describe("contact inquiry schema", () => {
  it("accepts a minimal valid inquiry", () => {
    const result = contactInquirySchema.safeParse({
      name: "李总监",
      email: "li@example.com",
      message: "我们是一家 30 人的设计团队，希望了解企业方案。",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a fully populated inquiry", () => {
    const result = contactInquirySchema.safeParse({
      name: "张 VP",
      email: "zhang@corp.com",
      company: "Acme Inc.",
      phone: "+86 138 0000 0000",
      teamSize: "10-50",
      plan: "business",
      source: "pricing-page",
      message: "想要私有化部署。",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty name", () => {
    const result = contactInquirySchema.safeParse({
      name: "",
      email: "test@example.com",
      message: "Hello",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid email", () => {
    const result = contactInquirySchema.safeParse({
      name: "Alice",
      email: "not-an-email",
      message: "Hello",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a name longer than 100 chars", () => {
    const result = contactInquirySchema.safeParse({
      name: "x".repeat(101),
      email: "test@example.com",
      message: "Hello",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a message longer than 5000 chars", () => {
    const result = contactInquirySchema.safeParse({
      name: "Alice",
      email: "test@example.com",
      message: "x".repeat(5001),
    });
    expect(result.success).toBe(false);
  });

  it("strips unknown fields", () => {
    const result = contactInquirySchema.safeParse({
      name: "Alice",
      email: "test@example.com",
      message: "Hello",
      malicious: "value",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).malicious).toBeUndefined();
    }
  });
});
