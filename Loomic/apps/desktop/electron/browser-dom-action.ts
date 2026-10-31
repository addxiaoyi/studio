type BrowserDomAction = { kind: "click" | "type" | "fill"; target: string; value?: string };
type BrowserScriptHost = { executeJavaScript(script: string): Promise<unknown> };

export function buildBrowserDomScript(action: BrowserDomAction): string {
  if (!action.target.trim() || action.target.length > 500 || (action.kind !== "click" && (typeof action.value !== "string" || action.value.length > 10_000))) {
    throw new Error("Choose a specific browser target and a bounded text value.");
  }
  return `(${applyBrowserDomAction.toString()})(${JSON.stringify(action)})`;
}

export async function executeBrowserDomAction(host: BrowserScriptHost, action: BrowserDomAction): Promise<void> {
  const reply = await host.executeJavaScript(buildBrowserDomScript(action));
  if (!reply || typeof reply !== "object" || (reply as { ok?: unknown }).ok !== true) throw new Error("Browser action was not acknowledged. Inspect the page before retrying.");
}

export async function applyBrowserDomAction(action: BrowserDomAction): Promise<{ ok: true }> {
  const deadline = Date.now() + 5_000;
  let element: HTMLElement | undefined;
  while (!element) {
    const matches = document.querySelectorAll(action.target);
    if (matches.length > 1) throw new Error("Browser target is ambiguous; use a unique selector.");
    const candidate = matches[0];
    if (candidate instanceof HTMLElement) {
      const rect = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      if (rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0" && !candidate.matches(":disabled") && candidate.getAttribute("aria-disabled") !== "true") element = candidate;
    }
    if (!element) {
      if (Date.now() >= deadline) throw new Error("Browser target is missing, hidden or disabled.");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const hints = [element.getAttribute("type"), element.getAttribute("name"), element.id, element.getAttribute("autocomplete"), element.getAttribute("aria-label"), element.getAttribute("placeholder")].filter(Boolean).join(" ");
  if (/password|passcode|one[-_ ]?time|otp|verification|auth[-_ ]?code|mfa|密码|验证码|口令|密钥/i.test(hints)) throw new Error("Credentials and verification controls cannot be operated by the Agent.");
  element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const rect = element.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  if (!hit || (hit !== element && !element.contains(hit))) throw new Error("Browser target is covered by another element.");
  if (action.kind === "click") { element.click(); return { ok: true }; }
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) throw new Error("Browser target is not an editable form field.");
  if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.readOnly) throw new Error("Browser text field is read-only.");
  if (element instanceof HTMLInputElement && !["text", "search", "email", "url", "tel", "number"].includes(element.type)) throw new Error("This input type cannot be filled by the Agent.");
  if (element instanceof HTMLSelectElement && !Array.from(element.options).some((option) => option.value === action.value && !option.disabled)) throw new Error("The requested select option is unavailable.");
  const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("The browser text field has no supported value setter.");
  element.focus();
  setter.call(element, action.value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  if (!element.isConnected || element.value !== action.value) throw new Error("The page changed or rejected the input. Inspect it before retrying.");
  return { ok: true };
}
