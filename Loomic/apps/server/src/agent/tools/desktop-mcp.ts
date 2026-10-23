import { createHash } from "node:crypto";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { type ZodTypeAny, z } from "zod";

import type { DesktopMcpTool } from "@helstera/shared";

const MAX_SCHEMA_DEPTH = 8;
const MAX_SCHEMA_PROPERTIES = 64;
const MAX_DESKTOP_MCP_TOOLS = 128;
const BLOCKED_PROPERTY_NAMES = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

function unionOf(options: ZodTypeAny[]) {
  if (options.length === 1) return options[0]!;
  if (options.length < 1)
    throw new Error("The MCP tool schema contains an empty union.");
  return z.union(options as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
}

type CallDesktopMcpTool = (input: {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}) => Promise<string>;

function boundedInteger(value: unknown, fallback: number, max: number) {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.max(0, Math.min(value, max));
}

function schemaFor(value: unknown, depth = 0): ZodTypeAny {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The MCP tool supplied a malformed JSON schema.");
  }
  if (depth > MAX_SCHEMA_DEPTH)
    throw new Error("The MCP tool schema is nested too deeply.");
  const schema = value as Record<string, unknown>;
  if ("$ref" in schema || "allOf" in schema || "not" in schema) {
    throw new Error(
      "This MCP tool uses unsupported JSON Schema references or combinators.",
    );
  }
  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
    const choices = (schema.anyOf ?? schema.oneOf) as unknown[];
    if (choices.length > 8)
      throw new Error("The MCP tool schema union is too large.");
    return unionOf(choices.map((choice) => schemaFor(choice, depth + 1)));
  }
  if (Array.isArray(schema.type)) {
    const choices = schema.type.filter(
      (entry): entry is string => typeof entry === "string",
    );
    if (choices.length > 8)
      throw new Error("The MCP tool schema type union is too large.");
    return unionOf(
      choices.map((type) => schemaFor({ ...schema, type }, depth + 1)),
    );
  }
  if ("const" in schema) {
    if (
      schema.const !== null &&
      !["string", "number", "boolean"].includes(typeof schema.const)
    ) {
      throw new Error("The MCP tool schema contains an unsupported constant.");
    }
    return z.literal(schema.const as string | number | boolean | null);
  }
  if (Array.isArray(schema.enum)) {
    const values = schema.enum.filter(
      (entry) =>
        entry === null ||
        ["string", "number", "boolean"].includes(typeof entry),
    );
    if (values.length !== schema.enum.length || values.length < 1)
      throw new Error("The MCP tool enum is invalid.");
    return unionOf(values.map((entry) => z.literal(entry)));
  }

  let result: ZodTypeAny;
  switch (schema.type) {
    case "object": {
      const properties =
        schema.properties &&
        typeof schema.properties === "object" &&
        !Array.isArray(schema.properties)
          ? (schema.properties as Record<string, unknown>)
          : {};
      const keys = Object.keys(properties);
      if (
        keys.length > MAX_SCHEMA_PROPERTIES ||
        keys.some((key) => BLOCKED_PROPERTY_NAMES.has(key))
      ) {
        throw new Error(
          "The MCP tool schema has too many or unsafe property names.",
        );
      }
      const required = new Set(
        Array.isArray(schema.required)
          ? schema.required.filter(
              (entry): entry is string => typeof entry === "string",
            )
          : [],
      );
      if ([...required].some((key) => !Object.hasOwn(properties, key)))
        throw new Error("The MCP tool schema requires an undefined property.");
      const shape: Record<string, ZodTypeAny> = Object.create(null) as Record<
        string,
        ZodTypeAny
      >;
      for (const key of keys) {
        const field = schemaFor(properties[key], depth + 1);
        shape[key] = required.has(key) ? field : field.optional();
      }
      const objectSchema = z.object(shape);
      result =
        schema.additionalProperties === true
          ? objectSchema.passthrough()
          : objectSchema.strict();
      break;
    }
    case "array": {
      if (!schema.items)
        throw new Error(
          "The MCP tool array schema is missing its item definition.",
        );
      result = z
        .array(schemaFor(schema.items, depth + 1))
        .min(boundedInteger(schema.minItems, 0, 1_000))
        .max(boundedInteger(schema.maxItems, 1_000, 1_000));
      break;
    }
    case "string": {
      result = z
        .string()
        .min(boundedInteger(schema.minLength, 0, 20_000))
        .max(boundedInteger(schema.maxLength, 20_000, 20_000));
      if (schema.format === "email") result = result.pipe(z.email());
      if (schema.format === "uri" || schema.format === "url")
        result = result.pipe(z.url());
      if (schema.format === "uuid") result = result.pipe(z.uuid());
      break;
    }
    case "integer":
      result = z.number().int();
      if (typeof schema.minimum === "number")
        result = (result as z.ZodNumber).min(schema.minimum);
      if (typeof schema.maximum === "number")
        result = (result as z.ZodNumber).max(schema.maximum);
      break;
    case "number":
      result = z.number().finite();
      if (typeof schema.minimum === "number")
        result = (result as z.ZodNumber).min(schema.minimum);
      if (typeof schema.maximum === "number")
        result = (result as z.ZodNumber).max(schema.maximum);
      break;
    case "boolean":
      result = z.boolean();
      break;
    case "null":
      result = z.null();
      break;
    default:
      throw new Error(
        `The MCP tool uses an unsupported JSON Schema type: ${String(schema.type ?? "missing")}.`,
      );
  }

  return typeof schema.description === "string"
    ? result.describe(schema.description.slice(0, 500))
    : result;
}

function toolName(tool: DesktopMcpTool) {
  const serverKey = tool.serverId.replaceAll("-", "").slice(0, 8);
  const readableName = tool.name.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!readableName)
    throw new Error(
      "MCP tool name cannot be represented as an Agent tool name.",
    );
  const hash = createHash("sha256").update(tool.name).digest("hex").slice(0, 8);
  return `mcp_${serverKey}_${readableName.slice(0, 42)}_${hash}`;
}

export function createDesktopMcpTools(
  tools: DesktopMcpTool[],
  callTool: CallDesktopMcpTool,
) {
  if (tools.length > MAX_DESKTOP_MCP_TOOLS)
    throw new Error("The active desktop MCP catalog is too large.");
  const names = new Set<string>();

  return tools.map((descriptor) => {
    const name = toolName(descriptor);
    if (names.has(name))
      throw new Error(
        "The active desktop MCP catalog contains duplicate tool names.",
      );
    names.add(name);
    const schema = schemaFor(descriptor.inputSchema);
    if (!(schema instanceof z.ZodObject))
      throw new Error(`MCP tool ${descriptor.name} must accept an object.`);

    return new DynamicStructuredTool({
      name,
      description:
        `${descriptor.serverName}: ${descriptor.description || descriptor.name}`.slice(
          0,
          2_000,
        ),
      schema,
      func: async (input) =>
        callTool({
          serverId: descriptor.serverId,
          toolName: descriptor.name,
          arguments: input as Record<string, unknown>,
        }),
    });
  });
}
