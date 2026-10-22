export function isCredentialAction(action) {
  const fieldType = String(action?.fieldType ?? "").toLowerCase().replace(/[\s_]+/g, "-");
  return /password|passcode|one-time-code|otp|verification-code|auth-code|\bmfa\b/.test(fieldType);
}

export function websiteActionReceipt(action) {
  const receipt = { ...action };
  delete receipt.value;
  return receipt;
}

export function fillPageField(input, dom = globalThis) {
  const element = dom.document.querySelector(input.selector);
  if (!(element instanceof dom.HTMLInputElement || element instanceof dom.HTMLTextAreaElement || element instanceof dom.HTMLSelectElement)) {
    return { ok: false, message: "填写目标不存在。" };
  }
  const autocomplete = String(element.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/);
  const hints = [
    element instanceof dom.HTMLInputElement ? element.type : "",
    element.getAttribute("name"),
    element.id,
    element.getAttribute("aria-label"),
    element.getAttribute("placeholder"),
    ...autocomplete,
  ].filter(Boolean).join(" ").toLowerCase().replace(/[\s_]+/g, "-");
  if ((element instanceof dom.HTMLInputElement && element.type.toLowerCase() === "password")
      || autocomplete.some((value) => ["current-password", "new-password", "one-time-code"].includes(value))
      || /password|passcode|one-time-code|otp|verification-code|auth-code|\bmfa\b/.test(hints)) {
    return { ok: false, message: "密码、OTP 和验证码字段始终禁止自动填写。" };
  }
  element.value = input.value;
  element.dispatchEvent(new dom.Event("input", { bubbles: true }));
  element.dispatchEvent(new dom.Event("change", { bubbles: true }));
  return { ok: true };
}
