export function extractText(response: unknown): string {
  if (typeof response === "string") return response;
  if (response && typeof response === "object" && "content" in response) {
    const content = (response as { content?: unknown }).content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.map(item => typeof item === "string" ? item : item && typeof item === "object" && "text" in item ? String((item as { text?: unknown }).text ?? "") : "").join("");
  }
  throw new Error("Model returned no text.");
}
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) return fenced;
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model response was not JSON.");
  return text.slice(start, end + 1);
}
