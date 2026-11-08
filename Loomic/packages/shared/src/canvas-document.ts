export type WorkflowDocumentContent = { title: string; markdown: string };
export function readWorkflowDocument(
  element: Record<string, unknown>,
): WorkflowDocumentContent | null {
  const custom = element.customData as Record<string, unknown> | undefined,
    document = custom?.workflowDocument as
      | Partial<WorkflowDocumentContent>
      | undefined;
  if (document && typeof document.markdown === "string")
    return {
      title: typeof document.title === "string" ? document.title : "创作文稿",
      markdown: document.markdown,
    };
  if (
    element.type !== "text" ||
    typeof element.text !== "string" ||
    custom?.source !== "workflow" ||
    typeof custom.jobId !== "string" ||
    !custom.jobId.startsWith("workflow-text:")
  )
    return null;
  const title = typeof custom.title === "string" ? custom.title : "创作文稿",
    prefix = title + "\n\n";
  return {
    title,
    markdown: element.text.startsWith(prefix)
      ? element.text.slice(prefix.length)
      : element.text,
  };
}
/** Old generated text keeps its identity and source so saved arrows and receipts stay valid. */
export function workflowDocumentElement<T extends Record<string, unknown>>(
  element: T,
): T {
  const document = readWorkflowDocument(element);
  if (!document || element.type === "embeddable") return element;
  return {
    ...element,
    type: "embeddable",
    width: Math.max(420, Math.min(680, Number(element.width) || 560)),
    height: Math.max(300, Math.min(720, Number(element.height) || 480)),
    link: "https://studio.0st.top/#creative-document",
    strokeColor: "transparent",
    backgroundColor: "transparent",
    roughness: 0,
    roundness: null,
    customData: {
      ...(element.customData as Record<string, unknown>),
      workflowDocument: document,
    },
  };
}
