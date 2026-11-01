export const ASSISTANT_RECONNECT_BASE_MS = 500;
export const ASSISTANT_RECONNECT_MAX_MS = 30_000;
export const ASSISTANT_RECONNECT_MAX_EXPONENT = 6;

export function assistantReconnectDelay(attempt: number, random = Math.random) {
  const exponent = Math.max(0, Math.min(Math.floor(attempt), ASSISTANT_RECONNECT_MAX_EXPONENT));
  const base = Math.min(ASSISTANT_RECONNECT_MAX_MS, ASSISTANT_RECONNECT_BASE_MS * 2 ** exponent);
  return Math.min(ASSISTANT_RECONNECT_MAX_MS, Math.round(base * (0.8 + Math.max(0, Math.min(1, random())) * 0.4)));
}

export function shouldReconnectAssistant(code: number) {
  return ![4001, 4003, 4004].includes(code);
}

export function interruptedApprovalRequiresReview(pendingApprovalCount: number) {
  return pendingApprovalCount > 0;
}

const resumableNativeActions = new Set(["read_page", "capture_screen"]);

export function nativeResumeIsReadOnly(actions: ReadonlyArray<{ kind: string }>) {
  return actions.every((action) => resumableNativeActions.has(action.kind));
}

export async function readCurrentEvidence<T>(read: () => Promise<T>, isCurrent: () => boolean): Promise<{ current: true; evidence: T } | { current: false }> {
  if (!isCurrent()) return { current: false };
  try {
    const evidence = await read();
    return isCurrent() ? { current: true, evidence } : { current: false };
  } catch (error) {
    if (!isCurrent()) return { current: false };
    throw error;
  }
}

export async function verifyNativeResumeAction<T>(
  action: { kind: string },
  expectedWindow: unknown,
  inspect: () => Promise<T>,
  matches: (snapshot: T, identity: unknown) => boolean,
  isCurrent: () => boolean,
) {
  if (!nativeResumeIsReadOnly([action]) || !isCurrent()) return false;
  let snapshot: T;
  try {
    snapshot = await inspect();
  } catch (error) {
    if (!isCurrent()) return false;
    throw error;
  }
  return isCurrent() && matches(snapshot, expectedWindow);
}
