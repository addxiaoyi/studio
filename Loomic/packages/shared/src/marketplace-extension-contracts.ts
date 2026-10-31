import { z } from "zod";

export const desktopExtensionKindSchema = z.enum(["skill", "mcp", "plugin"]);
export type DesktopExtensionKind = z.infer<typeof desktopExtensionKindSchema>;

export const desktopExtensionTargetSchema = z.enum(["workspace", "desktop"]);
export type DesktopExtensionTarget = z.infer<typeof desktopExtensionTargetSchema>;

export const desktopExtensionStatusSchema = z.enum([
  "enabled",
  "disabled",
  "blocked",
  "missing",
  "disconnected",
]);
export type DesktopExtensionStatus = z.infer<typeof desktopExtensionStatusSchema>;

export const desktopMarketplaceExtensionInputSchema = z.object({
  itemId: z.string().min(1).max(160),
  slug: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  kind: desktopExtensionKindSchema,
  target: desktopExtensionTargetSchema,
  version: z.string().min(1).max(80),
  description: z.string().max(2_000),
  sourceUrl: z.string().url().max(2_000),
  manifest: z.record(z.unknown()),
  metadata: z.record(z.unknown()).default({}),
  localServerId: z.string().min(1).max(160).optional(),
  localConnected: z.boolean().optional(),
});
export type DesktopMarketplaceExtensionInput = z.infer<
  typeof desktopMarketplaceExtensionInputSchema
>;

export const desktopMarketplaceExtensionSchema =
  desktopMarketplaceExtensionInputSchema.extend({
    enabled: z.boolean(),
    status: desktopExtensionStatusSchema,
    statusMessage: z.string().max(500).optional(),
    installedAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  });
export type DesktopMarketplaceExtension = z.infer<
  typeof desktopMarketplaceExtensionSchema
>;
