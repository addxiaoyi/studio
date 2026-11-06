import type { File, JSXElement, Node } from "../../vendor/visualforge/packages/codemods/node_modules/@babel/types";
import type { StudioCaption } from "../../apps/web/src/lib/studio-cut";

function literal(node: Node | null | undefined): string | number | null {
  if (node?.type === "StringLiteral" || node?.type === "NumericLiteral") return node.value;
  if (node?.type === "UnaryExpression" && node.operator === "-" && node.argument.type === "NumericLiteral") return -node.argument.value;
  return null;
}

function prop(element: JSXElement, name: string) {
  const attribute = element.openingElement.attributes.find(item => item.type === "JSXAttribute" && item.name.name === name);
  if (!attribute || attribute.type !== "JSXAttribute") return undefined;
  return attribute.value?.type === "JSXExpressionContainer" ? attribute.value.expression : attribute.value;
}

export function nativeCaptions(element: JSXElement, ast: File, offset: number, limit: number, fps: number): StudioCaption[] | null {
  const tag = element.openingElement.name;
  if (tag.type !== "JSXIdentifier") return null;
  const isNative = ast.program.body.some(statement => statement.type === "ImportDeclaration"
    && /(?:^|\/)basic-captions(?:-\d+)?\.element(?:\.tsx)?$/.test(statement.source.value)
    && statement.specifiers.some(specifier => specifier.type === "ImportSpecifier" && specifier.local.name === tag.name
      && (specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value) === "BasicCaptions"));
  if (!isNative) return null;
  if (element.openingElement.attributes.some(item => item.type === "JSXSpreadAttribute")) throw new Error("原生字幕使用动态参数，暂不能安全读取。");
  const timing = (name: string, fallback: number) => {
    const node = prop(element, name);
    const value = node ? literal(node) : fallback;
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("原生字幕使用动态时间，请先设定固定时间。");
    return value;
  };
  if (timing("trimBefore", 0) !== 0 || timing("playbackRate", 1) !== 1) throw new Error("带变速或裁切的原生字幕暂不支持自动读取，请先展开为固定时间字幕。");
  const from = offset + timing("from", 0);
  const end = Math.min(limit, from + timing("durationInFrames", limit - from));
  const source = prop(element, "captions");
  if (source?.type !== "ArrayExpression") throw new Error("原生字幕使用动态内容，请先将字幕保存为静态列表。");
  return source.elements.flatMap(item => {
    if (item?.type !== "ObjectExpression") throw new Error("原生字幕列表格式无效。");
    const fields = new Map<string, string | number | null>();
    for (const field of item.properties) {
      if (field.type !== "ObjectProperty" || field.computed) throw new Error("原生字幕含动态字段，暂不能安全读取。");
      const name = field.key.type === "Identifier" ? field.key.name : literal(field.key);
      if (typeof name === "string") fields.set(name, literal(field.value));
    }
    const text = fields.get("text");
    const startMs = fields.get("startMs");
    const endMs = fields.get("endMs");
    if (typeof text !== "string" || typeof startMs !== "number" || typeof endMs !== "number" || endMs <= startMs) throw new Error("原生字幕的文本或时间无效。");
    const start = Math.max(0, offset / fps * 1000, from / fps * 1000 + startMs);
    const finish = Math.min(end / fps * 1000, from / fps * 1000 + endMs);
    return finish > start && text.trim() ? [{ text, startMs: Math.round(start), endMs: Math.round(finish) }] : [];
  });
}
