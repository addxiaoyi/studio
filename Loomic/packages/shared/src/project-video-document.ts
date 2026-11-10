import { z } from "zod";

const sourcePath = z.string().min(1).max(512).refine(path => path.startsWith("/project/") && !path.split("/").includes("..") && !path.includes("\\"), "Invalid project source path");
const mediaName = z.string().min(1).max(512).refine(name => !name.startsWith("/") && !["__proto__","constructor","prototype"].includes(name) && !name.split("/").includes("..") && !/[\\\u0000-\u001f]/.test(name), "Invalid project media name");
export const projectVideoDocumentSchema = z.object({
  version: z.literal(1),
  entryPoint: sourcePath,
  rootDir: z.literal("/project"),
  files: z.record(sourcePath,z.string().max(512 * 1024)).refine(files => Object.keys(files).length <= 256,"Too many project files"),
  assets: z.array(z.object({
    name: mediaName, size: z.number().int().nonnegative().max(64 * 1024 ** 3),
    mimeType: z.string().max(120), assetId: z.string().uuid().nullable(),
    sha256: z.string().regex(/^[a-f\d]{64}$/).nullable(),
  }).strict()).max(2000),
  state: z.object({
    loomicCut: z.unknown().optional(), loomicCuts: z.unknown().optional(),
    loomicAppliedEdits: z.array(z.string()).max(500).optional(),
    loomicEditJournals: z.unknown().optional(), canvasImports: z.unknown().optional(),
  }).strict(),
}).strict().superRefine((document,context) => {
  if (!(document.entryPoint in document.files)) context.addIssue({code:z.ZodIssueCode.custom,path:["entryPoint"],message:"Project entry file is missing"});
  if (new Set(document.assets.map(asset=>asset.name.toLowerCase())).size!==document.assets.length) context.addIssue({code:z.ZodIssueCode.custom,path:["assets"],message:"Duplicate project media names"});
});

export const projectVideoWriteSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  mutationId: z.string().uuid(),
  syncEnabled: z.boolean(),
  document: projectVideoDocumentSchema,
}).strict();
export const projectVideoRevisionSchema = z.object({
  revision:z.number().int().positive(), updatedAt:z.string().datetime(),
  syncEnabled:z.boolean(), document:projectVideoDocumentSchema,
});
export const projectVideoVersionSummarySchema=z.object({revision:z.number().int().positive(),updatedAt:z.string().datetime(),bytes:z.number().int().nonnegative(),syncEnabled:z.boolean()});
export const projectVideoVersionsSchema=z.array(projectVideoVersionSummarySchema);
export const projectSyncReceiptSchema=z.object({revision:z.number().int().nonnegative(),hash:z.string().nullable(),pending:projectVideoWriteSchema.optional()});
export type ProjectVideoVersion=z.infer<typeof projectVideoVersionSummarySchema>;
export type ProjectSyncReceipt=z.infer<typeof projectSyncReceiptSchema>;
export type ProjectVideoDocument = z.infer<typeof projectVideoDocumentSchema>;
export type ProjectVideoWrite = z.infer<typeof projectVideoWriteSchema>;
export type ProjectVideoRevision = z.infer<typeof projectVideoRevisionSchema>;
